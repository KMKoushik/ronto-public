import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE ronto_family_memory_maintenance (
    family_id TEXT PRIMARY KEY REFERENCES ronto_family(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT NOT NULL,
    claimed_at TEXT,
    reviewed_at TEXT,
    last_error TEXT,
    model_provider TEXT,
    model_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (status = 'running' OR claimed_at IS NULL)
  )`;
  yield* sql`CREATE INDEX ronto_family_memory_maintenance_work_idx
    ON ronto_family_memory_maintenance(status, next_attempt_at, updated_at)`;
});
