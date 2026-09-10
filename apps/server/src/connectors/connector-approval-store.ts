import {
  AgentRunId,
  ConversationId,
  FamilyMemberId,
  MessageId,
} from "@ronto/api";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { randomUUID } from "node:crypto";

const ApprovalRow = Schema.Struct({
  id: Schema.String,
  runId: AgentRunId,
  conversationId: ConversationId,
  triggerMessageId: MessageId,
  familyMemberId: FamilyMemberId,
  connectionId: Schema.String,
  actionId: Schema.String,
  inputJson: Schema.fromJsonString(Schema.JsonObject),
  title: Schema.String,
  description: Schema.String,
  approvalStatus: Schema.Literals(["pending", "approved", "rejected"]),
  executionStatus: Schema.Literals([
    "pending",
    "running",
    "succeeded",
    "failed",
    "outcome_unknown",
  ]),
  origin: Schema.Literals(["web", "whatsapp"]),
  resultMessageId: Schema.NullOr(MessageId),
  toolStatus: Schema.Literals([
    "waiting_for_approval",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  expiresAt: Schema.DateTimeUtcFromString,
  decidedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  outputJson: Schema.NullOr(Schema.fromJsonString(Schema.Json)),
  errorJson: Schema.NullOr(Schema.fromJsonString(Schema.Json)),
});

export type ConnectorApproval = typeof ApprovalRow.Type;
type StoreError = SqlError | Schema.SchemaError;

export interface ProposeConnectorApproval {
  readonly runId: AgentRunId;
  readonly memberId: FamilyMemberId;
  readonly connectionId: string;
  readonly actionId: string;
  readonly input: Schema.JsonObject;
  readonly title: string;
  readonly description: string;
  readonly origin: "web" | "whatsapp";
}

export interface ConnectorApprovalDecision {
  readonly approval: ConnectorApproval;
  readonly claimed: boolean;
}

const selectApproval = `
  call.id,
  call.run_id,
  run.conversation_id,
  run.trigger_message_id,
  call.family_member_id,
  call.connector_connection_id AS connection_id,
  call.connector_action_id AS action_id,
  call.input_json,
  call.approval_title AS title,
  call.approval_description AS description,
  approval.status AS approval_status,
  approval.execution_status,
  approval.origin,
  approval.result_message_id,
  call.status AS tool_status,
  approval.expires_at,
  approval.decided_at,
  call.output_json,
  call.error_json
`;

export class ConnectorApprovalStore extends Context.Service<
  ConnectorApprovalStore,
  {
    readonly propose: (
      input: ProposeConnectorApproval,
    ) => Effect.Effect<ConnectorApproval, StoreError>;
    readonly list: (
      memberId: FamilyMemberId,
    ) => Effect.Effect<ReadonlyArray<ConnectorApproval>, StoreError>;
    readonly find: (
      memberId: FamilyMemberId,
      approvalId: string,
    ) => Effect.Effect<ConnectorApproval | null, StoreError>;
    readonly decide: (
      memberId: FamilyMemberId,
      approvalId: string,
      decision: "approved" | "rejected",
    ) => Effect.Effect<ConnectorApprovalDecision | null, StoreError>;
    readonly complete: (
      approvalId: string,
      result:
        | { readonly status: "succeeded"; readonly output: Schema.Json }
        | { readonly status: "failed"; readonly error: Schema.Json }
        | { readonly status: "outcome_unknown"; readonly error: Schema.Json },
    ) => Effect.Effect<void, StoreError>;
    readonly recoverInterrupted: () => Effect.Effect<void, StoreError>;
  }
>()("ronto/connectors/ConnectorApprovalStore") {
  static readonly layer = Layer.effect(
    ConnectorApprovalStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const decode = Schema.decodeUnknownEffect(ApprovalRow);

      const resultText = (
        status: "rejected" | "succeeded" | "failed" | "outcome_unknown",
      ): string =>
        status === "succeeded"
          ? "The approved action completed."
          : status === "rejected"
            ? "The action was cancelled."
            : status === "outcome_unknown"
              ? "The provider outcome is unknown. Ronto will not retry this action automatically."
              : "The approved action failed.";

      const recordResult = Effect.fn("ConnectorApprovalStore.recordResult")(
        function* (
          approvalId: string,
          status: "rejected" | "succeeded" | "failed" | "outcome_unknown",
        ) {
          const id = randomUUID();
          const at = DateTime.formatIso(yield* DateTime.now);
          const externalMessageId = `connector-approval-result:${approvalId}`;
          const text = resultText(status);
          const content = JSON.stringify({
            version: 1,
            blocks: [{ type: "text", text }],
          });
          yield* sql`
            INSERT INTO ronto_message (
              id, conversation_id, sequence, sender_type, sender_member_id,
              external_message_id, reply_to_message_id, content_json, created_at
            )
            SELECT
              ${id}, run.conversation_id,
              COALESCE((
                SELECT MAX(message.sequence) + 1
                FROM ronto_message message
                WHERE message.conversation_id = run.conversation_id
              ), 1),
              'agent', NULL, ${externalMessageId}, run.trigger_message_id,
              ${content}, ${at}
            FROM ronto_tool_call call
            JOIN ronto_agent_run run ON run.id = call.run_id
            WHERE call.id = ${approvalId}
            ON CONFLICT (conversation_id, external_message_id) DO NOTHING
          `;
          yield* sql`
            UPDATE ronto_tool_approval
            SET result_message_id = (
              SELECT message.id
              FROM ronto_message message
              JOIN ronto_tool_call call ON call.id = ${approvalId}
              JOIN ronto_agent_run run ON run.id = call.run_id
              WHERE message.conversation_id = run.conversation_id
                AND message.external_message_id = ${externalMessageId}
            )
            WHERE tool_call_id = ${approvalId} AND result_message_id IS NULL
          `;
          yield* sql`
            INSERT INTO ronto_whatsapp_outbox (
              id, inbox_id, assistant_message_id, external_channel_id,
              part_index, approval_id, text,
              status, attempt_count, next_attempt_at, created_at, updated_at
            )
            SELECT
              ${randomUUID()}, source.inbox_id, approval.result_message_id,
              source.external_channel_id,
              COALESCE((
                SELECT MAX(existing.part_index) + 1
                FROM ronto_whatsapp_outbox existing
                WHERE existing.inbox_id = source.inbox_id
              ), 0),
              NULL, ${text}, 'pending', 0, ${at}, ${at}, ${at}
            FROM ronto_tool_approval approval
            JOIN ronto_whatsapp_outbox source
              ON source.approval_id = approval.tool_call_id
            WHERE approval.tool_call_id = ${approvalId}
              AND approval.origin = 'whatsapp'
              AND approval.result_message_id IS NOT NULL
              AND NOT EXISTS (
                SELECT 1 FROM ronto_whatsapp_outbox result
                WHERE result.assistant_message_id = approval.result_message_id
              )
            ORDER BY source.created_at, source.id
            LIMIT 1
          `;
        },
      );

      const expire = Effect.fn("ConnectorApprovalStore.expire")(function* () {
        const now = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          UPDATE ronto_tool_call AS call
          SET status = 'cancelled', completed_at = ${now}
          WHERE call.status = 'waiting_for_approval'
            AND EXISTS (
              SELECT 1
              FROM ronto_tool_approval AS approval
              WHERE approval.tool_call_id = call.id
                AND approval.status = 'pending'
                AND approval.expires_at <= ${now}
            )
        `;
      });

      const findOwned = Effect.fn("ConnectorApprovalStore.findOwned")(
        function* (memberId: FamilyMemberId, approvalId: string) {
          const rows = yield* sql`
            SELECT ${sql.unsafe(selectApproval)}
            FROM ronto_tool_call call
            JOIN ronto_agent_run run ON run.id = call.run_id
            JOIN ronto_tool_approval approval ON approval.tool_call_id = call.id
            WHERE call.id = ${approvalId}
              AND call.family_member_id = ${memberId}
              AND call.connector_connection_id IS NOT NULL
          `;
          const row = rows[0];
          return row === undefined ? null : yield* decode(row);
        },
      );

      return ConnectorApprovalStore.of({
        propose: (input) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const id = randomUUID();
              const now = yield* DateTime.now;
              const expiresAt = DateTime.add(now, { minutes: 15 });
              yield* sql`
                INSERT INTO ronto_tool_call (
                  id, run_id, provider_call_id, tool_name, status, input_json,
                  idempotency_key, created_at, family_member_id,
                  connector_connection_id, connector_action_id,
                  approval_title, approval_description
                ) VALUES (
                  ${id}, ${input.runId}, ${id}, 'execute_action',
                  'waiting_for_approval', ${JSON.stringify(input.input)}, ${id},
                  ${DateTime.formatIso(now)}, ${input.memberId},
                  ${input.connectionId}, ${input.actionId}, ${input.title},
                  ${input.description}
                )
              `;
              yield* sql`
                INSERT INTO ronto_tool_approval (
                  tool_call_id, status, requested_at, expires_at,
                  execution_status, origin
                ) VALUES (
                  ${id}, 'pending', ${DateTime.formatIso(now)},
                  ${DateTime.formatIso(expiresAt)}, 'pending', ${input.origin}
                )
              `;
              const approval = yield* findOwned(input.memberId, id);
              if (approval === null) return yield* Effect.die("Created approval could not be read");
              return approval;
            }),
          ),
        list: (memberId) =>
          expire().pipe(
            Effect.andThen(
              sql`
                SELECT ${sql.unsafe(selectApproval)}
                FROM ronto_tool_call call
                JOIN ronto_agent_run run ON run.id = call.run_id
                JOIN ronto_tool_approval approval ON approval.tool_call_id = call.id
                WHERE call.family_member_id = ${memberId}
                ORDER BY call.created_at DESC, call.id DESC
                LIMIT 100
              `,
            ),
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) => decode(row))
            ),
          ),
        find: findOwned,
        decide: (memberId, approvalId, decision) =>
          sql.withTransaction(
            Effect.gen(function* () {
              yield* expire();
              const now = DateTime.formatIso(yield* DateTime.now);
              const rows = yield* sql`
                UPDATE ronto_tool_approval
                SET status = ${decision}, decided_by_member_id = ${memberId},
                  decided_at = ${now}
                WHERE tool_call_id = ${approvalId} AND status = 'pending'
                  AND expires_at > ${now}
                  AND EXISTS (
                    SELECT 1 FROM ronto_tool_call call
                    WHERE call.id = tool_call_id
                      AND call.family_member_id = ${memberId}
                  )
                RETURNING tool_call_id
              `;
              if (rows.length === 0) {
                const existing = yield* findOwned(memberId, approvalId);
                if (
                  existing === null ||
                  existing.approvalStatus !== decision
                ) return null;
                return { approval: existing, claimed: false };
              }
              yield* sql`
                UPDATE ronto_tool_call
                SET status = ${decision === "approved" ? "running" : "cancelled"},
                  started_at = ${decision === "approved" ? now : null},
                  completed_at = ${decision === "rejected" ? now : null}
                WHERE id = ${approvalId} AND status = 'waiting_for_approval'
              `;
              yield* sql`
                UPDATE ronto_tool_approval
                SET execution_status = ${decision === "approved" ? "running" : "failed"}
                WHERE tool_call_id = ${approvalId}
              `;
              if (decision === "rejected") {
                yield* recordResult(approvalId, "rejected");
              }
              const approval = yield* findOwned(memberId, approvalId);
              if (approval === null) return yield* Effect.die("Decided approval could not be read");
              return { approval, claimed: true };
            }),
          ),
        complete: (approvalId, result) =>
          sql.withTransaction(Effect.gen(function* () {
            const now = DateTime.formatIso(yield* DateTime.now);
            yield* sql`
              UPDATE ronto_tool_call
              SET status = ${result.status === "outcome_unknown" ? "failed" : result.status},
                output_json = ${result.status === "succeeded" ? JSON.stringify(result.output) : null},
                error_json = ${result.status !== "succeeded" ? JSON.stringify(result.error) : null},
                completed_at = ${now}
              WHERE id = ${approvalId} AND status = 'running'
            `;
            yield* sql`
              UPDATE ronto_tool_approval
              SET execution_status = ${result.status}
              WHERE tool_call_id = ${approvalId} AND execution_status = 'running'
            `;
            yield* recordResult(approvalId, result.status);
          })),
        recoverInterrupted: () =>
          sql<{ approvalId: string }>`
            SELECT tool_call_id AS approval_id
            FROM ronto_tool_approval
            WHERE execution_status = 'running'
          `.pipe(
            Effect.flatMap((rows) =>
              Effect.forEach(rows, ({ approvalId }) =>
                sql.withTransaction(Effect.gen(function* () {
                  const now = DateTime.formatIso(yield* DateTime.now);
                  yield* sql`
                    UPDATE ronto_tool_call
                    SET status = 'failed',
                      error_json = ${JSON.stringify({ message: "Execution was interrupted; the provider outcome is unknown" })},
                      completed_at = ${now}
                    WHERE id = ${approvalId} AND status = 'running'
                  `;
                  yield* sql`
                    UPDATE ronto_tool_approval
                    SET execution_status = 'outcome_unknown'
                    WHERE tool_call_id = ${approvalId}
                      AND execution_status = 'running'
                  `;
                  yield* recordResult(approvalId, "outcome_unknown");
                })),
                { discard: true },
              )
            ),
          ),
      });
    }),
  );
}
