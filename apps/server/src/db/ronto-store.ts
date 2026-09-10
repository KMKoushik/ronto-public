import {
  Cause,
  Context,
  DateTime,
  Effect,
  Layer,
  Option,
  Schema,
  SchemaIssue,
} from "effect";
import { SqlClient, SqlModel, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import type { FamilyMemberRole, FileKind } from "@ronto/api";

import {
  AgentRun,
  AgentRunId,
  Conversation,
  Channel,
  ChannelFile,
  ChannelId,
  ConversationId,
  ContextCheckpoint,
  Family,
  FamilyId,
  FamilyMember,
  FamilyMemberId,
  FileId,
  Message,
  type MessageContent,
  MessageId,
  UserId,
} from "./models.ts";
import {
  ChannelSummaryMatch,
  type GeneratedSessionSummary,
  SessionSummaryJob,
  SessionSummaryPayload,
  type SessionSummarySource,
  SessionSummarySourceFile,
  StoredSessionSummary,
  renderSessionSummarySearchText,
} from "./session-summary.ts";

type StoreError =
  SqlError | Schema.SchemaError | SchemaIssue.Issue | Cause.NoSuchElementError;

export class FamilyCapacityUnavailable extends Schema.TaggedError<FamilyCapacityUnavailable>()(
  "FamilyCapacityUnavailable", { message: Schema.String },
) {}

const NextSequence = Schema.Struct({
  nextSequence: Schema.Int.check(Schema.isGreaterThan(0)),
});

export const ConversationSummary = Schema.Struct({
  id: ConversationId,
  familyId: FamilyId,
  channelId: ChannelId,
  title: Schema.NullOr(Schema.String),
  previousConversationId: Schema.NullOr(ConversationId),
  status: Schema.Literals(["active", "archived"]),
  createdByMemberId: Schema.NullOr(FamilyMemberId),
  participantCount: Schema.Int.check(Schema.isGreaterThan(0)),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type ConversationSummary = typeof ConversationSummary.Type;

const ChannelRosterMember = Schema.Struct({
  id: FamilyMemberId,
  name: Schema.String,
  role: Schema.Literals(["primary", "member"]),
});

const ChatExcerpt = Schema.Struct({
  conversationId: ConversationId,
  title: Schema.NullOr(Schema.String),
  messageId: MessageId,
  sequence: Schema.Int,
  senderMemberId: Schema.NullOr(FamilyMemberId),
  externalSenderId: Schema.NullOr(Schema.String),
  speaker: Schema.String,
  createdAt: Schema.String,
  text: Schema.String,
  textLength: Schema.Int,
});
export type ChatExcerpt = typeof ChatExcerpt.Type;

export interface ChatLookup {
  readonly channelId: ChannelId;
  readonly memberId: FamilyMemberId;
  readonly conversationId: ConversationId | null;
  readonly query: string;
  readonly afterSequence: number;
  readonly offset: number;
  readonly textOffset: number;
  readonly limit: number;
}

const StoredSessionSummaryRow = Schema.Struct({
  conversationId: ConversationId,
  requestedThroughSequence: Schema.Int,
  summarizedThroughSequence: Schema.NullOr(Schema.Int),
  summaryJson: Schema.NullOr(Schema.String),
  status: Schema.Literals(["pending", "running", "current"]),
  modelProvider: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});

const FamilyMemberSummaryRow = Schema.Struct({
  id: FamilyMemberId,
  role: Schema.Literals(["primary", "member"]),
  name: Schema.String,
  email: Schema.String,
  channelIdsJson: Schema.fromJsonString(Schema.Array(ChannelId)),
  joinedAt: Schema.DateTimeUtcFromString,
});

export interface FamilyMemberSummary {
  readonly id: FamilyMemberId;
  readonly role: FamilyMemberRole;
  readonly name: string;
  readonly email: string;
  readonly channelIds: ReadonlyArray<ChannelId>;
  readonly joinedAt: DateTime.Utc;
}

export interface FamilyMemberProfile {
  readonly id: FamilyMemberId;
  readonly name: string;
}

export interface FamilyMembership {
  readonly family: Family;
  readonly member: FamilyMember;
}

const FamilyMembershipRow = Schema.Struct({
  memberId: FamilyMemberId,
  familyId: FamilyId,
  userId: UserId,
  role: Schema.Literals(["primary", "member"]),
  joinedAt: Schema.DateTimeUtcFromString,
  familyName: Schema.NonEmptyString,
  familyCreatedAt: Schema.DateTimeUtcFromString,
  familyUpdatedAt: Schema.DateTimeUtcFromString,
});

const ClaimableInvite = Schema.Struct({
  id: Schema.String,
  familyId: FamilyId,
  role: Schema.Literals(["primary", "member"]),
});

export interface CreateConversationFileInput {
  readonly fileId: FileId;
  readonly conversationId: ConversationId;
  readonly memberId: FamilyMemberId;
  readonly messageId: MessageId | null;
  readonly runId: AgentRunId | null;
  readonly kind: FileKind;
  readonly name: string;
  readonly mediaType: string;
  readonly byteSize: number;
  readonly checksum: string;
}

const storageName = (name: string): string => {
  const safe = name
    .trim()
    .replace(/^[./\\]+/, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .slice(0, 200);
  return safe || "file";
};

export class RontoStore extends Context.Service<
  RontoStore,
  {
    createFamily(
      name: string,
      primaryUserId: UserId,
    ): Effect.Effect<readonly [Family, FamilyMember], StoreError | FamilyCapacityUnavailable>;
    findMemberByUserAndFamily(
      userId: UserId,
      familyId: FamilyId,
    ): Effect.Effect<FamilyMember | null, StoreError>;
    listMembershipsByUser(
      userId: UserId,
    ): Effect.Effect<Array<FamilyMembership>, StoreError>;
    listFamilyMembers(
      requesterId: FamilyMemberId,
    ): Effect.Effect<Array<FamilyMemberSummary>, StoreError>;
    listFamilyMemberProfiles(
      requesterId: FamilyMemberId,
    ): Effect.Effect<Array<FamilyMemberProfile>, StoreError>;
    listChannelMembers(
      channelId: ChannelId,
      memberId: FamilyMemberId,
    ): Effect.Effect<ReadonlyArray<typeof ChannelRosterMember.Type>, StoreError>;
    lookupChannelChats(input: ChatLookup): Effect.Effect<ReadonlyArray<ChatExcerpt>, StoreError>;
    lookupChannelSummaries(
      channelId: ChannelId,
      memberId: FamilyMemberId,
      query: string,
      offset: number,
      limit: number,
    ): Effect.Effect<ReadonlyArray<typeof ChannelSummaryMatch.Type>, StoreError>;
    findSessionSummary(
      conversationId: ConversationId,
      memberId: FamilyMemberId,
    ): Effect.Effect<typeof StoredSessionSummary.Type | null, StoreError>;
    claimSessionSummary(at: DateTime.Utc): Effect.Effect<typeof SessionSummaryJob.Type | null, StoreError>;
    loadSessionSummarySource(job: typeof SessionSummaryJob.Type): Effect.Effect<SessionSummarySource, StoreError>;
    completeSessionSummary(
      job: typeof SessionSummaryJob.Type,
      generated: GeneratedSessionSummary,
    ): Effect.Effect<boolean, StoreError>;
    retrySessionSummary(
      job: typeof SessionSummaryJob.Type,
      error: string,
      nextAttemptAt: DateTime.Utc,
    ): Effect.Effect<void, StoreError>;
    enqueueSessionSummaryBackfill(limit: number): Effect.Effect<number, StoreError>;
    createFamilyInvite(
      requesterId: FamilyMemberId,
      inviteId: string,
      role: FamilyMemberRole,
      tokenHash: string,
      expiresAt: DateTime.Utc,
    ): Effect.Effect<void, StoreError>;
    redeemFamilyInvite(
      userId: UserId,
      tokenHash: string,
    ): Effect.Effect<FamilyMember, StoreError>;
    setChannelMemberAccess(
      requesterId: FamilyMemberId,
      channelId: ChannelId,
      memberId: FamilyMemberId,
      active: boolean,
    ): Effect.Effect<void, StoreError>;
    listChannels(
      memberId: FamilyMemberId,
    ): Effect.Effect<Array<Channel>, StoreError>;
    createChannel(
      familyId: FamilyId,
      creatorId: FamilyMemberId,
      name: string,
      purpose: string,
    ): Effect.Effect<Channel, StoreError>;
    findChannel(
      channelId: ChannelId,
      memberId: FamilyMemberId,
    ): Effect.Effect<Channel | null, StoreError>;
    createConversationFile(
      input: CreateConversationFileInput,
    ): Effect.Effect<ChannelFile, StoreError>;
    findFile(
      fileId: FileId,
      memberId: FamilyMemberId,
    ): Effect.Effect<ChannelFile | null, StoreError>;
    listChannelFiles(
      channelId: ChannelId,
      memberId: FamilyMemberId,
    ): Effect.Effect<Array<ChannelFile>, StoreError>;
    listConversationFiles(
      conversationId: ConversationId,
      memberId: FamilyMemberId,
    ): Effect.Effect<Array<ChannelFile>, StoreError>;
    deleteFile(
      fileId: FileId,
      memberId: FamilyMemberId,
    ): Effect.Effect<ChannelFile | null, StoreError>;
    createConversation(
      channelId: ChannelId,
      creatorId: FamilyMemberId,
      title: string | null,
    ): Effect.Effect<Conversation, StoreError>;
    setConversationTitleIfEmpty(
      conversationId: ConversationId,
      title: string,
    ): Effect.Effect<void, StoreError>;
    deleteConversation(
      conversationId: ConversationId,
      memberId: FamilyMemberId,
    ): Effect.Effect<boolean, StoreError>;
    listConversations(
      memberId: FamilyMemberId,
    ): Effect.Effect<Array<ConversationSummary>, StoreError>;
    findConversation(
      conversationId: ConversationId,
      memberId: FamilyMemberId,
    ): Effect.Effect<ConversationSummary | null, StoreError>;
    appendMemberMessage(
      conversationId: ConversationId,
      senderId: FamilyMemberId,
      content: MessageContent,
      externalMessageId: string | null,
      replyToMessageId: MessageId | null,
      externalSpeaker?: { readonly id: string; readonly name: string | null },
    ): Effect.Effect<Message, StoreError>;
    appendAgentMessage(
      conversationId: ConversationId,
      memberId: FamilyMemberId,
      content: MessageContent,
      replyToMessageId: MessageId | null,
    ): Effect.Effect<Message, StoreError>;
    listMessages(
      conversationId: ConversationId,
    ): Effect.Effect<Array<Message>, StoreError>;
    listMessagesForMember(
      conversationId: ConversationId,
      memberId: FamilyMemberId,
    ): Effect.Effect<Array<Message>, StoreError>;
    findContextCheckpoint(
      conversationId: ConversationId,
    ): Effect.Effect<ContextCheckpoint | null, StoreError>;
    saveContextCheckpoint(
      checkpoint: Omit<ContextCheckpoint, "compactedAt">,
    ): Effect.Effect<ContextCheckpoint, StoreError>;
    findActiveAgentRun(
      conversationId: ConversationId,
      memberId: FamilyMemberId,
    ): Effect.Effect<AgentRun | null, StoreError>;
    createAgentRun(
      conversationId: ConversationId,
      triggerMessageId: MessageId,
      modelProvider: string,
      modelId: string,
    ): Effect.Effect<AgentRun, StoreError>;
    setAgentRunModel(
      runId: AgentRunId,
      modelProvider: string,
      modelId: string,
    ): Effect.Effect<void, StoreError>;
    succeedAgentRun(runId: AgentRunId): Effect.Effect<AgentRun, StoreError>;
    cancelAgentRun(runId: AgentRunId): Effect.Effect<AgentRun, StoreError>;
    failAgentRun(
      runId: AgentRunId,
      message: string,
    ): Effect.Effect<AgentRun, StoreError>;
  }
>()("ronto/db/RontoStore") {
  static readonly layer = Layer.effect(
    RontoStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const families = yield* SqlModel.makeRepository(Family, {
        tableName: "ronto_family",
        spanPrefix: "RontoStore.family",
        idColumn: "id",
      });
      const familyMembers = yield* SqlModel.makeRepository(FamilyMember, {
        tableName: "ronto_family_member",
        spanPrefix: "RontoStore.familyMember",
        idColumn: "id",
      });
      const channels = yield* SqlModel.makeRepository(Channel, {
        tableName: "ronto_channel",
        spanPrefix: "RontoStore.channel",
        idColumn: "id",
      });
      const conversations = yield* SqlModel.makeRepository(Conversation, {
        tableName: "ronto_conversation",
        spanPrefix: "RontoStore.conversation",
        idColumn: "id",
      });
      const messages = yield* SqlModel.makeRepository(Message, {
        tableName: "ronto_message",
        spanPrefix: "RontoStore.message",
        idColumn: "id",
      });
      const agentRuns = yield* SqlModel.makeRepository(AgentRun, {
        tableName: "ronto_agent_run",
        spanPrefix: "RontoStore.agentRun",
        idColumn: "id",
      });
      const channelFiles = yield* SqlModel.makeRepository(ChannelFile, {
        tableName: "ronto_file",
        spanPrefix: "RontoStore.file",
        idColumn: "id",
      });

      const findMemberInFamily = SqlSchema.findOneOption({
        Request: Schema.Struct({ userId: UserId, familyId: FamilyId }),
        Result: FamilyMember,
        execute: ({ userId, familyId }) => sql`
          SELECT id, family_id, user_id, role, joined_at
          FROM ronto_family_member
          WHERE user_id = ${userId} AND family_id = ${familyId}
        `,
      });
      const findMemberships = SqlSchema.findAll({
        Request: UserId,
        Result: FamilyMembershipRow,
        execute: (userId) => sql`
          SELECT
            member.id AS member_id,
            member.family_id,
            member.user_id,
            member.role,
            member.joined_at,
            family.name AS family_name,
            family.created_at AS family_created_at,
            family.updated_at AS family_updated_at
          FROM ronto_family_member member
          JOIN ronto_family family ON family.id = member.family_id
          WHERE member.user_id = ${userId}
          ORDER BY member.joined_at, member.id
        `,
      });


      const findFamilyMemberSummaries = SqlSchema.findAll({
        Request: FamilyId,
        Result: FamilyMemberSummaryRow,
        execute: (familyId) => sql`
          SELECT
            member.id,
            member.role,
            user.name,
            user.email,
            COALESCE((
              SELECT json_group_array(channel_member.channel_id)
              FROM ronto_channel_member channel_member
              WHERE channel_member.family_member_id = member.id
                AND channel_member.left_at IS NULL
            ), '[]') AS channel_ids_json,
            member.joined_at
          FROM ronto_family_member member
          JOIN user ON user.id = member.user_id
          WHERE member.family_id = ${familyId}
          ORDER BY member.joined_at, member.id
        `,
      });

      const findClaimableInvite = SqlSchema.findOneOption({
        Request: Schema.Struct({
          tokenHash: Schema.String,
          now: Schema.String,
        }),
        Result: ClaimableInvite,
        execute: ({ tokenHash, now }) => sql`
          SELECT id, family_id, role
          FROM ronto_family_invite
          WHERE token_hash = ${tokenHash}
            AND claimed_at IS NULL
            AND expires_at > ${now}
        `,
      });
      const claimInvite = SqlSchema.findOne({
        Request: Schema.Struct({
          inviteId: Schema.String,
          memberId: FamilyMemberId,
          claimedAt: Schema.String,
        }),
        Result: Schema.Struct({ id: Schema.String }),
        execute: ({ inviteId, memberId, claimedAt }) => sql`
          UPDATE ronto_family_invite
          SET claimed_by_member_id = ${memberId}, claimed_at = ${claimedAt}
          WHERE id = ${inviteId} AND claimed_at IS NULL
          RETURNING id
        `,
      });

      const findConversations = SqlSchema.findAll({
        Request: FamilyMemberId,
        Result: ConversationSummary,
        execute: (memberId) => sql`
          SELECT
            c.id,
            c.family_id,
            c.channel_id,
            c.title,
            c.previous_conversation_id,
            c.status,
            c.created_by_member_id,
            COUNT(active.family_member_id) AS participant_count,
            c.created_at,
            c.updated_at
          FROM ronto_conversation c
          JOIN ronto_channel_member channel_mine
            ON channel_mine.channel_id = c.channel_id
            AND channel_mine.family_member_id = ${memberId}
            AND channel_mine.left_at IS NULL
          JOIN ronto_conversation_member mine
            ON mine.conversation_id = c.id
            AND mine.family_member_id = ${memberId}
            AND mine.left_at IS NULL
          JOIN ronto_conversation_member active
            ON active.conversation_id = c.id
            AND active.left_at IS NULL
          GROUP BY c.id
          ORDER BY c.updated_at DESC
        `,
      });

      const AuthorizedConversationRequest = Schema.Struct({
        conversationId: ConversationId,
        memberId: FamilyMemberId,
      });

      const findAuthorizedConversation = SqlSchema.findOneOption({
        Request: AuthorizedConversationRequest,
        Result: ConversationSummary,
        execute: ({ conversationId, memberId }) => sql`
          SELECT
            c.id,
            c.family_id,
            c.channel_id,
            c.title,
            c.previous_conversation_id,
            c.status,
            c.created_by_member_id,
            COUNT(active.family_member_id) AS participant_count,
            c.created_at,
            c.updated_at
          FROM ronto_conversation c
          JOIN ronto_channel_member channel_mine
            ON channel_mine.channel_id = c.channel_id
            AND channel_mine.family_member_id = ${memberId}
            AND channel_mine.left_at IS NULL
          JOIN ronto_conversation_member mine
            ON mine.conversation_id = c.id
            AND mine.family_member_id = ${memberId}
            AND mine.left_at IS NULL
          JOIN ronto_conversation_member active
            ON active.conversation_id = c.id
            AND active.left_at IS NULL
          WHERE c.id = ${conversationId}
          GROUP BY c.id
        `,
      });

      const nextSequence = SqlSchema.findOne({
        Request: ConversationId,
        Result: NextSequence,
        execute: (conversationId) => sql`
          SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
          FROM ronto_message
          WHERE conversation_id = ${conversationId}
        `,
      });

      const findMessages = SqlSchema.findAll({
        Request: ConversationId,
        Result: Message,
        execute: (conversationId) => sql`
          SELECT
            id,
            conversation_id,
            sequence,
            sender_type,
            sender_member_id,
            external_sender_id,
            external_sender_name,
            external_message_id,
            reply_to_message_id,
            content_json,
            created_at
          FROM ronto_message
          WHERE conversation_id = ${conversationId}
          ORDER BY sequence
        `,
      });

      const findCheckpoint = SqlSchema.findOneOption({
        Request: ConversationId,
        Result: ContextCheckpoint,
        execute: (conversationId) => sql`
          SELECT
            conversation_id,
            through_message_sequence,
            first_retained_message_sequence,
            summary,
            tokens_before,
            compacted_at
          FROM ronto_context_checkpoint
          WHERE conversation_id = ${conversationId}
        `,
      });

      const findAuthorizedMessages = SqlSchema.findAll({
        Request: AuthorizedConversationRequest,
        Result: Message,
        execute: ({ conversationId, memberId }) => sql`
          SELECT
            message.id,
            message.conversation_id,
            message.sequence,
            message.sender_type,
            message.sender_member_id,
            message.external_sender_id,
            message.external_sender_name,
            message.external_message_id,
            message.reply_to_message_id,
            message.content_json,
            message.created_at
          FROM ronto_message message
          JOIN ronto_conversation conversation
            ON conversation.id = message.conversation_id
          JOIN ronto_channel_member channel_participant
            ON channel_participant.channel_id = conversation.channel_id
            AND channel_participant.family_member_id = ${memberId}
            AND channel_participant.left_at IS NULL
          JOIN ronto_conversation_member participant
            ON participant.conversation_id = message.conversation_id
            AND participant.family_member_id = ${memberId}
            AND participant.left_at IS NULL
          WHERE message.conversation_id = ${conversationId}
          ORDER BY message.sequence
        `,
      });

      const findAuthorizedActiveRun = SqlSchema.findOneOption({
        Request: AuthorizedConversationRequest,
        Result: AgentRun,
        execute: ({ conversationId, memberId }) => sql`
          SELECT run.*
          FROM ronto_agent_run run
          JOIN ronto_conversation conversation
            ON conversation.id = run.conversation_id
          JOIN ronto_channel_member channel_participant
            ON channel_participant.channel_id = conversation.channel_id
            AND channel_participant.family_member_id = ${memberId}
            AND channel_participant.left_at IS NULL
          JOIN ronto_conversation_member participant
            ON participant.conversation_id = conversation.id
            AND participant.family_member_id = ${memberId}
            AND participant.left_at IS NULL
          WHERE run.conversation_id = ${conversationId}
            AND run.status = 'running'
          ORDER BY run.created_at DESC
          LIMIT 1
        `,
      });

      const findMemberByUserAndFamily = Effect.fn(
        "RontoStore.findMemberByUserAndFamily",
      )(function* (userId: UserId, familyId: FamilyId) {
        return Option.getOrNull(yield* findMemberInFamily({ userId, familyId }));
      });
      const listMembershipsByUser = Effect.fn(
        "RontoStore.listMembershipsByUser",
      )(function* (userId: UserId) {
        return (yield* findMemberships(userId)).map((row) => ({
          family: new Family({
            id: row.familyId,
            name: row.familyName,
            createdAt: row.familyCreatedAt,
            updatedAt: row.familyUpdatedAt,
          }),
          member: new FamilyMember({
            id: row.memberId,
            familyId: row.familyId,
            userId: row.userId,
            role: row.role,
            joinedAt: row.joinedAt,
          }),
        }));
      });

      const findChannels = SqlSchema.findAll({
        Request: FamilyMemberId,
        Result: Channel,
        execute: (memberId) => sql`
          SELECT c.id, c.family_id, c.name, c.purpose, c.is_default, c.created_at, c.updated_at
          FROM ronto_channel c
          JOIN ronto_channel_member cm ON cm.channel_id = c.id
          WHERE cm.family_member_id = ${memberId} AND cm.left_at IS NULL
          ORDER BY c.is_default DESC, c.name COLLATE NOCASE
        `,
      });
      const findAuthorizedChannel = SqlSchema.findOneOption({
        Request: Schema.Struct({
          channelId: ChannelId,
          memberId: FamilyMemberId,
        }),
        Result: Channel,
        execute: ({ channelId, memberId }) => sql`
          SELECT c.id, c.family_id, c.name, c.purpose, c.is_default, c.created_at, c.updated_at
          FROM ronto_channel c JOIN ronto_channel_member cm ON cm.channel_id = c.id
          WHERE c.id = ${channelId} AND cm.family_member_id = ${memberId} AND cm.left_at IS NULL
        `,
      });

      const AuthorizedFileRequest = Schema.Struct({
        fileId: FileId,
        memberId: FamilyMemberId,
      });
      const findAuthorizedFile = SqlSchema.findOneOption({
        Request: AuthorizedFileRequest,
        Result: ChannelFile,
        execute: ({ fileId, memberId }) => sql`
          SELECT file.*
          FROM ronto_file file
          JOIN ronto_channel_member member ON member.channel_id = file.channel_id
          WHERE file.id = ${fileId}
            AND member.family_member_id = ${memberId}
            AND member.left_at IS NULL
        `,
      });
      const findAuthorizedChannelFiles = SqlSchema.findAll({
        Request: Schema.Struct({
          channelId: ChannelId,
          memberId: FamilyMemberId,
        }),
        Result: ChannelFile,
        execute: ({ channelId, memberId }) => sql`
          SELECT file.*
          FROM ronto_file file
          JOIN ronto_channel_member member ON member.channel_id = file.channel_id
          WHERE file.channel_id = ${channelId}
            AND member.family_member_id = ${memberId}
            AND member.left_at IS NULL
          ORDER BY file.created_at DESC, file.id
        `,
      });
      const findAuthorizedConversationFiles = SqlSchema.findAll({
        Request: AuthorizedConversationRequest,
        Result: ChannelFile,
        execute: ({ conversationId, memberId }) => sql`
          SELECT file.*
          FROM ronto_file file
          JOIN ronto_conversation conversation
            ON conversation.id = ${conversationId}
            AND conversation.channel_id = file.channel_id
          JOIN ronto_conversation_member participant
            ON participant.conversation_id = conversation.id
            AND participant.family_member_id = ${memberId}
            AND participant.left_at IS NULL
          JOIN ronto_channel_member channel_member
            ON channel_member.channel_id = file.channel_id
            AND channel_member.family_member_id = ${memberId}
            AND channel_member.left_at IS NULL
          WHERE file.originating_conversation_id = conversation.id
          ORDER BY file.created_at, file.id
        `,
      });
      const ValidFileProvenance = Schema.Struct({ count: Schema.Number });
      const validFileProvenance = SqlSchema.findOne({
        Request: Schema.Struct({
          conversationId: ConversationId,
          channelId: ChannelId,
          messageId: Schema.NullOr(MessageId),
          runId: Schema.NullOr(AgentRunId),
        }),
        Result: ValidFileProvenance,
        execute: ({ conversationId, channelId, messageId, runId }) => sql`
          SELECT COUNT(*) AS count
          FROM ronto_conversation conversation
          WHERE conversation.id = ${conversationId}
            AND conversation.channel_id = ${channelId}
            AND (
              ${messageId} IS NULL OR EXISTS (
                SELECT 1 FROM ronto_message message
                WHERE message.id = ${messageId}
                  AND message.conversation_id = conversation.id
              )
            )
            AND (
              ${runId} IS NULL OR EXISTS (
                SELECT 1 FROM ronto_agent_run run
                WHERE run.id = ${runId}
                  AND run.conversation_id = conversation.id
              )
            )
        `,
      });


      const createFamily = Effect.fn("RontoStore.createFamily")(function* (
        name: string,
        primaryUserId: UserId,
      ) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const grant = yield* SqlSchema.findOneOption({
              Request: UserId,
              Result: Schema.Struct({ id: Schema.String }),
              execute: (userId) => sql`
                SELECT id FROM ronto_family_creation_grant
                WHERE user_id = ${userId} AND status = 'granted'
              `,
            })(primaryUserId);
            if (Option.isNone(grant)) return yield* new Cause.NoSuchElementError();
            const slot = yield* SqlSchema.findOneOption({
              Request: Schema.Void,
              Result: Schema.Struct({ id: FamilyId }),
              execute: () => sql`SELECT id FROM ronto_family_sandbox_slot
                WHERE assigned_family_id IS NULL AND provisioned_at IS NOT NULL
                ORDER BY project_id LIMIT 1`,
            })(undefined);
            if (Option.isNone(slot)) return yield* new FamilyCapacityUnavailable({
              message: "No prepared family space is available. Your creation permission has not been used; contact the platform administrator.",
            });
            const familyInsert = yield* Family.insert.makeEffect({ id: slot.value.id, name });
            const family = yield* families.insert(familyInsert);
            yield* sql`UPDATE ronto_family_sandbox_slot SET assigned_family_id = ${family.id}
              WHERE id = ${slot.value.id} AND assigned_family_id IS NULL`;
            const memberInsert = yield* FamilyMember.insert.makeEffect({
              familyId: family.id,
              userId: primaryUserId,
              role: "primary",
            });
            const member = yield* familyMembers.insert(memberInsert);
            const channelInsert = yield* Channel.insert.makeEffect({
              familyId: family.id,
              name: "General",
              purpose: "",
              isDefault: true,
            });
            const channel = yield* channels.insert(channelInsert);
            yield* sql`INSERT INTO ronto_channel_member (channel_id, family_member_id, joined_at) VALUES (${channel.id}, ${member.id}, ${DateTime.formatIso(channel.createdAt)})`;
            yield* sql`
              UPDATE ronto_family_creation_grant
              SET status = 'consumed', consumed_at = ${DateTime.formatIso(family.createdAt)},
                created_family_id = ${family.id}
              WHERE id = ${grant.value.id} AND status = 'granted'
            `;
            return [family, member] as const;
          }),
        );
      });

      const listFamilyMembers = Effect.fn("RontoStore.listFamilyMembers")(
        function* (requesterId: FamilyMemberId) {
          const requester = yield* familyMembers.findById(requesterId);
          if (requester.role !== "primary")
            return yield* new Cause.NoSuchElementError();
          return (yield* findFamilyMemberSummaries(requester.familyId)).map(
            ({ channelIdsJson, ...member }) => ({
              ...member,
              channelIds: channelIdsJson,
            }),
          );
        },
      );

      const listFamilyMemberProfiles = Effect.fn(
        "RontoStore.listFamilyMemberProfiles",
      )(function* (requesterId: FamilyMemberId) {
        const requester = yield* familyMembers.findById(requesterId);
        return (yield* findFamilyMemberSummaries(requester.familyId)).map(
          ({ id, name }) => ({ id, name }),
        );
      });

      const listChannelMembers = Effect.fn("RontoStore.listChannelMembers")(
        function* (channelId: ChannelId, memberId: FamilyMemberId) {
          const rows = yield* sql`
            SELECT member.id, user.name, member.role
            FROM ronto_channel_member participant
            JOIN ronto_family_member member ON member.id = participant.family_member_id
            JOIN user ON user.id = member.user_id
            JOIN ronto_channel_member mine ON mine.channel_id = participant.channel_id
              AND mine.family_member_id = ${memberId} AND mine.left_at IS NULL
            WHERE participant.channel_id = ${channelId} AND participant.left_at IS NULL
            ORDER BY member.joined_at, member.id
          `;
          return yield* Schema.decodeUnknownEffect(Schema.Array(ChannelRosterMember))(rows);
        },
      );

      const lookupChannelChats = Effect.fn("RontoStore.lookupChannelChats")(
        function* (input: ChatLookup) {
          const rows = yield* sql`
            SELECT conversation_id, title, message_id, sequence, sender_member_id,
              external_sender_id, speaker, created_at, length(body) AS text_length,
              substr(body, CASE WHEN ${input.query} = '' THEN ${input.textOffset + 1}
                ELSE max(1, instr(lower(body), lower(${input.query})) - 120) END,
                ${input.query === "" ? 2000 : 500}) AS text
            FROM (
              SELECT c.id AS conversation_id, c.title, m.id AS message_id, m.sequence,
                m.sender_member_id, m.external_sender_id, m.created_at,
                CASE WHEN m.external_sender_id IS NOT NULL
                  THEN COALESCE(m.external_sender_name, m.external_sender_id)
                  WHEN m.sender_type = 'agent' THEN 'Ronto'
                  ELSE COALESCE(user.name, 'Family member') END AS speaker,
                COALESCE((SELECT group_concat(
                  CASE WHEN json_extract(block.value, '$.type') = 'text'
                    THEN json_extract(block.value, '$.text')
                    ELSE '[File: ' || json_extract(block.value, '$.fileId') || ']' END, char(10))
                  FROM json_each(m.content_json, '$.blocks') block
                  WHERE json_extract(block.value, '$.type') IN ('text', 'file')), '') AS body
              FROM ronto_message m
              JOIN ronto_conversation c ON c.id = m.conversation_id
              JOIN ronto_channel_member mine ON mine.channel_id = c.channel_id
                AND mine.family_member_id = ${input.memberId} AND mine.left_at IS NULL
              JOIN ronto_conversation_member participant ON participant.conversation_id = c.id
                AND participant.family_member_id = ${input.memberId} AND participant.left_at IS NULL
              LEFT JOIN ronto_family_member sender ON sender.id = m.sender_member_id
              LEFT JOIN user ON user.id = sender.user_id
              WHERE c.channel_id = ${input.channelId}
                AND (${input.conversationId} IS NULL OR c.id = ${input.conversationId})
                AND m.sequence > ${input.afterSequence}
            )
            WHERE ${input.query} = '' OR instr(lower(body), lower(${input.query})) > 0
              OR instr(lower(COALESCE(title, '')), lower(${input.query})) > 0
            ORDER BY CASE WHEN ${input.conversationId} IS NULL THEN created_at END DESC,
              conversation_id, sequence
            LIMIT ${input.limit} OFFSET ${input.offset}
          `;
          return yield* Schema.decodeUnknownEffect(Schema.Array(ChatExcerpt))(rows);
        },
      );

      const lookupChannelSummaries = Effect.fn("RontoStore.lookupChannelSummaries")(
        function* (
          channelId: ChannelId,
          memberId: FamilyMemberId,
          query: string,
          offset: number,
          limit: number,
        ) {
          const rows = yield* sql`
            SELECT c.id AS conversation_id, c.title,
              json_extract(summary.summary_json, '$.headline') AS headline,
              json_extract(summary.summary_json, '$.overview') AS overview,
              summary.requested_through_sequence,
              summary.summarized_through_sequence,
              summary.status, summary.updated_at
            FROM ronto_conversation_summary summary
            JOIN ronto_conversation c ON c.id = summary.conversation_id
            JOIN ronto_channel_member mine ON mine.channel_id = c.channel_id
              AND mine.family_member_id = ${memberId} AND mine.left_at IS NULL
            JOIN ronto_conversation_member participant ON participant.conversation_id = c.id
              AND participant.family_member_id = ${memberId} AND participant.left_at IS NULL
            WHERE c.channel_id = ${channelId} AND summary.summary_json IS NOT NULL
              AND (${query} = '' OR instr(lower(summary.search_text), lower(${query})) > 0
                OR instr(lower(COALESCE(c.title, '')), lower(${query})) > 0)
            ORDER BY c.updated_at DESC, c.id
            LIMIT ${limit} OFFSET ${offset}
          `;
          return yield* Schema.decodeUnknownEffect(Schema.Array(ChannelSummaryMatch))(rows);
        },
      );

      const decodeStoredSessionSummary = Effect.fn("RontoStore.decodeStoredSessionSummary")(
        function* (row: typeof StoredSessionSummaryRow.Type) {
          const payload = row.summaryJson === null
            ? null
            : yield* Schema.decodeUnknownEffect(Schema.fromJsonString(SessionSummaryPayload))(row.summaryJson);
          return yield* Schema.decodeUnknownEffect(StoredSessionSummary)({
            conversationId: row.conversationId,
            requestedThroughSequence: row.requestedThroughSequence,
            summarizedThroughSequence: row.summarizedThroughSequence,
            payload,
            status: row.status,
            modelProvider: row.modelProvider,
            modelId: row.modelId,
            updatedAt: row.updatedAt,
          });
        },
      );

      const findSessionSummary = Effect.fn("RontoStore.findSessionSummary")(
        function* (conversationId: ConversationId, memberId: FamilyMemberId) {
          const rows = yield* sql`
            SELECT summary.conversation_id, summary.requested_through_sequence,
              summary.summarized_through_sequence, summary.summary_json,
              summary.status, summary.model_provider, summary.model_id, summary.updated_at
            FROM ronto_conversation_summary summary
            JOIN ronto_conversation c ON c.id = summary.conversation_id
            JOIN ronto_channel_member mine ON mine.channel_id = c.channel_id
              AND mine.family_member_id = ${memberId} AND mine.left_at IS NULL
            JOIN ronto_conversation_member participant ON participant.conversation_id = c.id
              AND participant.family_member_id = ${memberId} AND participant.left_at IS NULL
            WHERE summary.conversation_id = ${conversationId}
            LIMIT 1
          `;
          const row = rows[0];
          if (row === undefined) return null;
          const decoded = yield* Schema.decodeUnknownEffect(StoredSessionSummaryRow)(row);
          return yield* decodeStoredSessionSummary(decoded);
        },
      );

      const claimSessionSummary = Effect.fn("RontoStore.claimSessionSummary")(
        function* (at: DateTime.Utc) {
          return yield* sql.withTransaction(Effect.gen(function* () {
            const now = DateTime.formatIso(at);
            yield* sql`UPDATE ronto_conversation_summary
              SET status = 'pending', claimed_at = NULL, updated_at = ${now},
                next_attempt_at = ${now}, last_error = 'Summary claim expired after restart or interruption'
              WHERE status = 'running' AND claimed_at IS NOT NULL
                AND CAST(strftime('%s', ${now}) AS INTEGER) - CAST(strftime('%s', claimed_at) AS INTEGER) >= 900`;
            const rows = yield* sql`
              UPDATE ronto_conversation_summary
              SET status = 'running', claimed_at = ${now}, updated_at = ${now}
              WHERE conversation_id = (
                SELECT conversation_id FROM ronto_conversation_summary
                WHERE status = 'pending' AND next_attempt_at <= ${now}
                  AND NOT EXISTS (SELECT 1 FROM ronto_agent_run active
                    WHERE active.status IN ('pending', 'running'))
                  AND NOT EXISTS (SELECT 1 FROM ronto_agent_run run
                    WHERE run.conversation_id = ronto_conversation_summary.conversation_id
                      AND run.status IN ('pending', 'running', 'waiting_for_approval'))
                ORDER BY next_attempt_at, created_at, conversation_id LIMIT 1
              )
              RETURNING conversation_id, requested_through_sequence, attempt_count
            `;
            const row = rows[0];
            return row === undefined
              ? null
              : yield* Schema.decodeUnknownEffect(SessionSummaryJob)(row);
          }));
        },
      );

      const loadSessionSummarySource = Effect.fn("RontoStore.loadSessionSummarySource")(
        function* (job: typeof SessionSummaryJob.Type) {
          const messages = (yield* findMessages(job.conversationId))
            .filter((message) => message.sequence <= job.requestedThroughSequence);
          const memberRows = yield* sql<{ id: string; name: string }>`
            SELECT member.id, user.name FROM ronto_family_member member
            JOIN user ON user.id = member.user_id
            WHERE member.family_id = (
              SELECT family_id FROM ronto_conversation WHERE id = ${job.conversationId}
            )`;
          const memberNames = new Map(memberRows.map((member) => [member.id, member.name]));
          const projected = messages.flatMap((message) => {
            const texts = message.contentJson.blocks.flatMap((block) =>
              block.type === "text" ? [block.text] : []
            );
            const fileIds = message.contentJson.blocks.flatMap((block) =>
              block.type === "file" ? [block.fileId] : []
            );
            if (texts.length === 0 && fileIds.length === 0) return [];
            const external = message.externalSenderId !== null;
            const speakerId = external
              ? `whatsapp:${message.externalSenderId}`
              : message.senderMemberId !== null
              ? message.senderMemberId
              : message.senderType === "agent"
              ? "ronto"
              : "system";
            const speakerName = external
              ? message.externalSenderName ?? message.externalSenderId ?? "WhatsApp participant"
              : message.senderMemberId !== null
              ? memberNames.get(message.senderMemberId) ?? "Family member"
              : message.senderType === "agent"
              ? "Ronto"
              : "System";
            return [{
              id: message.id,
              sequence: message.sequence,
              createdAt: DateTime.formatIso(message.createdAt),
              speakerId,
              speakerName,
              text: texts.join("\n"),
              fileIds,
            }];
          });
          const fileIds = [...new Set(projected.flatMap((message) => message.fileIds))];
          const files = fileIds.length === 0
            ? []
            : yield* sql`SELECT file.id, file.name, file.media_type FROM ronto_file file
                JOIN ronto_conversation conversation ON conversation.id = ${job.conversationId}
                  AND conversation.channel_id = file.channel_id
                WHERE file.id IN ${sql.in(fileIds)}`;
          return {
            conversationId: job.conversationId,
            throughSequence: job.requestedThroughSequence,
            messages: projected,
            files: yield* Schema.decodeUnknownEffect(Schema.Array(SessionSummarySourceFile))(files),
          } satisfies SessionSummarySource;
        },
      );

      const completeSessionSummary = Effect.fn("RontoStore.completeSessionSummary")(
        function* (job: typeof SessionSummaryJob.Type, generated: GeneratedSessionSummary) {
          const at = DateTime.formatIso(yield* DateTime.now);
          const summaryJson = JSON.stringify(generated.payload);
          const searchText = renderSessionSummarySearchText(generated.payload);
          const rows = yield* sql`UPDATE ronto_conversation_summary SET
            summarized_through_sequence = ${job.requestedThroughSequence},
            summary_json = ${summaryJson}, search_text = ${searchText}, status = 'current',
            attempt_count = 0, claimed_at = NULL, last_error = NULL,
            model_provider = ${generated.modelProvider}, model_id = ${generated.modelId},
            updated_at = ${at}
            WHERE conversation_id = ${job.conversationId} AND status = 'running'
              AND requested_through_sequence = ${job.requestedThroughSequence}
            RETURNING conversation_id`;
          return rows.length === 1;
        },
      );

      const retrySessionSummary = Effect.fn("RontoStore.retrySessionSummary")(
        function* (
          job: typeof SessionSummaryJob.Type,
          error: string,
          nextAttemptAt: DateTime.Utc,
        ) {
          const at = DateTime.formatIso(yield* DateTime.now);
          yield* sql`UPDATE ronto_conversation_summary SET status = 'pending',
            attempt_count = attempt_count + 1, next_attempt_at = ${DateTime.formatIso(nextAttemptAt)},
            claimed_at = NULL, last_error = ${error.slice(0, 4_000)}, updated_at = ${at}
            WHERE conversation_id = ${job.conversationId} AND status = 'running'
              AND requested_through_sequence = ${job.requestedThroughSequence}`;
        },
      );

      const enqueueSessionSummaryBackfill = Effect.fn("RontoStore.enqueueSessionSummaryBackfill")(
        function* (limit: number) {
          const at = DateTime.formatIso(yield* DateTime.now);
          const rows = yield* sql`
            INSERT INTO ronto_conversation_summary (
              conversation_id, requested_through_sequence, status, attempt_count,
              next_attempt_at, created_at, updated_at
            )
            SELECT candidate.id, candidate.last_sequence, 'pending', 0, ${at}, ${at}, ${at}
            FROM (
              SELECT c.id, MAX(m.sequence) AS last_sequence
              FROM ronto_conversation c JOIN ronto_message m ON m.conversation_id = c.id
              LEFT JOIN ronto_conversation_summary existing ON existing.conversation_id = c.id
              WHERE NOT EXISTS (SELECT 1 FROM ronto_whatsapp_dm_selection dm WHERE dm.conversation_id = c.id)
                AND NOT EXISTS (SELECT 1 FROM ronto_conversation_binding binding
                  WHERE binding.adapter = 'whatsapp' AND binding.conversation_id = c.id)
                AND NOT EXISTS (SELECT 1 FROM ronto_agent_run run
                  WHERE run.conversation_id = c.id AND run.status IN ('pending', 'running', 'waiting_for_approval'))
                AND EXISTS (SELECT 1 FROM ronto_message visible, json_each(visible.content_json, '$.blocks') block
                  WHERE visible.conversation_id = c.id
                    AND json_extract(block.value, '$.type') IN ('text', 'file'))
              GROUP BY c.id
              HAVING existing.conversation_id IS NULL
                OR MAX(m.sequence) > existing.requested_through_sequence
              ORDER BY c.updated_at, c.id LIMIT ${limit}
            ) candidate WHERE true
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
                THEN excluded.updated_at ELSE updated_at END
            RETURNING conversation_id
          `;
          return rows.length;
        },
      );

      const createFamilyInvite = Effect.fn("RontoStore.createFamilyInvite")(
        function* (
          requesterId: FamilyMemberId,
          inviteId: string,
          role: FamilyMemberRole,
          tokenHash: string,
          expiresAt: DateTime.Utc,
        ) {
          const requester = yield* familyMembers.findById(requesterId);
          if (requester.role !== "primary")
            return yield* new Cause.NoSuchElementError();
          const createdAt = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            INSERT INTO ronto_family_invite (
              id, family_id, role, token_hash, created_by_member_id,
              created_at, expires_at
            ) VALUES (
              ${inviteId}, ${requester.familyId}, ${role}, ${tokenHash},
              ${requesterId}, ${createdAt}, ${DateTime.formatIso(expiresAt)}
            )
          `;
        },
      );

      const redeemFamilyInvite = Effect.fn("RontoStore.redeemFamilyInvite")(
        function* (userId: UserId, tokenHash: string) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const now = DateTime.formatIso(yield* DateTime.now);
              const invite = yield* findClaimableInvite({ tokenHash, now });
              if (Option.isNone(invite))
                return yield* new Cause.NoSuchElementError();
              if (Option.isSome(yield* findMemberInFamily({ userId, familyId: invite.value.familyId })))
                return yield* new Cause.NoSuchElementError();
              const member = yield* familyMembers.insert(
                yield* FamilyMember.insert.makeEffect({
                  familyId: invite.value.familyId,
                  userId,
                  role: invite.value.role,
                }),
              );
              yield* sql`
                INSERT INTO ronto_channel_member (
                  channel_id, family_member_id, joined_at
                )
                SELECT channel.id, ${member.id}, ${now}
                FROM ronto_channel channel
                WHERE channel.family_id = ${member.familyId}
                  AND (${member.role} = 'primary' OR channel.is_default = 1)
              `;
              yield* sql`
                INSERT INTO ronto_conversation_member (
                  conversation_id, family_member_id, joined_at
                )
                SELECT conversation.id, ${member.id}, ${now}
                FROM ronto_conversation conversation
                JOIN ronto_channel_member channel_member
                  ON channel_member.channel_id = conversation.channel_id
                  AND channel_member.family_member_id = ${member.id}
                  AND channel_member.left_at IS NULL
                WHERE conversation.status = 'active'
              `;
              yield* claimInvite({
                inviteId: invite.value.id,
                memberId: member.id,
                claimedAt: now,
              });
              return member;
            }),
          );
        },
      );

      const setChannelMemberAccess = Effect.fn(
        "RontoStore.setChannelMemberAccess",
      )(function* (
        requesterId: FamilyMemberId,
        channelId: ChannelId,
        memberId: FamilyMemberId,
        active: boolean,
      ) {
        const requester = yield* familyMembers.findById(requesterId);
        const member = yield* familyMembers.findById(memberId);
        const channel = yield* channels.findById(channelId);
        if (
          requester.role !== "primary" ||
          requester.familyId !== member.familyId ||
          requester.familyId !== channel.familyId ||
          (!active && (member.role === "primary" || channel.isDefault))
        )
          return yield* new Cause.NoSuchElementError();
        const changedAt = DateTime.formatIso(yield* DateTime.now);
        yield* sql.withTransaction(
          active
            ? Effect.gen(function* () {
                yield* sql`
                  INSERT INTO ronto_channel_member (
                    channel_id, family_member_id, joined_at, left_at
                  ) VALUES (${channelId}, ${memberId}, ${changedAt}, NULL)
                  ON CONFLICT (channel_id, family_member_id) DO UPDATE SET
                    joined_at = excluded.joined_at,
                    left_at = NULL
                `;
                yield* sql`
                  INSERT INTO ronto_conversation_member (
                    conversation_id, family_member_id, joined_at, left_at
                  )
                  SELECT id, ${memberId}, ${changedAt}, NULL
                  FROM ronto_conversation
                  WHERE channel_id = ${channelId} AND status = 'active'
                  ON CONFLICT (conversation_id, family_member_id) DO UPDATE SET
                    joined_at = excluded.joined_at,
                    left_at = NULL
                `;
              })
            : Effect.gen(function* () {
                yield* sql`
                  UPDATE ronto_channel_member
                  SET left_at = ${changedAt}
                  WHERE channel_id = ${channelId}
                    AND family_member_id = ${memberId}
                    AND left_at IS NULL
                `;
                yield* sql`
                  UPDATE ronto_conversation_member
                  SET left_at = ${changedAt}
                  WHERE family_member_id = ${memberId}
                    AND left_at IS NULL
                    AND conversation_id IN (
                      SELECT id FROM ronto_conversation
                      WHERE channel_id = ${channelId}
                    )
                `;
              }),
        );
      });

      const listChannels = Effect.fn("RontoStore.listChannels")(function* (
        memberId: FamilyMemberId,
      ) {
        return yield* findChannels(memberId);
      });
      const createChannel = Effect.fn("RontoStore.createChannel")(function* (
        familyId: FamilyId,
        creatorId: FamilyMemberId,
        name: string,
        purpose: string,
      ) {
        const creator = yield* familyMembers.findById(creatorId);
        if (creator.familyId !== familyId)
          return yield* new Cause.NoSuchElementError();
        const insert = yield* Channel.insert.makeEffect({
          familyId,
          name,
          purpose,
          isDefault: false,
        });
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const channel = yield* channels.insert(insert);
            yield* sql`
              INSERT INTO ronto_channel_member (
                channel_id, family_member_id, joined_at
              )
              SELECT ${channel.id}, member.id, ${DateTime.formatIso(channel.createdAt)}
              FROM ronto_family_member member
              WHERE member.family_id = ${familyId}
                AND (member.role = 'primary' OR member.id = ${creatorId})
            `;
            return channel;
          }),
        );
      });
      const findChannel = Effect.fn("RontoStore.findChannel")(function* (
        channelId: ChannelId,
        memberId: FamilyMemberId,
      ) {
        return Option.getOrNull(
          yield* findAuthorizedChannel({ channelId, memberId }),
        );
      });

      const createConversationFile = Effect.fn(
        "RontoStore.createConversationFile",
      )(function* (input: CreateConversationFileInput) {
        const conversation = yield* findAuthorizedConversation({
          conversationId: input.conversationId,
          memberId: input.memberId,
        });
        if (Option.isNone(conversation))
          return yield* new Cause.NoSuchElementError();

        const provenance = yield* validFileProvenance({
          conversationId: input.conversationId,
          channelId: conversation.value.channelId,
          messageId: input.messageId,
          runId: input.runId,
        });
        if (provenance.count !== 1)
          return yield* new Cause.NoSuchElementError();

        const insert = yield* ChannelFile.insert.makeEffect({
          id: input.fileId,
          channelId: conversation.value.channelId,
          originatingConversationId: input.conversationId,
          originatingMessageId: input.messageId,
          originatingRunId: input.runId,
          createdByMemberId: input.memberId,
          kind: input.kind,
          name: input.name,
          storagePath: `files/${input.fileId}/${storageName(input.name)}`,
          mediaType: input.mediaType,
          byteSize: input.byteSize,
          checksum: input.checksum,
        });
        return yield* channelFiles.insert(insert);
      });
      const findFile = Effect.fn("RontoStore.findFile")(function* (
        fileId: FileId,
        memberId: FamilyMemberId,
      ) {
        return Option.getOrNull(
          yield* findAuthorizedFile({ fileId, memberId }),
        );
      });
      const listChannelFiles = Effect.fn("RontoStore.listChannelFiles")(
        function* (channelId: ChannelId, memberId: FamilyMemberId) {
          return yield* findAuthorizedChannelFiles({ channelId, memberId });
        },
      );
      const listConversationFiles = Effect.fn(
        "RontoStore.listConversationFiles",
      )(function* (
        conversationId: ConversationId,
        memberId: FamilyMemberId,
      ) {
        return yield* findAuthorizedConversationFiles({
          conversationId,
          memberId,
        });
      });
      const deleteFile = Effect.fn("RontoStore.deleteFile")(function* (
        fileId: FileId,
        memberId: FamilyMemberId,
      ) {
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            const file = yield* findAuthorizedFile({ fileId, memberId });
            if (Option.isNone(file)) return null;
            const deleted = yield* sql`
              DELETE FROM ronto_file
              WHERE id = ${fileId}
                AND NOT EXISTS (
                  SELECT 1
                  FROM ronto_whatsapp_media_receipt receipt
                  WHERE receipt.file_id = ${fileId}
                    AND receipt.status = 'receiving'
                )
                AND NOT EXISTS (
                  SELECT 1
                  FROM ronto_whatsapp_inbox inbox
                  WHERE inbox.inbound_file_id = ${fileId}
                    AND inbox.status IN ('queued', 'processing')
                )
              RETURNING id
            `;
            if (deleted.length === 0) return null;
            return file.value;
          }),
        );
      });

      const createConversation = Effect.fn("RontoStore.createConversation")(
        function* (
          channelId: ChannelId,
          creatorId: FamilyMemberId,
          title: string | null,
        ) {
          const channel = yield* findAuthorizedChannel({
            channelId,
            memberId: creatorId,
          });
          if (Option.isNone(channel))
            return yield* new Cause.NoSuchElementError();
          const familyId = channel.value.familyId;
          const conversationInsert = yield* Conversation.insert.makeEffect({
            familyId,
            channelId,
            title,
            status: "active",
            createdByMemberId: creatorId,
          });
          const joinedAt = DateTime.formatIso(yield* DateTime.now);

          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const conversation =
                yield* conversations.insert(conversationInsert);
              yield* sql`
                INSERT INTO ronto_conversation_member (conversation_id, family_member_id, joined_at)
                SELECT ${conversation.id}, family_member_id, ${joinedAt}
                FROM ronto_channel_member
                WHERE channel_id = ${channelId} AND left_at IS NULL
              `;
              return conversation;
            }),
          );
        },
      );

      const listConversations = Effect.fn("RontoStore.listConversations")(
        function* (memberId: FamilyMemberId) {
          return yield* findConversations(memberId);
        },
      );

      const setConversationTitleIfEmpty = Effect.fn(
        "RontoStore.setConversationTitleIfEmpty",
      )(function* (conversationId: ConversationId, title: string) {
        yield* sql`
          UPDATE ronto_conversation
          SET title = ${title}
          WHERE id = ${conversationId} AND title IS NULL
        `;
      });

      const deleteConversation = Effect.fn("RontoStore.deleteConversation")(
        function* (
          conversationId: ConversationId,
          memberId: FamilyMemberId,
        ) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const authorized = yield* findAuthorizedConversation({
                conversationId,
                memberId,
              });
              if (Option.isNone(authorized)) return false;
              yield* sql`
                DELETE FROM ronto_conversation
                WHERE id = ${conversationId}
              `;
              return true;
            }),
          );
        },
      );

      const findConversation = Effect.fn("RontoStore.findConversation")(
        function* (conversationId: ConversationId, memberId: FamilyMemberId) {
          return Option.getOrNull(
            yield* findAuthorizedConversation({ conversationId, memberId }),
          );
        },
      );

      const appendMessage = Effect.fn("RontoStore.appendMessage")(function* (
        conversationId: ConversationId,
        senderType: "member" | "agent" | "system",
        senderMemberId: FamilyMemberId | null,
        content: MessageContent,
        externalMessageId: string | null,
        replyToMessageId: MessageId | null,
        externalSenderId: string | null = null,
        externalSenderName: string | null = null,
      ) {
        const { nextSequence: sequence } = yield* nextSequence(conversationId);
        const messageInsert = yield* Message.insert.makeEffect({
          conversationId,
          sequence,
          senderType,
          senderMemberId,
          externalMessageId,
          replyToMessageId,
          externalSenderId,
          externalSenderName,
          contentJson: content,
        });
        const message = yield* messages.insert(messageInsert);
        const at = DateTime.formatIso(message.createdAt);
        yield* sql`UPDATE ronto_conversation_summary SET
          requested_through_sequence = ${message.sequence}, status = 'pending',
          attempt_count = 0, next_attempt_at = ${at}, claimed_at = NULL,
          last_error = NULL, updated_at = ${at}
          WHERE conversation_id = ${conversationId}
            AND requested_through_sequence < ${message.sequence}`;
        return message;
      });

      const appendMemberMessage = Effect.fn("RontoStore.appendMemberMessage")(
        function* (
          conversationId: ConversationId,
          senderId: FamilyMemberId,
          content: MessageContent,
          externalMessageId: string | null,
          replyToMessageId: MessageId | null,
          externalSpeaker?: { readonly id: string; readonly name: string | null },
        ) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const authorized = yield* findAuthorizedConversation({
                conversationId,
                memberId: senderId,
              });
              if (Option.isNone(authorized)) {
                return yield* new Cause.NoSuchElementError();
              }
              for (const block of content.blocks) {
                if (block.type !== "file") continue;
                const file = yield* findAuthorizedFile({
                  fileId: block.fileId,
                  memberId: senderId,
                });
                if (
                  Option.isNone(file) ||
                  file.value.channelId !== authorized.value.channelId
                )
                  return yield* new Cause.NoSuchElementError();
              }
              const message = yield* appendMessage(
                conversationId,
                externalSpeaker === undefined ? "member" : "system",
                externalSpeaker === undefined ? senderId : null,
                content,
                externalMessageId,
                replyToMessageId,
                externalSpeaker?.id ?? null,
                externalSpeaker?.name ?? null,
              );
              for (const block of content.blocks) {
                if (block.type !== "file") continue;
                yield* sql`
                  UPDATE ronto_file
                  SET originating_message_id = ${message.id}
                  WHERE id = ${block.fileId}
                    AND originating_conversation_id = ${conversationId}
                    AND originating_message_id IS NULL
                `;
              }
              return message;
            }),
          );
        },
      );

      const appendAgentMessage = Effect.fn("RontoStore.appendAgentMessage")(
        function* (
          conversationId: ConversationId,
          memberId: FamilyMemberId,
          content: MessageContent,
          replyToMessageId: MessageId | null,
        ) {
          return yield* sql.withTransaction(
            Effect.gen(function* () {
              const authorized = yield* findAuthorizedConversation({
                conversationId,
                memberId,
              });
              if (Option.isNone(authorized))
                return yield* new Cause.NoSuchElementError();
              for (const block of content.blocks) {
                if (block.type !== "file") continue;
                const file = yield* findAuthorizedFile({
                  fileId: block.fileId,
                  memberId,
                });
                if (
                  Option.isNone(file) ||
                  file.value.channelId !== authorized.value.channelId
                )
                  return yield* new Cause.NoSuchElementError();
              }
              const message = yield* appendMessage(
                conversationId,
                "agent",
                null,
                content,
                null,
                replyToMessageId,
              );
              for (const block of content.blocks) {
                if (block.type !== "file") continue;
                yield* sql`
                  UPDATE ronto_file
                  SET originating_message_id = ${message.id}
                  WHERE id = ${block.fileId}
                    AND originating_conversation_id = ${conversationId}
                    AND originating_message_id IS NULL
                `;
              }
              return message;
            }),
          );
        },
      );

      const listMessages = Effect.fn("RontoStore.listMessages")(function* (
        conversationId: ConversationId,
      ) {
        return yield* findMessages(conversationId);
      });

      const listMessagesForMember = Effect.fn(
        "RontoStore.listMessagesForMember",
      )(function* (conversationId: ConversationId, memberId: FamilyMemberId) {
        return yield* findAuthorizedMessages({ conversationId, memberId });
      });

      const findContextCheckpoint = Effect.fn(
        "RontoStore.findContextCheckpoint",
      )(function* (conversationId: ConversationId) {
        return Option.getOrNull(yield* findCheckpoint(conversationId));
      });

      const saveContextCheckpoint = Effect.fn(
        "RontoStore.saveContextCheckpoint",
      )(function* (checkpoint: Omit<ContextCheckpoint, "compactedAt">) {
        const compactedAt = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          INSERT INTO ronto_context_checkpoint (
            conversation_id,
            through_message_sequence,
            first_retained_message_sequence,
            summary,
            tokens_before,
            compacted_at
          ) VALUES (
            ${checkpoint.conversationId},
            ${checkpoint.throughMessageSequence},
            ${checkpoint.firstRetainedMessageSequence},
            ${checkpoint.summary},
            ${checkpoint.tokensBefore},
            ${compactedAt}
          )
          ON CONFLICT (conversation_id) DO UPDATE SET
            through_message_sequence = excluded.through_message_sequence,
            first_retained_message_sequence = excluded.first_retained_message_sequence,
            summary = excluded.summary,
            tokens_before = excluded.tokens_before,
            compacted_at = excluded.compacted_at
          WHERE excluded.through_message_sequence >= ronto_context_checkpoint.through_message_sequence
        `;
        const saved = yield* findCheckpoint(checkpoint.conversationId);
        if (Option.isNone(saved)) return yield* new Cause.NoSuchElementError();
        return saved.value;
      });

      const findActiveAgentRun = Effect.fn("RontoStore.findActiveAgentRun")(
        function* (conversationId: ConversationId, memberId: FamilyMemberId) {
          return Option.getOrNull(
            yield* findAuthorizedActiveRun({ conversationId, memberId }),
          );
        },
      );

      const createAgentRun = Effect.fn("RontoStore.createAgentRun")(function* (
        conversationId: ConversationId,
        triggerMessageId: MessageId,
        modelProvider: string,
        modelId: string,
      ) {
        const startedAt = yield* DateTime.now;
        const insert = yield* AgentRun.insert.makeEffect({
          conversationId,
          triggerMessageId,
          status: "running",
          modelProvider,
          modelId,
          errorJson: null,
          startedAt,
          completedAt: null,
        });
        return yield* agentRuns.insert(insert);
      });

      const succeedAgentRun = Effect.fn("RontoStore.succeedAgentRun")(
        function* (runId: AgentRunId) {
          const completedAt = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            UPDATE ronto_agent_run
            SET status = 'succeeded', completed_at = ${completedAt}
            WHERE id = ${runId}
          `;
          return yield* agentRuns.findById(runId);
        },
      );

      const setAgentRunModel = Effect.fn("RontoStore.setAgentRunModel")(
        function* (runId: AgentRunId, modelProvider: string, modelId: string) {
          yield* sql`
            UPDATE ronto_agent_run
            SET model_provider = ${modelProvider}, model_id = ${modelId}
            WHERE id = ${runId} AND status = 'running'
          `;
        },
      );

      const cancelAgentRun = Effect.fn("RontoStore.cancelAgentRun")(function* (
        runId: AgentRunId,
      ) {
        const completedAt = DateTime.formatIso(yield* DateTime.now);
        yield* sql`
          UPDATE ronto_agent_run
          SET status = 'cancelled', completed_at = ${completedAt}
          WHERE id = ${runId} AND status = 'running'
        `;
        return yield* agentRuns.findById(runId);
      });

      const failAgentRun = Effect.fn("RontoStore.failAgentRun")(function* (
        runId: AgentRunId,
        message: string,
      ) {
        const completedAt = DateTime.formatIso(yield* DateTime.now);
        const errorJson = JSON.stringify({ message });
        yield* sql`
            UPDATE ronto_agent_run
            SET
              status = 'failed',
              error_json = ${errorJson},
              completed_at = ${completedAt}
            WHERE id = ${runId}
          `;
        return yield* agentRuns.findById(runId);
      });

      return RontoStore.of({
        createFamily,
        listFamilyMembers,
        listFamilyMemberProfiles,
        listChannelMembers,
        lookupChannelChats,
        lookupChannelSummaries,
        findSessionSummary,
        claimSessionSummary,
        loadSessionSummarySource,
        completeSessionSummary,
        retrySessionSummary,
        enqueueSessionSummaryBackfill,
        createFamilyInvite,
        redeemFamilyInvite,
        setChannelMemberAccess,
        listChannels,
        createChannel,
        findChannel,
        createConversationFile,
        findFile,
        listChannelFiles,
        listConversationFiles,
        deleteFile,
        findMemberByUserAndFamily,
        listMembershipsByUser,
        createConversation,
        setConversationTitleIfEmpty,
        deleteConversation,
        listConversations,
        findConversation,
        appendMemberMessage,
        appendAgentMessage,
        listMessages,
        listMessagesForMember,
        findContextCheckpoint,
        saveContextCheckpoint,
        findActiveAgentRun,
        createAgentRun,
        setAgentRunModel,
        succeedAgentRun,
        cancelAgentRun,
        failAgentRun,
      });
    }),
  );
}
