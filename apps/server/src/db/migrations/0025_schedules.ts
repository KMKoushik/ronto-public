import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`CREATE TABLE ronto_schedule (
    id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL REFERENCES ronto_channel(id) ON DELETE CASCADE,
    created_by_member_id TEXT NOT NULL REFERENCES ronto_family_member(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 120),
    instruction TEXT NOT NULL CHECK (length(instruction) BETWEEN 1 AND 2000),
    cron TEXT CHECK (cron IS NULL OR length(cron) BETWEEN 9 AND 100),
    timezone TEXT NOT NULL CHECK (length(timezone) BETWEEN 1 AND 64),
    response_mode TEXT NOT NULL CHECK (response_mode IN ('required', 'optional')),
    status TEXT NOT NULL CHECK (status IN ('active', 'completed', 'cancelled')),
    next_run_at TEXT,
    last_run_at TEXT,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    CHECK ((status = 'active') = (next_run_at IS NOT NULL))
  )`;
  yield* sql`CREATE INDEX ronto_schedule_due_idx
    ON ronto_schedule(next_run_at) WHERE status = 'active'`;
  yield* sql`CREATE INDEX ronto_schedule_channel_idx
    ON ronto_schedule(channel_id, status, created_at)`;
  yield* sql`CREATE TRIGGER ronto_schedule_family_consistency_insert
    BEFORE INSERT ON ronto_schedule WHEN
      (SELECT family_id FROM ronto_channel WHERE id = NEW.channel_id)
        IS NOT (SELECT family_id FROM ronto_family_member WHERE id = NEW.created_by_member_id)
    BEGIN SELECT RAISE(ABORT, 'Cross-family or cross-conversation relationship denied'); END`;
  yield* sql`CREATE TRIGGER ronto_schedule_ownership_immutable
    BEFORE UPDATE OF channel_id, created_by_member_id ON ronto_schedule WHEN
      NEW.channel_id IS NOT OLD.channel_id
        OR NEW.created_by_member_id IS NOT OLD.created_by_member_id
    BEGIN SELECT RAISE(ABORT, 'Ownership is immutable'); END`;
  yield* sql`ALTER TABLE ronto_whatsapp_inbox
    ADD COLUMN schedule_id TEXT REFERENCES ronto_schedule(id) ON DELETE SET NULL`;
});
