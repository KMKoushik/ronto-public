import { DateTime, Effect, Layer } from "effect";

import { RontoStore } from "../db/ronto-store.ts";
import { AgentService } from "./agent-service.ts";

export const SessionSummaryWorkerLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const store = yield* RontoStore;
    const agent = yield* AgentService;
    const processNext = Effect.fn("SessionSummaryWorker.processNext")(function* () {
      const job = yield* store.claimSessionSummary(yield* DateTime.now);
      if (job === null) return false;
      const completed = yield* Effect.gen(function* () {
        const source = yield* store.loadSessionSummarySource(job);
        const generated = yield* agent.generateSessionSummary(source);
        yield* store.completeSessionSummary(job, generated);
      }).pipe(Effect.result);
      if (completed._tag === "Success") return true;
      const delaySeconds = Math.min(3_600, 30 * 2 ** Math.min(job.attemptCount, 7));
      const retryAt = DateTime.add(yield* DateTime.now, { seconds: delaySeconds });
      yield* store.retrySessionSummary(job, String(completed.failure), retryAt).pipe(
        Effect.catchCause((cause) => Effect.logError("Could not reschedule session summary", cause)),
      );
      yield* Effect.logWarning(
        `Session summary failed; retrying in ${delaySeconds} seconds`,
        completed.failure,
      );
      return true;
    });
    const worker = Effect.gen(function* () {
      while (true) {
        if (yield* processNext().pipe(
          Effect.catchCause((cause) =>
            Effect.logError("Session summary worker failed", cause).pipe(Effect.as(false))
          ),
        )) continue;
        yield* Effect.sleep("1 second");
      }
    });
    yield* Effect.forkScoped(worker);
  }),
);
