import { Cause, Context, DateTime, Effect, Layer, Schema } from "effect";
import { SqlClient } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { randomUUID } from "node:crypto";
import { ConversationId, FamilyId } from "@ronto/api";

type Id = string;
type StoreError = SqlError | Cause.NoSuchElementError | Schema.SchemaError;
type ClaimKind = "identity" | "conversation";
type TriggerKind = "dm" | "mention" | "reply" | "command" | "context";

const ClaimRow = Schema.Struct({
  id: Schema.String,
  kind: Schema.Literals(["identity", "conversation"]),
  tokenHash: Schema.String,
  familyMemberId: Schema.NullOr(Schema.String),
  conversationId: Schema.NullOr(Schema.String),
  createdByMemberId: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  claimedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});

const InboxRow = Schema.Struct({
  id: Schema.String,
  externalChannelId: Schema.String,
  externalMessageId: Schema.String,
  senderExternalId: Schema.String,
  senderExternalName: Schema.NullOr(Schema.String),
  senderMemberId: Schema.NullOr(Schema.String),
  authorityMemberId: Schema.String,
  inboundFileId: Schema.NullOr(Schema.String),
  inboundCaption: Schema.NullOr(Schema.String),
  conversationId: Schema.String,
  text: Schema.String,
  responseMode: Schema.Literals(["required", "optional"]),
  triggerKind: Schema.Literals([
    "dm",
    "mention",
    "reply",
    "command",
    "context",
  ]),
  status: Schema.Literals([
    "queued",
    "processing",
    "responded",
    "silent",
    "failed",
  ]),
  canonicalMessageId: Schema.NullOr(Schema.String),
  runId: Schema.NullOr(Schema.String),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

const OutboxRow = Schema.Struct({
  id: Schema.String,
  inboxId: Schema.String,
  assistantMessageId: Schema.String,
  externalChannelId: Schema.String,
  sourceExternalMessageId: Schema.String,
  sourceSenderExternalId: Schema.String,
  sourceText: Schema.String,
  partIndex: Schema.Int,
  deliveryKind: Schema.Literals(["text", "file"]),
  approvalId: Schema.NullOr(Schema.String),
  fileId: Schema.NullOr(Schema.String),
  fileChannelId: Schema.NullOr(Schema.String),
  fileStoragePath: Schema.NullOr(Schema.String),
  fileName: Schema.NullOr(Schema.String),
  fileMediaType: Schema.NullOr(Schema.String),
  fileByteSize: Schema.NullOr(Schema.Int),
  fileChecksum: Schema.NullOr(Schema.String),
  text: Schema.String,
  providerMessageId: Schema.NullOr(Schema.String),
  status: Schema.Literals(["pending", "sending", "sent", "failed"]),
  attemptCount: Schema.Int,
  nextAttemptAt: Schema.DateTimeUtcFromString,
  lastError: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

const IdentityRow = Schema.Struct({
  id: Schema.String,
  externalUserId: Schema.String,
  displayName: Schema.NullOr(Schema.String),
});
const DmFamilyRow = Schema.Struct({
  familyId: FamilyId,
  familyName: Schema.String,
  code: Schema.String,
  selected: Schema.BooleanFromBit,
  conversationId: Schema.NullOr(ConversationId),
});

const BindingRow = Schema.Struct({
  id: Schema.String,
  conversationId: Schema.String,
  externalChannelId: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});

const MediaReceiptRow = Schema.Struct({
  id: Schema.String,
  externalChannelId: Schema.String,
  externalMessageId: Schema.String,
  senderExternalId: Schema.String,
  senderExternalName: Schema.NullOr(Schema.String),
  authorityMemberId: Schema.String,
  senderMemberId: Schema.NullOr(Schema.String),
  conversationId: Schema.String,
  caption: Schema.String,
  fileId: Schema.NullOr(Schema.String),
  inboxId: Schema.NullOr(Schema.String),
  responseMode: Schema.Literals(["required", "optional"]),
  triggerKind: Schema.Literals(["dm", "mention", "reply", "command", "context"]),
  status: Schema.Literals(["receiving", "retryable", "queued", "failed"]),
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});

const InboundFileRow = Schema.Struct({
  fileId: Schema.String,
  channelId: Schema.String,
  storagePath: Schema.String,
});

const ReceivingMediaRow = Schema.Struct({
  receiptId: Schema.String,
  fileId: Schema.NullOr(Schema.String),
  channelId: Schema.NullOr(Schema.String),
  storagePath: Schema.NullOr(Schema.String),
});

const EnqueueAuthorizationRow = Schema.Struct({
  conversationId: Schema.String,
  senderMemberId: Schema.NullOr(Schema.String),
  authorityMemberId: Schema.String,
});
const ResolvedApprovalResultRow = Schema.Struct({
  messageId: Schema.String,
  text: Schema.String,
});

const NewConversationContextRow = Schema.Struct({
  familyId: Schema.String,
  familyMemberId: Schema.String,
});

export type WhatsappClaim = typeof ClaimRow.Type;
export type WhatsappInbox = typeof InboxRow.Type;
export type WhatsappOutbox = typeof OutboxRow.Type;
export type WhatsappIdentity = typeof IdentityRow.Type;
export type WhatsappDmFamily = typeof DmFamilyRow.Type;
export type WhatsappBinding = typeof BindingRow.Type;
export type WhatsappMediaReceipt = typeof MediaReceiptRow.Type;
export type WhatsappInboundFile = typeof InboundFileRow.Type;
export type WhatsappReceivingMedia = typeof ReceivingMediaRow.Type;

export interface EnqueueInput {
  readonly id?: Id;
  readonly externalChannelId: string;
  readonly externalMessageId: string;
  readonly senderAliases: ReadonlyArray<string>;
  readonly senderExternalId: string;
  readonly senderExternalName: string | null;
  readonly group: boolean;
  readonly text: string;
  readonly responseMode: "required" | "optional";
  readonly triggerKind: TriggerKind;
  readonly at?: DateTime.Utc;
}

export interface OutboxDeliveriesInput {
  readonly inboxId: Id;
  readonly assistantMessageId: Id;
  readonly externalChannelId: string;
  readonly deliveries: ReadonlyArray<
    | { readonly id?: Id; readonly kind: "text"; readonly text: string }
    | { readonly id?: Id; readonly kind: "file"; readonly fileId: Id }
    | {
        readonly id?: Id;
        readonly kind: "approval";
        readonly approvalId: Id;
        readonly text: string;
      }
  >;
  readonly at?: DateTime.Utc;
}

export interface CreateInboundFileInput {
  readonly receiptId: Id;
  readonly fileId: Id;
  readonly name: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
  readonly at?: DateTime.Utc;
}

const storageName = (name: string): string => {
  const safe = name
    .trim()
    .replace(/^[./\\]+/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 200);
  return safe || "file";
};

export interface AuthUpdate {
  readonly category: string;
  readonly key: string;
  readonly valueJson: string | null;
}

const selectClaim = `
  id, kind, token_hash, family_member_id, conversation_id,
  created_by_member_id, created_at, expires_at, claimed_at
`;
const selectInbox = `
  id, external_channel_id, external_message_id, sender_external_id,
  sender_external_name, linked_sender_member_id AS sender_member_id,
  sender_member_id AS authority_member_id, inbound_file_id, inbound_caption,
  conversation_id, text, response_mode, trigger_kind,
  status, canonical_message_id, run_id, error, created_at, updated_at
`;
const selectOutbox = `
  id, inbox_id, assistant_message_id, external_channel_id, part_index,
  delivery_kind, file_id, approval_id, text, provider_message_id, status, attempt_count, next_attempt_at,
  last_error, created_at, updated_at,
  (SELECT external_message_id FROM ronto_whatsapp_inbox source WHERE source.id = inbox_id)
    AS source_external_message_id,
  (SELECT sender_external_id FROM ronto_whatsapp_inbox source WHERE source.id = inbox_id)
    AS source_sender_external_id,
  (SELECT text FROM ronto_whatsapp_inbox source WHERE source.id = inbox_id)
    AS source_text,
  (SELECT channel_id FROM ronto_file managed WHERE managed.id = file_id)
    AS file_channel_id,
  (SELECT storage_path FROM ronto_file managed WHERE managed.id = file_id)
    AS file_storage_path,
  (SELECT name FROM ronto_file managed WHERE managed.id = file_id)
    AS file_name,
  (SELECT media_type FROM ronto_file managed WHERE managed.id = file_id)
    AS file_media_type,
  (SELECT byte_size FROM ronto_file managed WHERE managed.id = file_id)
    AS file_byte_size,
  (SELECT checksum FROM ronto_file managed WHERE managed.id = file_id)
    AS file_checksum
`;
const selectMediaReceipt = `
  id, external_channel_id, external_message_id, sender_external_id,
  sender_external_name, authority_member_id,
  linked_sender_member_id AS sender_member_id, conversation_id, caption,
  file_id, inbox_id, response_mode, trigger_kind, status, error,
  created_at, updated_at
`;

export class WhatsappStore extends Context.Service<
  WhatsappStore,
  {
    readonly createIdentityClaim: (
      requesterId: Id,
      claimId: Id,
      memberId: Id,
      tokenHash: string,
      expiresAt: DateTime.Utc,
    ) => Effect.Effect<WhatsappClaim, StoreError>;
    readonly createBindingClaim: (
      requesterId: Id,
      claimId: Id,
      conversationId: Id,
      tokenHash: string,
      expiresAt: DateTime.Utc,
    ) => Effect.Effect<WhatsappClaim, StoreError>;
    readonly claimIdentity: (
      tokenHash: string,
      aliases: ReadonlyArray<string>,
    ) => Effect.Effect<WhatsappClaim, StoreError>;
    readonly claimBinding: (
      tokenHash: string,
      senderAliases: ReadonlyArray<string>,
      externalChannelId: string,
    ) => Effect.Effect<WhatsappClaim, StoreError>;
    readonly listIdentities: (
      requesterId: Id,
    ) => Effect.Effect<ReadonlyArray<WhatsappIdentity>, StoreError>;
    readonly revokeIdentity: (
      requesterId: Id,
      identityId: Id,
    ) => Effect.Effect<void, StoreError>;
    readonly listDmFamilies: (
      senderAliases: ReadonlyArray<string>,
    ) => Effect.Effect<ReadonlyArray<WhatsappDmFamily>, StoreError>;
    readonly listMemberDmFamilies: (
      requesterId: Id,
    ) => Effect.Effect<ReadonlyArray<WhatsappDmFamily>, StoreError>;
    readonly selectDmFamily: (
      requesterId: Id,
    ) => Effect.Effect<WhatsappDmFamily, StoreError>;
    readonly selectDmFamilyByCode: (
      senderAliases: ReadonlyArray<string>,
      code: string,
    ) => Effect.Effect<WhatsappDmFamily, StoreError>;
    readonly findLinkedMemberId: (
      senderAliases: ReadonlyArray<string>,
      approvalId: Id,
    ) => Effect.Effect<string | null, StoreError>;
    readonly findApprovalIdForReply: (
      externalChannelId: string,
      providerMessageId: string,
    ) => Effect.Effect<string | null, StoreError>;
    readonly listBindings: (
      requesterId: Id,
      conversationId: Id,
    ) => Effect.Effect<ReadonlyArray<WhatsappBinding>, StoreError>;
    readonly removeBinding: (
      requesterId: Id,
      conversationId: Id,
      bindingId: Id,
    ) => Effect.Effect<boolean, StoreError>;
    readonly startConversation: (
      senderAliases: ReadonlyArray<string>,
      externalChannelId: string,
      externalMessageId: string,
      group: boolean,
    ) => Effect.Effect<boolean, StoreError>;
    readonly enqueue: (
      input: EnqueueInput,
    ) => Effect.Effect<WhatsappInbox, StoreError>;
    readonly reserveMedia: (
      input: EnqueueInput,
    ) => Effect.Effect<{
      readonly receipt: WhatsappMediaReceipt;
      readonly inserted: boolean;
    }, StoreError>;
    readonly createInboundFile: (
      input: CreateInboundFileInput,
    ) => Effect.Effect<WhatsappInboundFile, StoreError>;
    readonly queueInboundMedia: (
      receiptId: Id,
      fallbackText: string,
    ) => Effect.Effect<WhatsappInbox, StoreError>;
    readonly listReceivingMedia: () => Effect.Effect<
      ReadonlyArray<WhatsappReceivingMedia>,
      StoreError
    >;
    readonly failReceivingMedia: (
      receiptId: Id,
      error: string,
      retryable: boolean,
    ) => Effect.Effect<void, StoreError>;
    readonly claimNext: () => Effect.Effect<WhatsappInbox | null, StoreError>;
    readonly markCanonical: (
      inboxId: Id,
      messageId: Id,
    ) => Effect.Effect<void, StoreError>;
    readonly markRun: (
      inboxId: Id,
      runId: Id,
    ) => Effect.Effect<void, StoreError>;
    readonly markSilent: (inboxId: Id) => Effect.Effect<void, StoreError>;
    readonly markFailed: (
      inboxId: Id,
      error: string,
      notifyOptional?: boolean,
    ) => Effect.Effect<void, StoreError>;
    readonly failInterrupted: () => Effect.Effect<number, StoreError>;
    readonly resetSendingOutbox: () => Effect.Effect<void, StoreError>;
    readonly completeResponded: (
      input: OutboxDeliveriesInput,
    ) => Effect.Effect<ReadonlyArray<WhatsappOutbox>, StoreError>;
    readonly claimDueOutbox: (
      at?: DateTime.Utc,
    ) => Effect.Effect<WhatsappOutbox | null, StoreError>;
    readonly markOutboxSent: (
      id: Id,
      providerMessageId: string,
    ) => Effect.Effect<void, StoreError>;
    readonly retryOutbox: (
      id: Id,
      error: string,
      nextAttemptAt: DateTime.Utc,
    ) => Effect.Effect<void, StoreError>;
    readonly failOutbox: (
      id: Id,
      error: string,
    ) => Effect.Effect<void, StoreError>;
    readonly loadAuth: (
      category: string,
      key: string,
    ) => Effect.Effect<string | null, StoreError>;
    readonly saveAuth: (
      category: string,
      key: string,
      valueJson: string,
      at?: DateTime.Utc,
    ) => Effect.Effect<void, StoreError>;
    readonly deleteAuth: (
      category: string,
      key: string,
    ) => Effect.Effect<void, StoreError>;
    readonly updateAuth: (
      updates: ReadonlyArray<AuthUpdate>,
      at?: DateTime.Utc,
    ) => Effect.Effect<void, StoreError>;
    readonly clearAuth: () => Effect.Effect<void, StoreError>;
  }
>()("ronto/db/WhatsappStore") {
  static readonly layer = Layer.effect(
    WhatsappStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const decodeClaim = Schema.decodeUnknownEffect(ClaimRow);
      const decodeInbox = Schema.decodeUnknownEffect(InboxRow);
      const decodeOutbox = Schema.decodeUnknownEffect(OutboxRow);
      const decodeResolvedApprovalResult = Schema.decodeUnknownEffect(
        ResolvedApprovalResultRow,
      );
      const decodeIdentity = Schema.decodeUnknownEffect(IdentityRow);
      const decodeDmFamily = Schema.decodeUnknownEffect(DmFamilyRow);
      const decodeBinding = Schema.decodeUnknownEffect(BindingRow);
      const decodeMediaReceipt = Schema.decodeUnknownEffect(MediaReceiptRow);
      const decodeInboundFile = Schema.decodeUnknownEffect(InboundFileRow);
      const decodeReceivingMedia = Schema.decodeUnknownEffect(ReceivingMediaRow);
      const notFound = () => new Cause.NoSuchElementError();
      const iso = DateTime.formatIso;

      const enqueueFailureNotice = Effect.fn("WhatsappStore.enqueueFailureNotice")(
        function* (inbox: WhatsappInbox, text: string, at: DateTime.Utc, notifyOptional = false) {
          if (inbox.responseMode !== "required" && !notifyOptional) return;
          const messageId = randomUUID();
          yield* sql`
            INSERT INTO ronto_message (
              id, conversation_id, sequence, sender_type, sender_member_id,
              reply_to_message_id, content_json, created_at
            )
            SELECT ${messageId}, ${inbox.conversationId},
              COALESCE(MAX(sequence), 0) + 1, 'agent', NULL,
              ${inbox.canonicalMessageId},
              ${JSON.stringify({ version: 1, blocks: [{ type: "text", text }] })},
              ${iso(at)}
            FROM ronto_message WHERE conversation_id = ${inbox.conversationId}
          `;
          yield* sql`
            INSERT INTO ronto_whatsapp_outbox (
              id, inbox_id, assistant_message_id, external_channel_id,
              part_index, delivery_kind, text, status,
              attempt_count, next_attempt_at, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${inbox.id}, ${messageId}, ${inbox.externalChannelId},
              0, 'text', ${text}, 'pending', 0, ${iso(at)}, ${iso(at)}, ${iso(at)}
            )
          `;
        },
      );

      const selectDmFamilyForMember = Effect.fn("WhatsappStore.selectDmFamilyForMember")(
        function* (memberId: Id, at: DateTime.Utc) {
          const contexts = yield* sql`
            SELECT member.family_id, member.id AS family_member_id
            FROM ronto_family_member member
            WHERE member.id = ${memberId}
            LIMIT 1
          `;
          const row = contexts[0];
          if (row === undefined) return yield* notFound();
          const context = yield* Schema.decodeUnknownEffect(NewConversationContextRow)(row);
          const users = yield* sql<{ userId: string }>`
            SELECT user_id FROM ronto_family_member WHERE id = ${memberId}
          `;
          const userId = users[0]?.userId;
          if (userId === undefined) return yield* notFound();
          const now = iso(at);
          let personalChannels = yield* sql<{ channelId: string }>`
            SELECT id AS channel_id FROM ronto_channel
            WHERE personal_owner_member_id = ${memberId}
          `;
          if (personalChannels.length === 0) {
            const channelId = randomUUID();
            yield* sql`INSERT INTO ronto_channel (
              id, family_id, name, purpose, is_default, created_at, updated_at,
              personal_owner_member_id
            ) VALUES (
              ${channelId}, ${context.familyId}, ${`Personal ${memberId}`},
              'Personal direct conversations', 0, ${now}, ${now}, ${memberId}
            )`;
            yield* sql`INSERT INTO ronto_channel_member (
              channel_id, family_member_id, joined_at
            ) VALUES (${channelId}, ${memberId}, ${now})`;
            personalChannels = [{ channelId }];
          }
          const channelId = personalChannels[0]?.channelId;
          if (channelId === undefined) return yield* notFound();
          const existing = yield* sql<{ conversationId: string }>`
            SELECT selection.conversation_id
            FROM ronto_whatsapp_dm_selection selection
            JOIN ronto_conversation conversation
              ON conversation.id = selection.conversation_id
              AND conversation.status = 'active'
              AND conversation.channel_id = ${channelId}
            JOIN ronto_conversation_member participant
              ON participant.conversation_id = conversation.id
              AND participant.family_member_id = ${memberId}
              AND participant.left_at IS NULL
            WHERE selection.user_id = ${userId}
              AND selection.family_id = ${context.familyId}
          `;
          let conversationId = existing[0]?.conversationId;
          if (conversationId === undefined) {
            conversationId = randomUUID();
            yield* sql`INSERT INTO ronto_conversation (
              id, family_id, title, status, created_by_member_id,
              created_at, updated_at, archived_at, channel_id
            ) VALUES (
              ${conversationId}, ${context.familyId}, NULL, 'active',
              ${memberId}, ${now}, ${now}, NULL, ${channelId}
            )`;
            yield* sql`INSERT INTO ronto_conversation_member (
              conversation_id, family_member_id, joined_at
            ) VALUES (${conversationId}, ${memberId}, ${now})`;
          }
          yield* sql`INSERT INTO ronto_whatsapp_dm_selection (
            user_id, family_id, conversation_id, updated_at
          ) VALUES (${userId}, ${context.familyId}, ${conversationId}, ${iso(at)})
          ON CONFLICT (user_id) DO UPDATE SET
            family_id = excluded.family_id,
            conversation_id = excluded.conversation_id,
            updated_at = excluded.updated_at`;
          const selected = yield* sql`
            SELECT family.id AS family_id, family.name AS family_name,
              substr(family.id, 1, 8) AS code, 1 AS selected,
              ${conversationId} AS conversation_id
            FROM ronto_family family WHERE family.id = ${context.familyId}
          `;
          const selectedRow = selected[0];
          if (selectedRow === undefined) return yield* notFound();
          return yield* decodeDmFamily(selectedRow);
        },
      );

      const listDmFamiliesForUser = Effect.fn("WhatsappStore.listDmFamiliesForUser")(
        function* (userId: Id) {
          const rows = yield* sql`
            SELECT family.id AS family_id, family.name AS family_name,
              substr(family.id, 1, 8) AS code,
              CASE WHEN selection.family_id = family.id THEN 1 ELSE 0 END AS selected,
              CASE WHEN selection.family_id = family.id THEN selection.conversation_id ELSE NULL END AS conversation_id
            FROM ronto_family_member member
            JOIN ronto_family family ON family.id = member.family_id
            LEFT JOIN ronto_whatsapp_dm_selection selection
              ON selection.user_id = member.user_id
            WHERE member.user_id = ${userId}
            ORDER BY family.name, family.id
          `;
          return yield* Effect.forEach(rows, (row) => decodeDmFamily(row));
        },
      );

      const linkedUserId = Effect.fn("WhatsappStore.linkedUserId")(
        function* (aliases: ReadonlyArray<string>) {
          const uniqueAliases = [...new Set(aliases)];
          if (uniqueAliases.length === 0) return yield* notFound();
          const rows = yield* sql<{ userId: string }>`
            SELECT DISTINCT user_id FROM ronto_external_identity
            WHERE adapter = 'whatsapp'
              AND external_user_id IN ${sql.in(uniqueAliases)}
          `;
          if (rows.length !== 1 || rows[0] === undefined) return yield* notFound();
          return rows[0].userId;
        },
      );

      const authorizeInbound = Effect.fn("WhatsappStore.authorizeInbound")(
        function* (input: EnqueueInput) {
          const aliases = [...new Set(input.senderAliases)];
          if (aliases.length === 0) return yield* notFound();
          const identities = yield* sql<{ userId: string }>`
            SELECT DISTINCT user_id
            FROM ronto_external_identity
            WHERE adapter = 'whatsapp'
              AND external_user_id IN ${sql.in(aliases)}
          `;
          if (identities.length > 1) return yield* notFound();
          const linkedUserId = identities[0]?.userId;
          const matches = linkedUserId === undefined
            ? input.group
              ? yield* sql`
                  SELECT
                    binding.conversation_id,
                    NULL AS sender_member_id,
                    authority.id AS authority_member_id
                  FROM ronto_conversation_binding binding
                  JOIN ronto_conversation conversation
                    ON conversation.id = binding.conversation_id
                    AND conversation.status = 'active'
                  JOIN ronto_family_member authority
                    ON authority.family_id = conversation.family_id
                    AND authority.role = 'primary'
                  JOIN ronto_channel_member channel_membership
                    ON channel_membership.channel_id = conversation.channel_id
                    AND channel_membership.family_member_id = authority.id
                    AND channel_membership.left_at IS NULL
                  JOIN ronto_conversation_member conversation_membership
                    ON conversation_membership.conversation_id = conversation.id
                    AND conversation_membership.family_member_id = authority.id
                    AND conversation_membership.left_at IS NULL
                  WHERE binding.adapter = 'whatsapp'
                    AND binding.external_channel_id = ${input.externalChannelId}
                  ORDER BY authority.id
                  LIMIT 1
                `
              : []
            : input.group
              ? yield* sql`
                SELECT
                  binding.conversation_id,
                  member.id AS sender_member_id,
                  member.id AS authority_member_id
                FROM ronto_conversation_binding binding
                JOIN ronto_conversation conversation
                  ON conversation.id = binding.conversation_id
                  AND conversation.status = 'active'
                JOIN ronto_family_member member
                  ON member.user_id = ${linkedUserId}
                  AND member.family_id = conversation.family_id
                JOIN ronto_channel_member channel_membership
                  ON channel_membership.channel_id = conversation.channel_id
                  AND channel_membership.family_member_id = member.id
                  AND channel_membership.left_at IS NULL
                JOIN ronto_conversation_member conversation_membership
                  ON conversation_membership.conversation_id = conversation.id
                  AND conversation_membership.family_member_id = member.id
                  AND conversation_membership.left_at IS NULL
                WHERE binding.adapter = 'whatsapp'
                  AND binding.external_channel_id = ${input.externalChannelId}
                LIMIT 1
              `
              : yield* sql`
                  SELECT selection.conversation_id,
                    member.id AS sender_member_id,
                    member.id AS authority_member_id
                  FROM ronto_whatsapp_dm_selection selection
                  JOIN ronto_conversation conversation
                    ON conversation.id = selection.conversation_id
                    AND conversation.family_id = selection.family_id
                    AND conversation.status = 'active'
                  JOIN ronto_family_member member
                    ON member.user_id = selection.user_id
                    AND member.family_id = selection.family_id
                  JOIN ronto_channel_member channel_membership
                    ON channel_membership.channel_id = conversation.channel_id
                    AND channel_membership.family_member_id = member.id
                    AND channel_membership.left_at IS NULL
                  JOIN ronto_conversation_member conversation_membership
                    ON conversation_membership.conversation_id = conversation.id
                    AND conversation_membership.family_member_id = member.id
                    AND conversation_membership.left_at IS NULL
                  WHERE selection.user_id = ${linkedUserId}
                  LIMIT 1
                `;
          const match = matches[0];
          if (match === undefined) return yield* notFound();
          return yield* Schema.decodeUnknownEffect(EnqueueAuthorizationRow)(match);
        },
      );

      const startLinkedSession = Effect.fn("WhatsappStore.startLinkedSession")(function* (
        previousConversationId: string,
        memberId: string,
        group: boolean,
        externalChannelId: string,
        at: DateTime.Utc,
      ) {
        const conversationId = randomUUID();
        yield* sql`INSERT INTO ronto_conversation (
          id, family_id, channel_id, title, status, created_by_member_id,
          created_at, updated_at, archived_at, previous_conversation_id
        ) SELECT ${conversationId}, family_id, channel_id, NULL, 'active',
          ${memberId}, ${iso(at)}, ${iso(at)}, NULL, id
          FROM ronto_conversation WHERE id = ${previousConversationId}`;
        yield* sql`INSERT INTO ronto_conversation_member (
          conversation_id, family_member_id, joined_at
        ) SELECT ${conversationId}, participant.family_member_id, ${iso(at)}
          FROM ronto_channel_member participant
          JOIN ronto_conversation conversation ON conversation.channel_id = participant.channel_id
          WHERE conversation.id = ${conversationId} AND participant.left_at IS NULL`;
        const requestedAt = iso(at);
        const summaryReadyAt = iso(DateTime.add(at, { seconds: 5 }));
        yield* sql`INSERT INTO ronto_conversation_summary (
          conversation_id, requested_through_sequence, status, attempt_count,
          next_attempt_at, created_at, updated_at
        ) SELECT ${previousConversationId}, candidate.last_sequence, 'pending', 0,
            ${summaryReadyAt}, ${requestedAt}, ${requestedAt}
          FROM (SELECT MAX(message.sequence) AS last_sequence
            FROM ronto_message message
            WHERE message.conversation_id = ${previousConversationId}
              AND EXISTS (SELECT 1 FROM json_each(message.content_json, '$.blocks') block
                WHERE json_extract(block.value, '$.type') IN ('text', 'file'))
          ) candidate WHERE candidate.last_sequence IS NOT NULL
          ON CONFLICT(conversation_id) DO UPDATE SET
            requested_through_sequence = max(requested_through_sequence, excluded.requested_through_sequence),
            status = CASE WHEN excluded.requested_through_sequence > requested_through_sequence
              THEN 'pending' ELSE status END,
            attempt_count = CASE WHEN excluded.requested_through_sequence > requested_through_sequence
              THEN 0 ELSE attempt_count END,
            next_attempt_at = CASE WHEN excluded.requested_through_sequence > requested_through_sequence
              THEN excluded.next_attempt_at ELSE next_attempt_at END,
            claimed_at = CASE WHEN excluded.requested_through_sequence > requested_through_sequence
              THEN NULL ELSE claimed_at END,
            last_error = CASE WHEN excluded.requested_through_sequence > requested_through_sequence
              THEN NULL ELSE last_error END,
            updated_at = CASE WHEN excluded.requested_through_sequence > requested_through_sequence
              THEN excluded.updated_at ELSE updated_at END`;
        if (group) {
          yield* sql`UPDATE ronto_conversation_binding
            SET conversation_id = ${conversationId}, created_at = ${iso(at)}
            WHERE adapter = 'whatsapp' AND external_channel_id = ${externalChannelId}
              AND external_thread_id = '' AND conversation_id = ${previousConversationId}`;
        } else {
          yield* sql`UPDATE ronto_whatsapp_dm_selection
            SET conversation_id = ${conversationId}, updated_at = ${iso(at)}
            WHERE conversation_id = ${previousConversationId}
              AND user_id = (SELECT user_id FROM ronto_family_member WHERE id = ${memberId})`;
        }
        return conversationId;
      });

      // Called inside the receipt transaction so simultaneous arrivals rotate once.
      // Retries retain their original receipt and never create another session.
      const authorizeSession = Effect.fn("WhatsappStore.authorizeSession")(function* (
        input: EnqueueInput,
        at: DateTime.Utc,
      ) {
        const match = yield* authorizeInbound(input);
        const existing = yield* sql`
          SELECT id FROM ronto_whatsapp_inbox
          WHERE external_channel_id = ${input.externalChannelId} AND external_message_id = ${input.externalMessageId}
          UNION ALL SELECT id FROM ronto_whatsapp_media_receipt
          WHERE external_channel_id = ${input.externalChannelId} AND external_message_id = ${input.externalMessageId}
          LIMIT 1`;
        if (existing.length > 0) return match;
        const idle = yield* sql`
          SELECT id FROM ronto_conversation c WHERE c.id = ${match.conversationId}
            AND CAST(strftime('%s', ${iso(at)}) AS INTEGER) - (
              SELECT MAX(CAST(strftime('%s', activity_at) AS INTEGER)) FROM (
                SELECT c.created_at AS activity_at
                UNION ALL SELECT created_at FROM ronto_message WHERE conversation_id = c.id
                UNION ALL SELECT created_at FROM ronto_whatsapp_inbox WHERE conversation_id = c.id
                UNION ALL SELECT created_at FROM ronto_whatsapp_media_receipt WHERE conversation_id = c.id
              )
            ) >= ${8 * 60 * 60}
            AND NOT EXISTS (SELECT 1 FROM ronto_agent_run WHERE conversation_id = c.id AND status IN ('queued', 'running'))
            AND NOT EXISTS (SELECT 1 FROM ronto_whatsapp_inbox WHERE conversation_id = c.id AND status IN ('queued', 'processing'))
            AND NOT EXISTS (SELECT 1 FROM ronto_whatsapp_media_receipt WHERE conversation_id = c.id AND status = 'receiving')
        `;
        if (idle.length === 0) return match;
        const conversationId = yield* startLinkedSession(
          match.conversationId, match.authorityMemberId, input.group, input.externalChannelId, at,
        );
        return { ...match, conversationId };
      });

      const createClaim = Effect.fn("WhatsappStore.createClaim")(function* (
        requesterId: Id,
        claimId: Id,
        kind: ClaimKind,
        memberId: Id | null,
        conversationId: Id | null,
        tokenHash: string,
        expiresAt: DateTime.Utc,
      ) {
        const authorization =
          kind === "identity"
            ? yield* sql`
                SELECT id
                FROM ronto_family_member
                WHERE id = ${requesterId} AND id = ${memberId}
              `
            : yield* sql`
                SELECT member.id
                FROM ronto_family_member member
                JOIN ronto_conversation_member membership
                  ON membership.family_member_id = member.id
                  AND membership.conversation_id = ${conversationId}
                  AND membership.left_at IS NULL
                WHERE member.id = ${requesterId} AND member.role = 'primary'
              `;
        if (authorization.length === 0) return yield* notFound();

        const createdAt = yield* DateTime.now;
        yield* sql`
          INSERT INTO ronto_whatsapp_claim (
            id, kind, token_hash, family_member_id, conversation_id,
            created_by_member_id, created_at, expires_at
          ) VALUES (
            ${claimId}, ${kind}, ${tokenHash}, ${memberId}, ${conversationId},
            ${requesterId}, ${iso(createdAt)}, ${iso(expiresAt)}
          )
        `;
        return yield* decodeClaim({
          id: claimId,
          kind,
          tokenHash,
          familyMemberId: memberId,
          conversationId,
          createdByMemberId: requesterId,
          createdAt: iso(createdAt),
          expiresAt: iso(expiresAt),
          claimedAt: null,
        });
      });

      const listOutbox = Effect.fn("WhatsappStore.listOutbox")(function* (
        inboxId: Id,
      ) {
        const rows = yield* sql`
          SELECT ${sql.unsafe(selectOutbox)}
          FROM ronto_whatsapp_outbox
          WHERE inbox_id = ${inboxId}
          ORDER BY part_index
        `;
        return yield* Effect.forEach(rows, (row) => decodeOutbox(row));
      });

      const enqueueResolvedApprovalResults = Effect.fn(
        "WhatsappStore.enqueueResolvedApprovalResults",
      )(function* (inboxId: Id, externalChannelId: string, at: DateTime.Utc) {
        const rows = yield* sql`
          SELECT approval.result_message_id AS message_id,
            json_extract(message.content_json, '$.blocks[0].text') AS text
          FROM ronto_whatsapp_inbox inbox
          JOIN ronto_tool_call call ON call.run_id = inbox.run_id
          JOIN ronto_tool_approval approval ON approval.tool_call_id = call.id
          JOIN ronto_message message ON message.id = approval.result_message_id
          WHERE inbox.id = ${inboxId}
            AND approval.origin = 'whatsapp'
            AND approval.result_message_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM ronto_whatsapp_outbox existing
              WHERE existing.assistant_message_id = approval.result_message_id
            )
          ORDER BY approval.decided_at, approval.tool_call_id
        `;
        const results = yield* Effect.forEach(
          rows,
          (row) => decodeResolvedApprovalResult(row),
        );
        for (const result of results) {
          yield* sql`
            INSERT INTO ronto_whatsapp_outbox (
              id, inbox_id, assistant_message_id, external_channel_id,
              part_index, delivery_kind, file_id, approval_id, text, status,
              attempt_count, next_attempt_at, created_at, updated_at
            ) VALUES (
              ${randomUUID()}, ${inboxId}, ${result.messageId},
              ${externalChannelId},
              (SELECT COALESCE(MAX(part_index) + 1, 0)
                FROM ronto_whatsapp_outbox WHERE inbox_id = ${inboxId}),
              'text', NULL, NULL, ${result.text}, 'pending', 0,
              ${iso(at)}, ${iso(at)}, ${iso(at)}
            )
          `;
        }
      });

      return WhatsappStore.of({
        createIdentityClaim: (requesterId, claimId, memberId, hash, expiresAt) =>
          createClaim(
            requesterId,
            claimId,
            "identity",
            memberId,
            null,
            hash,
            expiresAt,
          ),
        createBindingClaim: (
          requesterId,
          claimId,
          conversationId,
          hash,
          expiresAt,
        ) =>
          createClaim(
            requesterId,
            claimId,
            "conversation",
            null,
            conversationId,
            hash,
            expiresAt,
          ),
        claimIdentity: (tokenHash, aliases) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const uniqueAliases = [...new Set(aliases)];
              if (uniqueAliases.length === 0) return yield* notFound();
              const claimedAt = yield* DateTime.now;
              const rows = yield* sql`
                UPDATE ronto_whatsapp_claim
                SET claimed_at = ${iso(claimedAt)}
                WHERE token_hash = ${tokenHash}
                  AND kind = 'identity'
                  AND claimed_at IS NULL
                  AND expires_at > ${iso(claimedAt)}
                RETURNING ${sql.unsafe(selectClaim)}
              `;
              const row = rows[0];
              if (row === undefined) return yield* notFound();
              const claim = yield* decodeClaim(row);
              for (const alias of uniqueAliases) {
                yield* sql`
                  INSERT INTO ronto_external_identity (
                    id, user_id, adapter, external_user_id, created_at
                  ) VALUES (
                    ${randomUUID()},
                    (SELECT user_id FROM ronto_family_member WHERE id = ${claim.familyMemberId}),
                    'whatsapp',
                    ${alias}, ${iso(claimedAt)}
                  )
                  ON CONFLICT (adapter, external_user_id) DO UPDATE SET
                    user_id = excluded.user_id
                `;
              }
              if (claim.familyMemberId === null) return yield* notFound();
              yield* selectDmFamilyForMember(claim.familyMemberId, claimedAt);
              return claim;
            }),
          ),
        claimBinding: (tokenHash, senderAliases, externalChannelId) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const aliases = [...new Set(senderAliases)];
              if (aliases.length === 0) return yield* notFound();
              const claimedAt = yield* DateTime.now;
              const rows = yield* sql`
                SELECT ${sql.unsafe(selectClaim)}
                FROM ronto_whatsapp_claim
                WHERE token_hash = ${tokenHash}
                  AND kind = 'conversation'
                  AND claimed_at IS NULL
                  AND expires_at > ${iso(claimedAt)}
              `;
              const row = rows[0];
              if (row === undefined) return yield* notFound();
              const claim = yield* decodeClaim(row);
              const authorized = yield* sql`
                SELECT identity.id
                FROM ronto_external_identity identity
                JOIN ronto_family_member member
                  ON member.user_id = identity.user_id
                  AND member.role = 'primary'
                JOIN ronto_conversation conversation
                  ON conversation.id = ${claim.conversationId}
                  AND conversation.family_id = member.family_id
                JOIN ronto_conversation_member membership
                  ON membership.conversation_id = conversation.id
                  AND membership.family_member_id = member.id
                  AND membership.left_at IS NULL
                WHERE identity.adapter = 'whatsapp'
                  AND identity.external_user_id IN ${sql.in(aliases)}
              `;
              if (authorized.length === 0) return yield* notFound();

              yield* sql`
                UPDATE ronto_whatsapp_claim
                SET claimed_at = ${iso(claimedAt)}
                WHERE id = ${claim.id} AND claimed_at IS NULL
              `;
              yield* sql`
                INSERT INTO ronto_conversation_binding (
                  id, conversation_id, adapter, external_channel_id,
                  external_thread_id, created_at
                ) VALUES (
                  ${randomUUID()}, ${claim.conversationId}, 'whatsapp',
                  ${externalChannelId}, '', ${iso(claimedAt)}
                )
                ON CONFLICT (adapter, external_channel_id, external_thread_id)
                DO UPDATE SET
                  conversation_id = excluded.conversation_id,
                  created_at = excluded.created_at
              `;
              return {
                ...claim,
                claimedAt,
              };
            }),
          ),
        listIdentities: (requesterId) =>
          sql`
            SELECT identity.id, identity.external_user_id, identity.display_name
            FROM ronto_external_identity identity
            JOIN ronto_family_member requester
              ON requester.user_id = identity.user_id
            WHERE identity.adapter = 'whatsapp'
              AND requester.id = ${requesterId}
            ORDER BY identity.created_at, identity.id
          `.pipe(
            Effect.flatMap((rows) =>
              Effect.forEach(rows, (row) => decodeIdentity(row)),
            ),
          ),
        revokeIdentity: (requesterId, identityId) =>
          sql`
            DELETE FROM ronto_external_identity AS identity
            WHERE identity.id = ${identityId}
              AND identity.adapter = 'whatsapp'
              AND identity.user_id = (
                SELECT user_id FROM ronto_family_member WHERE id = ${requesterId}
              )
          `.pipe(Effect.asVoid),
        listDmFamilies: (senderAliases) => Effect.gen(function* () {
          const userId = yield* linkedUserId(senderAliases);
          return yield* listDmFamiliesForUser(userId);
        }),
        listMemberDmFamilies: (requesterId) => Effect.gen(function* () {
          const rows = yield* sql<{ userId: string }>`
            SELECT user_id FROM ronto_family_member WHERE id = ${requesterId}
          `;
          const userId = rows[0]?.userId;
          if (userId === undefined) return yield* notFound();
          return yield* listDmFamiliesForUser(userId);
        }),
        selectDmFamily: (requesterId) => sql.withTransaction(
          Effect.gen(function* () {
            return yield* selectDmFamilyForMember(requesterId, yield* DateTime.now);
          }),
        ),
        selectDmFamilyByCode: (senderAliases, code) => sql.withTransaction(
          Effect.gen(function* () {
            const userId = yield* linkedUserId(senderAliases);
            const rows = yield* sql<{ memberId: string }>`
              SELECT member.id AS member_id
              FROM ronto_family_member member
              WHERE member.user_id = ${userId}
                AND substr(member.family_id, 1, 8) = ${code}
            `;
            if (rows.length !== 1 || rows[0] === undefined) return yield* notFound();
            return yield* selectDmFamilyForMember(rows[0].memberId, yield* DateTime.now);
          }),
        ),
        listBindings: (requesterId, conversationId) =>
          Effect.gen(function* () {
            const rows = yield* sql`
              SELECT
                binding.id,
                binding.conversation_id,
                binding.external_channel_id,
                binding.created_at
              FROM ronto_conversation_binding binding
              JOIN ronto_conversation_member membership
                ON membership.conversation_id = binding.conversation_id
                AND membership.family_member_id = ${requesterId}
                AND membership.left_at IS NULL
              JOIN ronto_family_member member
                ON member.id = membership.family_member_id
                AND member.role = 'primary'
              WHERE binding.adapter = 'whatsapp'
                AND binding.conversation_id = ${conversationId}
              ORDER BY binding.created_at, binding.id
            `;
            if (rows.length === 0) {
              const authorized = yield* sql`
                SELECT membership.conversation_id
                FROM ronto_conversation_member membership
                JOIN ronto_family_member member
                  ON member.id = membership.family_member_id
                  AND member.role = 'primary'
                WHERE membership.conversation_id = ${conversationId}
                  AND membership.family_member_id = ${requesterId}
                  AND membership.left_at IS NULL
              `;
              if (authorized.length === 0) return yield* notFound();
            }
            return yield* Effect.forEach(rows, (row) => decodeBinding(row));
          }),
        removeBinding: (requesterId, conversationId, bindingId) =>
          Effect.gen(function* () {
            const rows = yield* sql`
              DELETE FROM ronto_conversation_binding
              WHERE id = ${bindingId}
                AND adapter = 'whatsapp'
                AND conversation_id = ${conversationId}
                AND conversation_id IN (
                  SELECT membership.conversation_id
                  FROM ronto_conversation_member membership
                  JOIN ronto_family_member member
                    ON member.id = membership.family_member_id
                    AND member.role = 'primary'
                  WHERE membership.family_member_id = ${requesterId}
                    AND membership.left_at IS NULL
                )
              RETURNING id
            `;
            return rows.length > 0;
          }),
        startConversation: (
          senderAliases,
          externalChannelId,
          externalMessageId,
          group,
        ) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const aliases = [...new Set(senderAliases)];
              if (aliases.length === 0) return yield* notFound();
              const at = yield* DateTime.now;
              const reserved = yield* sql`
                INSERT INTO ronto_whatsapp_command (
                  external_channel_id, external_message_id, conversation_id,
                  created_at
                ) VALUES (
                  ${externalChannelId}, ${externalMessageId}, NULL, ${iso(at)}
                )
                ON CONFLICT (external_channel_id, external_message_id) DO NOTHING
                RETURNING external_message_id
              `;
              if (reserved.length === 0) return false;

              const rows = group
                ? yield* sql`
                SELECT
                  conversation.family_id,
                  conversation.channel_id,
                  conversation.id AS previous_conversation_id,
                  member.id AS family_member_id
                FROM ronto_conversation_binding binding
                JOIN ronto_conversation conversation
                  ON conversation.id = binding.conversation_id
                  AND conversation.status = 'active'
                JOIN ronto_external_identity identity
                  ON identity.adapter = 'whatsapp'
                  AND identity.external_user_id IN ${sql.in(aliases)}
                JOIN ronto_family_member member
                  ON member.user_id = identity.user_id
                  AND member.family_id = conversation.family_id
                  AND member.role = 'primary'
                JOIN ronto_channel_member channel_membership
                  ON channel_membership.channel_id = conversation.channel_id
                  AND channel_membership.family_member_id = member.id
                  AND channel_membership.left_at IS NULL
                JOIN ronto_conversation_member conversation_membership
                  ON conversation_membership.conversation_id = conversation.id
                  AND conversation_membership.family_member_id = member.id
                  AND conversation_membership.left_at IS NULL
                WHERE binding.adapter = 'whatsapp'
                  AND binding.external_channel_id = ${externalChannelId}
                  AND binding.external_thread_id = ''
                LIMIT 1
              `
                : yield* sql`
                    SELECT conversation.family_id, conversation.channel_id,
                      conversation.id AS previous_conversation_id,
                      member.id AS family_member_id
                    FROM ronto_external_identity identity
                    JOIN ronto_whatsapp_dm_selection selection
                      ON selection.user_id = identity.user_id
                    JOIN ronto_conversation conversation
                      ON conversation.id = selection.conversation_id
                      AND conversation.family_id = selection.family_id
                      AND conversation.status = 'active'
                    JOIN ronto_family_member member
                      ON member.user_id = identity.user_id
                      AND member.family_id = selection.family_id
                    JOIN ronto_channel_member channel_membership
                      ON channel_membership.channel_id = conversation.channel_id
                      AND channel_membership.family_member_id = member.id
                      AND channel_membership.left_at IS NULL
                    WHERE identity.adapter = 'whatsapp'
                      AND identity.external_user_id IN ${sql.in(aliases)}
                    LIMIT 1
                  `;
              const row = rows[0];
              if (row === undefined) return yield* notFound();
              const context = yield* Schema.decodeUnknownEffect(Schema.Struct({
                previousConversationId: Schema.String,
                familyMemberId: Schema.String,
              }))(row);
              const conversationId = yield* startLinkedSession(
                context.previousConversationId, context.familyMemberId, group, externalChannelId, at,
              );
              yield* sql`
                UPDATE ronto_whatsapp_command
                SET conversation_id = ${conversationId}
                WHERE external_channel_id = ${externalChannelId}
                  AND external_message_id = ${externalMessageId}
              `;
              return true;
            }),
          ),
        findLinkedMemberId: (senderAliases, approvalId) =>
          Effect.gen(function* () {
            if (senderAliases.length === 0) return null;
            const rows = yield* sql<{ familyMemberId: string }>`
              SELECT member.id AS family_member_id
              FROM ronto_external_identity identity
              JOIN ronto_family_member member ON member.user_id = identity.user_id
              JOIN ronto_conversation conversation ON conversation.family_id = member.family_id
              JOIN ronto_agent_run run ON run.conversation_id = conversation.id
              JOIN ronto_tool_call call ON call.run_id = run.id
              JOIN ronto_tool_approval approval ON approval.tool_call_id = call.id
                AND approval.id = ${approvalId}
              WHERE identity.adapter = 'whatsapp'
                AND identity.external_user_id IN ${sql.in(senderAliases)}
              ORDER BY identity.created_at, identity.id
              LIMIT 1
            `;
            return rows[0]?.familyMemberId ?? null;
          }),
        findApprovalIdForReply: (externalChannelId, providerMessageId) =>
          sql<{ approvalId: string }>`
            SELECT approval_id
            FROM ronto_whatsapp_outbox
            WHERE external_channel_id = ${externalChannelId}
              AND provider_message_id = ${providerMessageId}
              AND status = 'sent'
              AND approval_id IS NOT NULL
            LIMIT 1
          `.pipe(Effect.map((rows) => rows[0]?.approvalId ?? null)),
        enqueue: (input) =>
          sql.withTransaction(Effect.gen(function* () {
            const at = input.at ?? (yield* DateTime.now);
            const match = yield* authorizeSession(input, at);
            yield* sql`
              INSERT INTO ronto_whatsapp_inbox (
                id, external_channel_id, external_message_id,
                sender_external_id, sender_external_name, sender_member_id,
                linked_sender_member_id, conversation_id, text,
                response_mode, trigger_kind, status, created_at, updated_at
              ) VALUES (
                ${input.id ?? randomUUID()}, ${input.externalChannelId},
                ${input.externalMessageId}, ${input.senderExternalId},
                ${input.senderExternalName}, ${match.authorityMemberId},
                ${match.senderMemberId}, ${match.conversationId}, ${input.text},
                ${input.responseMode}, ${input.triggerKind}, 'queued',
                ${iso(at)}, ${iso(at)}
              )
              ON CONFLICT (external_channel_id, external_message_id) DO NOTHING
            `;
            const rows = yield* sql`
              SELECT ${sql.unsafe(selectInbox)}
              FROM ronto_whatsapp_inbox
              WHERE external_channel_id = ${input.externalChannelId}
                AND external_message_id = ${input.externalMessageId}
            `;
            const row = rows[0];
            if (row === undefined) return yield* notFound();
            return yield* decodeInbox(row);
          })),
        reserveMedia: (input) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = input.at ?? (yield* DateTime.now);
              const match = yield* authorizeSession(input, at);
              const receiptId = input.id ?? randomUUID();
              const inserted = yield* sql`
                INSERT INTO ronto_whatsapp_media_receipt (
                  id, external_channel_id, external_message_id,
                  sender_external_id, sender_external_name,
                  authority_member_id, linked_sender_member_id,
                  conversation_id, caption, response_mode, trigger_kind,
                  status, created_at, updated_at
                ) VALUES (
                  ${receiptId}, ${input.externalChannelId},
                  ${input.externalMessageId}, ${input.senderExternalId},
                  ${input.senderExternalName}, ${match.authorityMemberId},
                  ${match.senderMemberId}, ${match.conversationId}, ${input.text},
                  ${input.responseMode}, ${input.triggerKind}, 'receiving',
                  ${iso(at)}, ${iso(at)}
                )
                ON CONFLICT (external_channel_id, external_message_id) DO NOTHING
                RETURNING id
              `;
              const reclaimed = inserted.length === 0
                ? yield* sql`
                    UPDATE ronto_whatsapp_media_receipt
                    SET status = 'receiving', error = NULL, updated_at = ${iso(at)}
                    WHERE external_channel_id = ${input.externalChannelId}
                      AND external_message_id = ${input.externalMessageId}
                      AND status = 'retryable'
                    RETURNING id
                  `
                : [];
              const rows = yield* sql`
                SELECT ${sql.unsafe(selectMediaReceipt)}
                FROM ronto_whatsapp_media_receipt
                WHERE external_channel_id = ${input.externalChannelId}
                  AND external_message_id = ${input.externalMessageId}
              `;
              const row = rows[0];
              if (row === undefined) return yield* notFound();
              return {
                receipt: yield* decodeMediaReceipt(row),
                inserted: inserted.length > 0 || reclaimed.length > 0,
              };
            }),
          ),
        createInboundFile: (input) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = input.at ?? (yield* DateTime.now);
              const storagePath = `files/${input.fileId}/${storageName(input.name)}`;
              const inserted = yield* sql`
                INSERT INTO ronto_file (
                  id, channel_id, originating_conversation_id,
                  originating_message_id, originating_run_id,
                  created_by_member_id, kind, name, storage_path, media_type,
                  byte_size, checksum, created_at
                )
                SELECT
                  ${input.fileId}, conversation.channel_id,
                  receipt.conversation_id, NULL, NULL,
                  receipt.authority_member_id, 'upload', ${input.name},
                  ${storagePath}, ${input.mediaType}, ${input.byteSize},
                  ${input.checksum}, ${iso(at)}
                FROM ronto_whatsapp_media_receipt receipt
                JOIN ronto_conversation conversation
                  ON conversation.id = receipt.conversation_id
                WHERE receipt.id = ${input.receiptId}
                  AND receipt.status = 'receiving'
                  AND receipt.file_id IS NULL
                RETURNING id AS file_id, channel_id, storage_path
              `;
              const row = inserted[0];
              if (row === undefined) return yield* notFound();
              yield* sql`
                UPDATE ronto_whatsapp_media_receipt
                SET file_id = ${input.fileId}, updated_at = ${iso(at)}
                WHERE id = ${input.receiptId} AND status = 'receiving'
              `;
              return yield* decodeInboundFile(row);
            }),
          ),
        queueInboundMedia: (receiptId, fallbackText) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* DateTime.now;
              const inboxId = randomUUID();
              const inserted = yield* sql`
                INSERT INTO ronto_whatsapp_inbox (
                  id, external_channel_id, external_message_id,
                  sender_external_id, sender_external_name, sender_member_id,
                  linked_sender_member_id, inbound_file_id, conversation_id,
                  text, inbound_caption, response_mode, trigger_kind, status,
                  created_at, updated_at
                )
                SELECT
                  ${inboxId}, external_channel_id, external_message_id,
                  sender_external_id, sender_external_name, authority_member_id,
                  linked_sender_member_id, file_id, conversation_id,
                  CASE WHEN length(caption) = 0 THEN ${fallbackText} ELSE caption END,
                  caption, response_mode, trigger_kind, 'queued', created_at,
                  ${iso(at)}
                FROM ronto_whatsapp_media_receipt
                WHERE id = ${receiptId}
                  AND status = 'receiving'
                  AND file_id IS NOT NULL
                RETURNING ${sql.unsafe(selectInbox)}
              `;
              const row = inserted[0];
              if (row === undefined) return yield* notFound();
              yield* sql`
                UPDATE ronto_whatsapp_media_receipt
                SET status = 'queued', inbox_id = ${inboxId}, updated_at = ${iso(at)}
                WHERE id = ${receiptId} AND status = 'receiving'
              `;
              return yield* decodeInbox(row);
            }),
          ),
        listReceivingMedia: () =>
          Effect.gen(function* () {
            const rows = yield* sql`
              SELECT
                receipt.id AS receipt_id,
                receipt.file_id,
                file.channel_id,
                file.storage_path
              FROM ronto_whatsapp_media_receipt receipt
              LEFT JOIN ronto_file file ON file.id = receipt.file_id
              WHERE receipt.status = 'receiving'
              ORDER BY receipt.created_at, receipt.id
            `;
            return yield* Effect.forEach(rows, (row) =>
              decodeReceivingMedia(row)
            );
          }),
        failReceivingMedia: (receiptId, error, retryable) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* DateTime.now;
              const files = yield* sql<{ fileId: string }>`
                SELECT file_id
                FROM ronto_whatsapp_media_receipt
                WHERE id = ${receiptId} AND status = 'receiving'
                  AND file_id IS NOT NULL
              `;
              yield* sql`
                UPDATE ronto_whatsapp_media_receipt
                SET status = ${retryable ? "retryable" : "failed"},
                  error = ${error}, file_id = NULL, updated_at = ${iso(at)}
                WHERE id = ${receiptId} AND status = 'receiving'
              `;
              const file = files[0];
              if (file !== undefined) {
                yield* sql`
                  DELETE FROM ronto_file
                  WHERE id = ${file.fileId} AND originating_message_id IS NULL
                `;
              }
            }),
          ),
        claimNext: () =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* DateTime.now;
              const rows = yield* sql`
                UPDATE ronto_whatsapp_inbox
                SET status = 'processing', updated_at = ${iso(at)}
                WHERE id = (
                  SELECT id
                  FROM ronto_whatsapp_inbox
                  WHERE status = 'queued'
                    AND NOT EXISTS (
                      SELECT 1
                      FROM ronto_whatsapp_media_receipt receipt
                      WHERE receipt.conversation_id = ronto_whatsapp_inbox.conversation_id
                        AND receipt.status = 'receiving'
                        AND receipt.created_at <= ronto_whatsapp_inbox.created_at
                    )
                  ORDER BY created_at, id
                  LIMIT 1
                )
                RETURNING ${sql.unsafe(selectInbox)}
              `;
              const row = rows[0];
              return row === undefined ? null : yield* decodeInbox(row);
            }),
          ),
        markCanonical: (inboxId, messageId) =>
          Effect.gen(function* () {
            const at = yield* DateTime.now;
            yield* sql`
              UPDATE ronto_whatsapp_inbox
              SET canonical_message_id = ${messageId}, updated_at = ${iso(at)}
              WHERE id = ${inboxId} AND status = 'processing'
            `;
          }),
        markRun: (inboxId, runId) =>
          Effect.gen(function* () {
            const at = yield* DateTime.now;
            yield* sql`
              UPDATE ronto_whatsapp_inbox
              SET run_id = ${runId}, updated_at = ${iso(at)}
              WHERE id = ${inboxId} AND status = 'processing'
            `;
          }),
        markSilent: (inboxId) =>
          Effect.gen(function* () {
            const at = yield* DateTime.now;
            yield* sql`
              UPDATE ronto_whatsapp_inbox
              SET status = 'silent', error = NULL, updated_at = ${iso(at)}
              WHERE id = ${inboxId} AND status = 'processing'
            `;
          }),
        markFailed: (inboxId, error, notifyOptional = false) =>
          sql.withTransaction(Effect.gen(function* () {
            const at = yield* DateTime.now;
            const rows = yield* sql`
              UPDATE ronto_whatsapp_inbox
              SET status = 'failed', error = ${error}, updated_at = ${iso(at)}
              WHERE id = ${inboxId} AND status = 'processing'
              RETURNING ${sql.unsafe(selectInbox)}
            `;
            const row = rows[0];
            if (row === undefined) return;
            yield* enqueueFailureNotice(
              yield* decodeInbox(row),
              "I hit an error before I could finish this request. Your message was saved, but I don't have a completed answer.",
              at,
              notifyOptional,
            );
          })),
        failInterrupted: () =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* DateTime.now;
              const error = "WhatsApp turn interrupted by server restart";
              const errorJson = JSON.stringify({ message: error });
              yield* sql`
                UPDATE ronto_agent_run
                SET
                  status = 'failed',
                  error_json = ${errorJson},
                  completed_at = ${iso(at)}
                WHERE status = 'running'
                  AND id IN (
                    SELECT run_id
                    FROM ronto_whatsapp_inbox
                    WHERE status = 'processing' AND run_id IS NOT NULL
                  )
              `;
              const rows = yield* sql`
                UPDATE ronto_whatsapp_inbox
                SET
                  status = 'failed',
                  error = ${error},
                  updated_at = ${iso(at)}
                WHERE status = 'processing'
                RETURNING ${sql.unsafe(selectInbox)}
              `;
              for (const row of rows) {
                yield* enqueueFailureNotice(
                  yield* decodeInbox(row),
                  "Ronto restarted before I could finish this request. Your message was saved, but I don't have a completed answer.",
                  at,
                );
              }
              return rows.length;
            }),
          ),
        resetSendingOutbox: () =>
          Effect.gen(function* () {
            const at = yield* DateTime.now;
            yield* sql`
              UPDATE ronto_whatsapp_outbox
              SET status = 'pending', updated_at = ${iso(at)}
              WHERE status = 'sending'
            `;
          }),
        completeResponded: (input) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = input.at ?? (yield* DateTime.now);
              const authorized = yield* sql`
                SELECT inbox.id
                FROM ronto_whatsapp_inbox inbox
                JOIN ronto_message message
                  ON message.id = ${input.assistantMessageId}
                  AND message.conversation_id = inbox.conversation_id
                  AND message.sender_type = 'agent'
                WHERE inbox.id = ${input.inboxId}
                  AND inbox.external_channel_id = ${input.externalChannelId}
                  AND inbox.status = 'processing'
              `;
              if (authorized.length === 0) return yield* notFound();

              for (const [partIndex, delivery] of input.deliveries.entries()) {
                if (delivery.kind === "text") {
                  yield* sql`
                    INSERT INTO ronto_whatsapp_outbox (
                      id, inbox_id, assistant_message_id, external_channel_id,
                      part_index, delivery_kind, file_id, approval_id, text, status,
                      attempt_count, next_attempt_at, created_at, updated_at
                    ) VALUES (
                      ${delivery.id ?? randomUUID()}, ${input.inboxId},
                      ${input.assistantMessageId}, ${input.externalChannelId},
                      ${partIndex}, 'text', NULL, NULL, ${delivery.text}, 'pending',
                      0, ${iso(at)}, ${iso(at)}, ${iso(at)}
                    )
                    ON CONFLICT (inbox_id, part_index) DO NOTHING
                  `;
                  continue;
                }
                if (delivery.kind === "approval") {
                  yield* sql`
                    INSERT INTO ronto_whatsapp_outbox (
                      id, inbox_id, assistant_message_id, external_channel_id,
                      part_index, delivery_kind, file_id, approval_id, text,
                      status, attempt_count, next_attempt_at, created_at, updated_at
                    ) VALUES (
                      ${delivery.id ?? randomUUID()}, ${input.inboxId},
                      ${input.assistantMessageId}, ${input.externalChannelId},
                      ${partIndex}, 'text', NULL, ${delivery.approvalId},
                      ${delivery.text}, 'pending', 0, ${iso(at)}, ${iso(at)},
                      ${iso(at)}
                    )
                    ON CONFLICT (inbox_id, part_index) DO NOTHING
                  `;
                  continue;
                }
                yield* sql`
                  INSERT INTO ronto_whatsapp_outbox (
                    id, inbox_id, assistant_message_id, external_channel_id,
                    part_index, delivery_kind, file_id, approval_id, text, status,
                    attempt_count, next_attempt_at, created_at, updated_at
                  )
                  SELECT
                    ${delivery.id ?? randomUUID()}, ${input.inboxId},
                    ${input.assistantMessageId}, ${input.externalChannelId},
                    ${partIndex}, 'file', managed.id, NULL, managed.name, 'pending',
                    0, ${iso(at)}, ${iso(at)}, ${iso(at)}
                  FROM ronto_file managed
                  JOIN ronto_message message
                    ON message.id = ${input.assistantMessageId}
                    AND message.sender_type = 'agent'
                  JOIN ronto_conversation conversation
                    ON conversation.id = message.conversation_id
                    AND conversation.channel_id = managed.channel_id
                  WHERE managed.id = ${delivery.fileId}
                  ON CONFLICT (inbox_id, part_index) DO NOTHING
                `;
              }
              yield* enqueueResolvedApprovalResults(
                input.inboxId,
                input.externalChannelId,
                at,
              );
              const outbox = yield* listOutbox(input.inboxId);
              if (outbox.length < input.deliveries.length)
                return yield* notFound();
              const responded = yield* sql`
                UPDATE ronto_whatsapp_inbox
                SET status = 'responded', error = NULL, updated_at = ${iso(at)}
                WHERE id = ${input.inboxId} AND status = 'processing'
                RETURNING id
              `;
              if (responded.length === 0) return yield* notFound();
              return outbox;
            }),
          ),
        claimDueOutbox: (requestedAt) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = requestedAt ?? (yield* DateTime.now);
              const rows = yield* sql`
                UPDATE ronto_whatsapp_outbox
                SET
                  status = 'sending',
                  attempt_count = attempt_count + 1,
                  updated_at = ${iso(at)}
                WHERE id = (
                  SELECT candidate.id
                  FROM ronto_whatsapp_outbox candidate
                  WHERE candidate.status = 'pending'
                    AND candidate.next_attempt_at <= ${iso(at)}
                    AND NOT EXISTS (
                      SELECT 1
                      FROM ronto_whatsapp_outbox earlier
                      WHERE earlier.inbox_id = candidate.inbox_id
                        AND earlier.part_index < candidate.part_index
                        AND earlier.status <> 'sent'
                    )
                  ORDER BY candidate.next_attempt_at, candidate.created_at,
                    candidate.inbox_id, candidate.part_index
                  LIMIT 1
                )
                RETURNING ${sql.unsafe(selectOutbox)}
              `;
              const row = rows[0];
              return row === undefined ? null : yield* decodeOutbox(row);
            }),
          ),
        markOutboxSent: (id, providerMessageId) =>
          Effect.gen(function* () {
            const at = yield* DateTime.now;
            yield* sql`
              UPDATE ronto_whatsapp_outbox
              SET
                status = 'sent',
                provider_message_id = ${providerMessageId},
                last_error = NULL,
                updated_at = ${iso(at)}
              WHERE id = ${id} AND status = 'sending'
            `;
          }),
        retryOutbox: (id, error, nextAttemptAt) =>
          Effect.gen(function* () {
            const at = yield* DateTime.now;
            yield* sql`
              UPDATE ronto_whatsapp_outbox
              SET
                status = 'pending',
                last_error = ${error},
                next_attempt_at = ${iso(nextAttemptAt)},
                updated_at = ${iso(at)}
              WHERE id = ${id} AND status = 'sending'
            `;
          }),
        failOutbox: (id, error) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = yield* DateTime.now;
              const failed = yield* sql<{ inboxId: string; partIndex: number }>`
                UPDATE ronto_whatsapp_outbox
                SET status = 'failed', last_error = ${error}, updated_at = ${iso(at)}
                WHERE id = ${id} AND status = 'sending'
                RETURNING inbox_id, part_index
              `;
              const row = failed[0];
              if (row === undefined) return;
              yield* sql`
                UPDATE ronto_whatsapp_outbox
                SET
                  status = 'failed',
                  last_error = 'An earlier WhatsApp delivery failed',
                  updated_at = ${iso(at)}
                WHERE inbox_id = ${row.inboxId}
                  AND part_index > ${row.partIndex}
                  AND status = 'pending'
              `;
            }),
          ),
        loadAuth: (category, key) =>
          sql<{ valueJson: string }>`
            SELECT value_json
            FROM ronto_whatsapp_auth
            WHERE category = ${category} AND key = ${key}
          `.pipe(Effect.map((rows) => rows[0]?.valueJson ?? null)),
        saveAuth: (category, key, valueJson, requestedAt) =>
          Effect.gen(function* () {
            const at = requestedAt ?? (yield* DateTime.now);
            yield* sql`
              INSERT INTO ronto_whatsapp_auth (
                category, key, value_json, updated_at
              ) VALUES (
                ${category}, ${key}, ${valueJson}, ${iso(at)}
              )
              ON CONFLICT (category, key) DO UPDATE SET
                value_json = excluded.value_json,
                updated_at = excluded.updated_at
            `;
          }),
        deleteAuth: (category, key) =>
          sql`
            DELETE FROM ronto_whatsapp_auth
            WHERE category = ${category} AND key = ${key}
          `.pipe(Effect.asVoid),
        updateAuth: (updates, requestedAt) =>
          sql.withTransaction(
            Effect.gen(function* () {
              const at = requestedAt ?? (yield* DateTime.now);
              for (const update of updates) {
                if (update.valueJson === null) {
                  yield* sql`
                    DELETE FROM ronto_whatsapp_auth
                    WHERE category = ${update.category} AND key = ${update.key}
                  `;
                } else {
                  yield* sql`
                    INSERT INTO ronto_whatsapp_auth (
                      category, key, value_json, updated_at
                    ) VALUES (
                      ${update.category}, ${update.key}, ${update.valueJson},
                      ${iso(at)}
                    )
                    ON CONFLICT (category, key) DO UPDATE SET
                      value_json = excluded.value_json,
                      updated_at = excluded.updated_at
                  `;
                }
              }
            }),
          ),
        clearAuth: () =>
          sql`DELETE FROM ronto_whatsapp_auth`.pipe(Effect.asVoid),
      });
    }),
  );
}
