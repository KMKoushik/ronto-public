import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE ronto_whatsapp_command (
    external_channel_id TEXT NOT NULL,
    external_message_id TEXT NOT NULL,
    conversation_id TEXT REFERENCES ronto_conversation(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL,
    PRIMARY KEY (external_channel_id, external_message_id)
  )`;
});
