import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  buildContextEntries,
  buildSessionContext,
  calculateContextTokens,
  DEFAULT_COMPACTION_SETTINGS,
  estimateTokens,
  findCutPoint,
  shouldCompact,
  type compact,
  type CompactionEntry,
  type CompactionResult,
  type FileOperations,
  type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type { ConversationId } from "@ronto/api";
import { Option, Schema } from "effect";

type CompactionPreparation = Parameters<typeof compact>[0];

export interface ProjectedContextMessage {
  readonly sequence: number;
  readonly message: AgentMessage;
}

export interface ContextCheckpointData {
  readonly conversationId: ConversationId;
  readonly throughMessageSequence: number;
  readonly firstRetainedMessageSequence: number | null;
  readonly summary: string;
  readonly tokensBefore: number;
  readonly compactedAt: number;
}

export interface ContextCheckpointDraft {
  readonly conversationId: ConversationId;
  readonly throughMessageSequence: number;
  readonly firstRetainedMessageSequence: number | null;
  readonly summary: string;
  readonly tokensBefore: number;
}

export type ContextCompactionRunner = (
  preparation: CompactionPreparation,
  signal?: AbortSignal,
) => Promise<CompactionResult>;

const messageEntryId = (
  projected: ProjectedContextMessage,
  index: number,
): string => `ronto-message:${projected.sequence}:${index}`;

const contextEntries = (
  projected: ReadonlyArray<ProjectedContextMessage>,
  checkpoint: ContextCheckpointData | null,
): Array<SessionEntry> => {
  const entries: Array<SessionEntry> = [];
  let parentId: string | null = null;
  const append = (entry: SessionEntry) => {
    entries.push(entry);
    parentId = entry.id;
  };
  const appendCheckpoint = (checkpoint: ContextCheckpointData) => {
    const id = `ronto-compaction:${checkpoint.throughMessageSequence}`;
    const firstRetained = projected.findIndex(
      ({ sequence }) =>
        checkpoint.firstRetainedMessageSequence !== null &&
        sequence >= checkpoint.firstRetainedMessageSequence &&
        sequence <= checkpoint.throughMessageSequence,
    );
    const retained = projected[firstRetained];
    const compactionEntry: CompactionEntry = {
      type: "compaction",
      id,
      parentId,
      timestamp: new Date(checkpoint.compactedAt).toISOString(),
      summary: checkpoint.summary,
      // Pi retains the path from this entry up to the checkpoint; pointing at
      // the checkpoint itself retains nothing.
      firstKeptEntryId:
        retained === undefined ? id : messageEntryId(retained, firstRetained),
      tokensBefore: checkpoint.tokensBefore,
    };
    append(compactionEntry);
  };

  let checkpointPending = checkpoint;
  for (const [index, item] of projected.entries()) {
    if (
      checkpointPending !== null &&
      item.sequence > checkpointPending.throughMessageSequence
    ) {
      appendCheckpoint(checkpointPending);
      checkpointPending = null;
    }
    append({
      type: "message",
      id: messageEntryId(item, index),
      parentId,
      timestamp: new Date(item.message.timestamp).toISOString(),
      message: item.message,
    });
  }
  if (checkpointPending !== null) appendCheckpoint(checkpointPending);
  return entries;
};

const usageTokens = (message: AgentMessage): number =>
  message.role === "assistant" &&
  message.stopReason !== "aborted" &&
  message.stopReason !== "error"
    ? calculateContextTokens(message.usage)
    : 0;

const estimateContextTokens = (messages: ReadonlyArray<AgentMessage>): number => {
  let trailingTokens = 0;
  for (const message of messages.toReversed()) {
    const usage = usageTokens(message);
    if (usage > 0) return usage + trailingTokens;
    trailingTokens += estimateTokens(message);
  }
  return trailingTokens;
};

const entryMessages = (entries: ReadonlyArray<SessionEntry>): Array<AgentMessage> =>
  entries.flatMap((entry) => (entry.type === "message" ? [entry.message] : []));

const decodeFileArguments = Schema.decodeUnknownOption(
  Schema.Struct({ path: Schema.String }),
);

const fileOperations = (messages: ReadonlyArray<AgentMessage>): FileOperations => {
  const operations: FileOperations = {
    read: new Set(),
    written: new Set(),
    edited: new Set(),
  };
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const block of message.content) {
      if (block.type !== "toolCall") continue;
      const path = Option.getOrNull(decodeFileArguments(block.arguments))?.path;
      if (path === undefined) continue;
      if (block.name === "read") operations.read.add(path);
      else if (block.name === "write") operations.written.add(path);
      else if (block.name === "edit") operations.edited.add(path);
    }
  }
  return operations;
};

// Pi keeps its own preparation private. Ronto context is a linear message chain
// behind at most one checkpoint, so Pi's public cut-point search is sufficient.
const prepareCompaction = (
  entries: Array<SessionEntry>,
  tokensBefore: number,
): CompactionPreparation | undefined => {
  const context = buildContextEntries(entries);
  const [head] = context;
  const previous = head?.type === "compaction" ? head : undefined;
  const start = previous === undefined ? 0 : 1;
  const settings = DEFAULT_COMPACTION_SETTINGS;
  const cut = findCutPoint(context, start, context.length, settings.keepRecentTokens);
  const firstKept = context[cut.firstKeptEntryIndex];
  if (firstKept === undefined) return undefined;

  const historyEnd = cut.isSplitTurn ? cut.turnStartIndex : cut.firstKeptEntryIndex;
  const messagesToSummarize = entryMessages(context.slice(start, historyEnd));
  const turnPrefixMessages = cut.isSplitTurn
    ? entryMessages(context.slice(cut.turnStartIndex, cut.firstKeptEntryIndex))
    : [];
  if (messagesToSummarize.length === 0 && turnPrefixMessages.length === 0)
    return undefined;

  const preparation: CompactionPreparation = {
    firstKeptEntryId: firstKept.id,
    messagesToSummarize,
    turnPrefixMessages,
    isSplitTurn: cut.isSplitTurn,
    tokensBefore,
    fileOps: fileOperations([...messagesToSummarize, ...turnPrefixMessages]),
    settings,
  };
  if (previous !== undefined) preparation.previousSummary = previous.summary;
  return preparation;
};

export const projectConversationContext = (
  projected: ReadonlyArray<ProjectedContextMessage>,
  checkpoint: ContextCheckpointData | null,
): Array<AgentMessage> =>
  buildSessionContext(contextEntries(projected, checkpoint)).messages;

export const compactConversationContext = async (
  conversationId: ConversationId,
  projected: ReadonlyArray<ProjectedContextMessage>,
  checkpoint: ContextCheckpointData | null,
  contextWindow: number,
  runCompaction: ContextCompactionRunner,
  signal?: AbortSignal,
): Promise<ContextCheckpointDraft | null> => {
  const entries = contextEntries(projected, checkpoint);
  const tokens = estimateContextTokens(buildSessionContext(entries).messages);
  if (!shouldCompact(tokens, contextWindow, DEFAULT_COMPACTION_SETTINGS))
    return null;

  const preparation = prepareCompaction(entries, tokens);
  if (preparation === undefined) return null;
  const result = await runCompaction(preparation, signal);
  if (result.summary.trim().length === 0)
    throw new Error("Pi returned an empty context summary");

  // A canonical assistant message expands into complete tool-call/result pairs.
  // Round retention back to that message, preserving its full evidence and
  // preventing orphaned tool results when the checkpoint is reconstructed.
  const firstRetained = projected.find(
    (item, index) => messageEntryId(item, index) === result.firstKeptEntryId,
  );
  if (firstRetained === undefined)
    throw new Error("Pi retained context outside the canonical message projection");
  const throughMessageSequence = projected.at(-1)?.sequence;
  if (throughMessageSequence === undefined) return null;

  return {
    conversationId,
    throughMessageSequence,
    firstRetainedMessageSequence: firstRetained.sequence,
    summary: result.summary,
    tokensBefore: result.tokensBefore,
  };
};
