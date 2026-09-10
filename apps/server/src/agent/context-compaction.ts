import {
  buildSessionContext,
  DEFAULT_COMPACTION_SETTINGS,
  estimateContextTokens,
  prepareCompaction,
  shouldCompact,
  type AgentMessage,
  type CompactResult,
  type CompactionEntry,
  type CompactionPreparation,
  type Entry,
} from "@earendil-works/pi-agent-core";
import type { ConversationId } from "@ronto/api";

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
) => Promise<CompactResult>;

const messageEntry = (
  projected: ProjectedContextMessage,
  parentId: string | null,
  index: number,
): Entry => ({
  type: "message",
  id: `ronto-message:${projected.sequence}:${index}`,
  seq: projected.sequence,
  parentId,
  timestamp: projected.message.timestamp,
  message: projected.message,
});

const contextEntries = (
  projected: ReadonlyArray<ProjectedContextMessage>,
  checkpoint: ContextCheckpointData | null,
): Array<Entry> => {
  if (checkpoint === null) {
    let parentId: string | null = null;
    return projected.map((item, index) => {
      const entry = messageEntry(item, parentId, index);
      parentId = entry.id;
      return entry;
    });
  }

  const retained = projected.filter(
    ({ sequence }) =>
      checkpoint.firstRetainedMessageSequence !== null &&
      sequence >= checkpoint.firstRetainedMessageSequence &&
      sequence <= checkpoint.throughMessageSequence,
  );
  const checkpointId = `ronto-compaction:${checkpoint.throughMessageSequence}`;
  const compactionEntry: CompactionEntry = {
    type: "compaction",
    id: checkpointId,
    seq: checkpoint.throughMessageSequence,
    parentId: null,
    timestamp: checkpoint.compactedAt,
    summary: checkpoint.summary,
    retainedTail: retained.map(({ message }) => message),
    tokensBefore: checkpoint.tokensBefore,
  };
  const entries: Array<Entry> = [compactionEntry];
  let parentId = checkpointId;
  for (const [index, item] of projected.entries()) {
    if (item.sequence <= checkpoint.throughMessageSequence) continue;
    const entry = messageEntry(item, parentId, index);
    entries.push(entry);
    parentId = entry.id;
  }
  return entries;
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
  const messages = buildSessionContext(entries).messages;
  const tokens = estimateContextTokens(messages).tokens;
  if (!shouldCompact(tokens, contextWindow, DEFAULT_COMPACTION_SETTINGS))
    return null;

  const preparation = prepareCompaction(entries, DEFAULT_COMPACTION_SETTINGS);
  if (!preparation.ok) throw preparation.error;
  if (preparation.value === undefined) return null;
  const result = await runCompaction(preparation.value, signal);
  if (result.summary.trim().length === 0)
    throw new Error("Pi returned an empty context summary");

  const firstRetained = result.retainedTail.at(0);
  // A canonical assistant message expands into complete tool-call/result pairs.
  // Round retention back to that message, preserving its full evidence and
  // preventing orphaned tool results when the checkpoint is reconstructed.
  const firstRetainedMessageSequence =
    firstRetained === undefined
      ? null
      : (projected.find(({ message }) => message === firstRetained)?.sequence ??
        null);
  if (firstRetained !== undefined && firstRetainedMessageSequence === null)
    throw new Error("Pi retained context outside the canonical message projection");
  const throughMessageSequence = projected.at(-1)?.sequence;
  if (throughMessageSequence === undefined) return null;

  return {
    conversationId,
    throughMessageSequence,
    firstRetainedMessageSequence,
    summary: result.summary,
    tokensBefore: result.tokensBefore,
  };
};
