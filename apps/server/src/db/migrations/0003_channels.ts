import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ronto_channel (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES ronto_family(id) ON DELETE RESTRICT,
      name TEXT NOT NULL,
      purpose TEXT NOT NULL DEFAULT '',
      is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`CREATE UNIQUE INDEX ronto_channel_family_name_idx ON ronto_channel (family_id, lower(name))`;
  yield* sql`CREATE UNIQUE INDEX ronto_channel_one_default_idx ON ronto_channel (family_id) WHERE is_default = 1`;
  yield* sql`
    CREATE TABLE ronto_channel_member (
      channel_id TEXT NOT NULL REFERENCES ronto_channel(id) ON DELETE CASCADE,
      family_member_id TEXT NOT NULL REFERENCES ronto_family_member(id) ON DELETE RESTRICT,
      joined_at TEXT NOT NULL,
      left_at TEXT,
      PRIMARY KEY (channel_id, family_member_id),
      CHECK (left_at IS NULL OR left_at >= joined_at)
    )
  `;
  yield* sql`CREATE INDEX ronto_channel_member_member_idx ON ronto_channel_member (family_member_id, left_at)`;

  // Use stable IDs for migrated channels so the migration is safe to retry/inspect.
  yield* sql`
    INSERT INTO ronto_channel (id, family_id, name, purpose, is_default, created_at, updated_at)
    SELECT 'channel-' || id, id, 'General', '', 1, created_at, updated_at FROM ronto_family
  `;
  yield* sql`
    INSERT INTO ronto_channel_member (channel_id, family_member_id, joined_at)
    SELECT 'channel-' || family_id, id, joined_at FROM ronto_family_member
  `;

  yield* sql`ALTER TABLE ronto_conversation ADD COLUMN channel_id TEXT REFERENCES ronto_channel(id) ON DELETE RESTRICT`;
  yield* sql`
    UPDATE ronto_conversation SET channel_id = 'channel-' || family_id WHERE channel_id IS NULL
  `;
  yield* sql`CREATE INDEX ronto_conversation_channel_updated_idx ON ronto_conversation (channel_id, updated_at DESC)`;
  yield* sql`
    CREATE TRIGGER ronto_conversation_channel_required_insert
    BEFORE INSERT ON ronto_conversation
    WHEN NEW.channel_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM ronto_channel WHERE id = NEW.channel_id AND family_id = NEW.family_id
    )
    BEGIN SELECT RAISE(ABORT, 'conversation channel is required and must belong to family'); END
  `;
  yield* sql`
    CREATE TRIGGER ronto_conversation_channel_required_update
    BEFORE UPDATE OF channel_id, family_id ON ronto_conversation
    WHEN NEW.channel_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM ronto_channel WHERE id = NEW.channel_id AND family_id = NEW.family_id
    )
    BEGIN SELECT RAISE(ABORT, 'conversation channel is required and must belong to family'); END
  `;
});
