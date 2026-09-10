import { NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";

import { DatabaseLive } from "./database.ts";

Layer.build(DatabaseLive).pipe(
  Effect.scoped,
  Effect.asVoid,
  NodeRuntime.runMain,
);
