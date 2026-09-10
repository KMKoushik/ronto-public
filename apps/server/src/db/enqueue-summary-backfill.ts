import { NodeRuntime } from "@effect/platform-node";
import { Effect, Schema } from "effect";

import { DatabaseLive } from "./database.ts";
import { RontoStore } from "./ronto-store.ts";

const Limit = Schema.NumberFromString.pipe(
  Schema.check(Schema.isInt()),
  Schema.check(Schema.isBetween({ minimum: 1, maximum: 1_000 })),
);
const limit = Schema.decodeUnknownSync(Limit)(process.argv[2] ?? "100");

Effect.gen(function* () {
  const store = yield* RontoStore;
  const queued = yield* store.enqueueSessionSummaryBackfill(limit);
  yield* Effect.log(`Enqueued or refreshed ${queued} session summary records`);
}).pipe(
  Effect.provide(RontoStore.layer),
  Effect.provide(DatabaseLive),
  NodeRuntime.runMain,
);
