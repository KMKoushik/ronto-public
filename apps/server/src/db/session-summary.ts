import { ConversationId, FamilyMemberId, FileId, MessageId } from "@ronto/api";
import { Schema } from "effect";

const shortText = Schema.NonEmptyString.check(Schema.isMaxLength(240));
const detailText = Schema.NonEmptyString.check(Schema.isMaxLength(2_000));
const references = Schema.NonEmptyArray(MessageId).check(Schema.isMaxLength(20));

export const SessionSummaryParticipant = Schema.Struct({
  speakerId: Schema.String.check(Schema.isMaxLength(300)),
  name: shortText,
  contribution: detailText,
  sourceMessageIds: references,
});
export const SessionSummaryDecision = Schema.Struct({
  status: Schema.Literals(["proposed", "decided", "rejected", "unclear"]),
  text: detailText,
  sourceMessageIds: references,
});
export const SessionSummaryTask = Schema.Struct({
  text: detailText,
  ownerSpeakerId: Schema.NullOr(Schema.String.check(Schema.isMaxLength(300))),
  status: Schema.Literals(["proposed", "committed", "completed", "cancelled", "unclear"]),
  dueDate: Schema.NullOr(Schema.String.check(Schema.isMaxLength(80))),
  sourceMessageIds: references,
});
export const SessionSummaryFile = Schema.Struct({
  fileId: FileId,
  name: shortText,
  context: detailText,
  sourceMessageIds: references,
});
export const SessionSummaryPayload = Schema.Struct({
  version: Schema.Literal(1),
  headline: Schema.NonEmptyString.check(Schema.isMaxLength(120)),
  overview: Schema.NonEmptyString.check(Schema.isMaxLength(4_000)),
  topics: Schema.Array(shortText).check(Schema.isMaxLength(16)),
  participants: Schema.Array(SessionSummaryParticipant).check(Schema.isMaxLength(30)),
  decisions: Schema.Array(SessionSummaryDecision).check(Schema.isMaxLength(30)),
  tasks: Schema.Array(SessionSummaryTask).check(Schema.isMaxLength(30)),
  openQuestions: Schema.Array(detailText).check(Schema.isMaxLength(20)),
  files: Schema.Array(SessionSummaryFile).check(Schema.isMaxLength(30)),
  keywords: Schema.Array(shortText).check(Schema.isMaxLength(30)),
});
export type SessionSummaryPayload = typeof SessionSummaryPayload.Type;

export const SessionSummaryJob = Schema.Struct({
  conversationId: ConversationId,
  requestedThroughSequence: Schema.Int.check(Schema.isGreaterThan(0)),
  attemptCount: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});
export type SessionSummaryJob = typeof SessionSummaryJob.Type;

export const SessionSummarySourceMessage = Schema.Struct({
  id: MessageId,
  sequence: Schema.Int.check(Schema.isGreaterThan(0)),
  createdAt: Schema.String,
  speakerId: Schema.String,
  speakerName: Schema.String,
  text: Schema.String,
  fileIds: Schema.Array(FileId),
});
export type SessionSummarySourceMessage = typeof SessionSummarySourceMessage.Type;

export const SessionSummarySourceFile = Schema.Struct({
  id: FileId,
  name: Schema.String,
  mediaType: Schema.String,
});
export type SessionSummarySourceFile = typeof SessionSummarySourceFile.Type;

export interface SessionSummarySource {
  readonly conversationId: ConversationId;
  readonly throughSequence: number;
  readonly messages: ReadonlyArray<SessionSummarySourceMessage>;
  readonly files: ReadonlyArray<SessionSummarySourceFile>;
}

export const StoredSessionSummary = Schema.Struct({
  conversationId: ConversationId,
  requestedThroughSequence: Schema.Int.check(Schema.isGreaterThan(0)),
  summarizedThroughSequence: Schema.NullOr(Schema.Int.check(Schema.isGreaterThan(0))),
  payload: Schema.NullOr(SessionSummaryPayload),
  status: Schema.Literals(["pending", "running", "current"]),
  modelProvider: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  updatedAt: Schema.String,
});
export type StoredSessionSummary = typeof StoredSessionSummary.Type;

export const ChannelSummaryMatch = Schema.Struct({
  conversationId: ConversationId,
  title: Schema.NullOr(Schema.String),
  headline: Schema.String,
  overview: Schema.String,
  requestedThroughSequence: Schema.Int,
  summarizedThroughSequence: Schema.Int,
  status: Schema.Literals(["pending", "running", "current"]),
  updatedAt: Schema.String,
});
export type ChannelSummaryMatch = typeof ChannelSummaryMatch.Type;

export const renderSessionSummarySearchText = (summary: SessionSummaryPayload): string =>
  [
    summary.headline,
    summary.overview,
    ...summary.topics,
    ...summary.keywords,
    ...summary.participants.flatMap((participant) => [participant.name, participant.contribution]),
    ...summary.decisions.map((decision) => `${decision.status}: ${decision.text}`),
    ...summary.tasks.flatMap((task) => [task.text, task.ownerSpeakerId ?? "", task.status, task.dueDate ?? ""]),
    ...summary.openQuestions,
    ...summary.files.flatMap((file) => [file.name, file.context]),
  ].filter((value) => value.length > 0).join("\n").slice(0, 40_000);

export const validateSessionSummaryReferences = (
  summary: SessionSummaryPayload,
  source: SessionSummarySource,
): void => {
  const messageIds = new Set(source.messages.map((message) => message.id));
  const speakerIds = new Set(source.messages.map((message) => message.speakerId));
  const fileIds = new Set(source.files.map((file) => file.id));
  const messagesById = new Map(source.messages.map((message) => [message.id, message]));
  const assertMessages = (ids: ReadonlyArray<MessageId>) => {
    if (ids.some((id) => !messageIds.has(id))) throw new Error("Summary invented a source message reference");
  };
  for (const participant of summary.participants) {
    if (!speakerIds.has(participant.speakerId)) throw new Error("Summary invented a participant reference");
    assertMessages(participant.sourceMessageIds);
    if (participant.sourceMessageIds.some((id) => messagesById.get(id)?.speakerId !== participant.speakerId))
      throw new Error("Summary attributed a contribution to the wrong speaker");
  }
  for (const decision of summary.decisions) assertMessages(decision.sourceMessageIds);
  for (const task of summary.tasks) {
    if (task.ownerSpeakerId !== null && !speakerIds.has(task.ownerSpeakerId))
      throw new Error("Summary invented a task owner reference");
    assertMessages(task.sourceMessageIds);
  }
  for (const file of summary.files) {
    if (!fileIds.has(file.fileId)) throw new Error("Summary invented a file reference");
    assertMessages(file.sourceMessageIds);
    if (file.sourceMessageIds.some((id) => !messagesById.get(id)?.fileIds.includes(file.fileId)))
      throw new Error("Summary attached a file to an unrelated message");
  }
};

export interface GeneratedSessionSummary {
  readonly payload: SessionSummaryPayload;
  readonly modelProvider: string;
  readonly modelId: string;
}

export interface SessionSummaryAuthority {
  readonly memberId: FamilyMemberId;
  readonly conversationId: ConversationId;
}
