import { DateTime, Effect, Layer } from "effect";

import { RontoStore } from "../db/ronto-store.ts";
import { AgentService } from "./agent-service.ts";
import { ChannelWorkspace } from "./channel-workspace.ts";

export const FamilyMemoryMaintenanceWorkerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* RontoStore;
    const agent = yield* AgentService;
    const workspace = yield* ChannelWorkspace;
    const processNext = Effect.fn("FamilyMemoryMaintenanceWorker.processNext")(function* () {
      const job = yield* store.claimFamilyMemoryMaintenance(yield* DateTime.now);
      if (job === null) return false;
      const completed = yield* Effect.gen(function* () {
        let modelProvider: string | null = null;
        let modelId: string | null = null;
        const memory = yield* workspace.readFamilyMemory(job.familyId);
        if (memory.content.trim().length > 0) {
          const generated = yield* agent.generateFamilyMemoryCleanup(
            job.familyId,
            memory.content,
            `family:${job.familyId}`,
          );
          if (generated.content !== memory.content) {
            yield* workspace.writeFamilyMemory(job.familyId, generated.content, memory.revision);
          }
          modelProvider = generated.modelProvider;
          modelId = generated.modelId;
        }
        for (const channelId of yield* store.listFamilyChannelIds(job.familyId)) {
          const channelMemory = yield* workspace.readMemory(channelId);
          if (channelMemory.content.trim().length === 0) continue;
          const cleaned = yield* agent.generateFamilyMemoryCleanup(
            job.familyId,
            channelMemory.content,
            `channel:${channelId}`,
          );
          if (cleaned.content !== channelMemory.content) {
            yield* workspace.writeMemory(channelId, cleaned.content, channelMemory.revision);
          }
          modelProvider = cleaned.modelProvider;
          modelId = cleaned.modelId;
        }
        const next = DateTime.add(yield* DateTime.now, { days: 1 });
        yield* store.completeFamilyMemoryMaintenance(
          job,
          modelProvider,
          modelId,
          next,
        );
      }).pipe(Effect.result);
      if (completed._tag === "Success") return true;
      const delayMinutes = Math.min(360, 5 * 2 ** Math.min(job.attemptCount, 6));
      const retryAt = DateTime.add(yield* DateTime.now, { minutes: delayMinutes });
      yield* store.retryFamilyMemoryMaintenance(job, String(completed.failure), retryAt).pipe(
        Effect.catchCause((cause) => Effect.logError("Could not reschedule family memory maintenance", cause)),
      );
      yield* Effect.logWarning(
        `Family memory maintenance failed; retrying in ${delayMinutes} minutes`,
        completed.failure,
      );
      return true;
    });
    const worker = Effect.gen(function* () {
      while (true) {
        if (yield* processNext().pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Family memory maintenance worker failed", cause).pipe(Effect.as(false))
          ),
        )) continue;
        yield* Effect.sleep("1 minute");
      }
    });
    yield* Effect.forkScoped(worker);
  }),
);
