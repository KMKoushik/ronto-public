import { type AgentRunId, type FamilyMemberId } from "@ronto/api";
import { Context, Effect, Layer, Schema } from "effect";

import {
  connectorApprovalSummary,
  requiresConnectorApproval,
} from "./connector-approval-policy.ts";
import {
  ConnectorApprovalStore,
  type ConnectorApproval,
} from "./connector-approval-store.ts";
import {
  ConnectorService,
  ConnectorServiceError,
} from "./connector-service.ts";
import { OpenConnectorClientError } from "./open-connector-client.ts";

export class ConnectorApprovalError extends Schema.TaggedError<ConnectorApprovalError>()(
  "ConnectorApprovalError",
  {
    reason: Schema.Literals(["not_found", "execution_failed", "store_failed"]),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export interface RequestConnectorAction {
  readonly runId: AgentRunId;
  readonly memberId: FamilyMemberId;
  readonly connectionId: string;
  readonly actionId: string;
  readonly input: Schema.JsonObject;
  readonly idempotencyKey: string;
  readonly origin: "web" | "whatsapp";
}

export type ConnectorActionResult =
  | { readonly kind: "executed"; readonly output: Schema.Json }
  | { readonly kind: "approval_required"; readonly approval: ConnectorApproval };

export interface ConnectorApprovalResolution {
  readonly approval: ConnectorApproval;
  readonly outcome:
    | "rejected"
    | "running"
    | "succeeded"
    | "failed"
    | "outcome_unknown";
}

export class ConnectorApprovals extends Context.Service<
  ConnectorApprovals,
  {
    readonly request: (
      input: RequestConnectorAction,
    ) => Effect.Effect<ConnectorActionResult, ConnectorServiceError | ConnectorApprovalError>;
    readonly list: (
      memberId: FamilyMemberId,
    ) => Effect.Effect<ReadonlyArray<ConnectorApproval>, ConnectorApprovalError>;
    readonly resolve: (
      memberId: FamilyMemberId,
      approvalId: string,
      decision: "approved" | "rejected",
    ) => Effect.Effect<ConnectorApprovalResolution, ConnectorApprovalError>;
  }
>()("ronto/connectors/ConnectorApprovals") {
  static readonly layer = Layer.effect(
    ConnectorApprovals,
    Effect.gen(function* () {
      const connector = yield* ConnectorService;
      const store = yield* ConnectorApprovalStore;
      yield* store.recoverInterrupted().pipe(Effect.orDie);
      const storeError = (cause: unknown) =>
        new ConnectorApprovalError({
          reason: "store_failed",
          message: "The connector approval could not be saved",
          cause,
        });
      const outcomeUnknown = (error: ConnectorServiceError): boolean =>
        error.reason === "gateway_failed" &&
        error.cause instanceof OpenConnectorClientError &&
        (error.cause.status === null || error.cause.status >= 500);
      return ConnectorApprovals.of({
        request: Effect.fn("ConnectorApprovals.request")(function* (input) {
          if (!requiresConnectorApproval(input.actionId)) {
            return {
              kind: "executed",
              output: yield* connector.execute(
                input.memberId,
                input.connectionId,
                input.actionId,
                input.input,
                input.idempotencyKey,
              ),
            } as const;
          }
          yield* connector.validateInput(
            input.memberId,
            input.connectionId,
            input.actionId,
            input.input,
          );
          const summary = connectorApprovalSummary(input.actionId, input.input);
          const approval = yield* store.propose({
            runId: input.runId,
            memberId: input.memberId,
            connectionId: input.connectionId,
            actionId: input.actionId,
            input: input.input,
            origin: input.origin,
            ...summary,
          }).pipe(Effect.mapError(storeError));
          return { kind: "approval_required", approval } as const;
        }),
        list: (memberId) =>
          store.list(memberId).pipe(Effect.mapError(storeError)),
        resolve: Effect.fn("ConnectorApprovals.resolve")(function* (
          memberId,
          approvalId,
          decision,
        ) {
          const decided = yield* store
            .decide(memberId, approvalId, decision)
            .pipe(Effect.mapError(storeError));
          if (decided === null) {
            return yield* new ConnectorApprovalError({
              reason: "not_found",
              message: "This approval is unavailable or has expired",
              cause: null,
            });
          }
          const approval = decided.approval;
          if (decision === "rejected") {
            return { approval, outcome: "rejected" } as const;
          }
          if (!decided.claimed) {
            const outcome = approval.executionStatus === "succeeded"
              ? "succeeded"
              : approval.executionStatus === "failed"
                ? "failed"
                : approval.executionStatus === "outcome_unknown"
                  ? "outcome_unknown"
                  : "running";
            return { approval, outcome } as const;
          }
          const result = yield* connector
            .execute(
              memberId,
              approval.connectionId,
              approval.actionId,
              approval.inputJson,
              approval.id,
            )
            .pipe(
              Effect.match({
                onFailure: (error) => ({ kind: "failure" as const, error }),
                onSuccess: (output) => ({ kind: "success" as const, output }),
              }),
            );
          if (result.kind === "failure") {
            const status = outcomeUnknown(result.error)
              ? "outcome_unknown" as const
              : "failed" as const;
            yield* store.complete(approval.id, {
              status,
              error: { message: result.error.message },
            }).pipe(Effect.mapError(storeError));
            return { approval, outcome: status } as const;
          }
          yield* store.complete(approval.id, {
            status: "succeeded",
            output: result.output,
          }).pipe(Effect.mapError(storeError));
          return { approval, outcome: "succeeded" } as const;
        }),
      });
    }),
  );
}
