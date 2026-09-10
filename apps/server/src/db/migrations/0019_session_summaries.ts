import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE ronto_conversation_summary (
    conversation_id TEXT PRIMARY KEY REFERENCES ronto_conversation(id) ON DELETE CASCADE,
    requested_through_sequence INTEGER NOT NULL CHECK (requested_through_sequence > 0),
    summarized_through_sequence INTEGER CHECK (
      summarized_through_sequence IS NULL OR (
        summarized_through_sequence > 0 AND
        summarized_through_sequence <= requested_through_sequence
      )
    ),
    summary_json TEXT CHECK (summary_json IS NULL OR json_valid(summary_json)),
    search_text TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'current')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT NOT NULL,
    claimed_at TEXT,
    last_error TEXT,
    model_provider TEXT,
    model_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK (
      (summary_json IS NULL AND search_text IS NULL AND summarized_through_sequence IS NULL)
      OR
      (summary_json IS NOT NULL AND search_text IS NOT NULL AND summarized_through_sequence IS NOT NULL)
    ),
    CHECK (status <> 'current' OR summarized_through_sequence = requested_through_sequence),
    CHECK (status = 'running' OR claimed_at IS NULL)
  )`;
  yield* sql`CREATE INDEX ronto_conversation_summary_work_idx
    ON ronto_conversation_summary(status, next_attempt_at, updated_at)`;
});
