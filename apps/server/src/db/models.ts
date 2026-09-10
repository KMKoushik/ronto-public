import {
  AgentRunId,
  AgentRunStatus,
  ConversationId,
  ChannelId,
  ConversationStatus,
  FileId,
  FileKind,
  FamilyId,
  FamilyMemberId,
  FamilyMemberRole,
  MessageContent,
  MessageId,
  MessageSenderType,
  UserId,
} from "@ronto/api";
import { Schema } from "effect";
import { Model } from "effect/unstable/schema";

export {
  AgentRunId,
  ConversationId,
  ChannelId,
  FamilyId,
  FamilyMemberId,
  FileId,
  MessageContent,
  MessageId,
  UserId,
};

export class Family extends Model.Class<Family>("Family")({
  id: Model.UuidV4Insert(FamilyId),
  name: Schema.NonEmptyString,
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate,
}) {}

export class FamilyMember extends Model.Class<FamilyMember>("FamilyMember")({
  id: Model.UuidV4Insert(FamilyMemberId),
  familyId: FamilyId,
  userId: UserId,
  role: FamilyMemberRole,
  joinedAt: Model.DateTimeInsert,
}) {}

export class Channel extends Model.Class<Channel>("Channel")({
  id: Model.UuidV4Insert(ChannelId),
  familyId: FamilyId,
  name: Schema.NonEmptyString,
  purpose: Schema.String,
  isDefault: Schema.BooleanFromBit,
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate,
}) {}

export class Conversation extends Model.Class<Conversation>("Conversation")({
  id: Model.UuidV4Insert(ConversationId),
  familyId: FamilyId,
  channelId: ChannelId,
  title: Schema.NullOr(Schema.NonEmptyString),
  status: ConversationStatus,
  createdByMemberId: Schema.NullOr(FamilyMemberId),
  createdAt: Model.DateTimeInsert,
  updatedAt: Model.DateTimeUpdate,
}) {}

export class Message extends Model.Class<Message>("Message")({
  id: Model.UuidV4Insert(MessageId),
  conversationId: ConversationId,
  sequence: Schema.Int.check(Schema.isGreaterThan(0)),
  senderType: MessageSenderType,
  senderMemberId: Schema.NullOr(FamilyMemberId),
  externalSenderId: Schema.NullOr(Schema.String),
  externalSenderName: Schema.NullOr(Schema.String),
  externalMessageId: Schema.NullOr(Schema.String),
  replyToMessageId: Schema.NullOr(MessageId),
  contentJson: Schema.fromJsonString(MessageContent),
  createdAt: Model.DateTimeInsert,
}) {}

export class AgentRun extends Model.Class<AgentRun>("AgentRun")({
  id: Model.UuidV4Insert(AgentRunId),
  conversationId: ConversationId,
  triggerMessageId: MessageId,
  status: AgentRunStatus,
  modelProvider: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  errorJson: Schema.NullOr(Schema.String),
  createdAt: Model.DateTimeInsert,
  startedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
}) {}

export class ContextCheckpoint extends Model.Class<ContextCheckpoint>(
  "ContextCheckpoint",
)({
  conversationId: ConversationId,
  throughMessageSequence: Schema.Int.check(Schema.isGreaterThan(0)),
  firstRetainedMessageSequence: Schema.NullOr(
    Schema.Int.check(Schema.isGreaterThan(0)),
  ),
  summary: Schema.NonEmptyString,
  tokensBefore: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  compactedAt: Schema.DateTimeUtcFromString,
}) {}

export class ChannelFile extends Model.Class<ChannelFile>("ChannelFile")({
  id: Model.UuidV4Insert(FileId),
  channelId: ChannelId,
  originatingConversationId: Schema.NullOr(ConversationId),
  originatingMessageId: Schema.NullOr(MessageId),
  originatingRunId: Schema.NullOr(AgentRunId),
  createdByMemberId: Schema.NullOr(FamilyMemberId),
  kind: FileKind,
  name: Schema.NonEmptyString,
  storagePath: Schema.NonEmptyString,
  mediaType: Schema.NonEmptyString,
  byteSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  checksum: Schema.NonEmptyString,
  createdAt: Model.DateTimeInsert,
}) {}
