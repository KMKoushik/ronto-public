import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE ronto_conversation ADD COLUMN previous_conversation_id TEXT
    REFERENCES ronto_conversation(id) ON DELETE SET NULL`;
  yield* sql`CREATE INDEX ronto_conversation_previous_idx
    ON ronto_conversation(previous_conversation_id)`;
  yield* sql`CREATE TRIGGER ronto_conversation_previous_insert
    BEFORE INSERT ON ronto_conversation
    WHEN NEW.previous_conversation_id IS NOT NULL AND (
      NEW.previous_conversation_id = NEW.id OR NOT EXISTS (
        SELECT 1 FROM ronto_conversation previous
        WHERE previous.id = NEW.previous_conversation_id
          AND previous.channel_id = NEW.channel_id AND previous.family_id = NEW.family_id
      )
    ) BEGIN SELECT RAISE(ABORT, 'Previous session must belong to the same channel'); END`;
  yield* sql`CREATE TRIGGER ronto_conversation_previous_update
    BEFORE UPDATE OF previous_conversation_id ON ronto_conversation
    WHEN NEW.previous_conversation_id IS NOT NULL
      AND NEW.previous_conversation_id IS NOT OLD.previous_conversation_id
    BEGIN SELECT RAISE(ABORT, 'Previous session is immutable'); END`;
});
