import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ronto_context_checkpoint (
      conversation_id TEXT PRIMARY KEY REFERENCES ronto_conversation(id) ON DELETE CASCADE,
      through_message_sequence INTEGER NOT NULL CHECK (through_message_sequence > 0),
      first_retained_message_sequence INTEGER CHECK (first_retained_message_sequence > 0),
      summary TEXT NOT NULL CHECK (length(summary) > 0),
      tokens_before INTEGER NOT NULL CHECK (tokens_before >= 0),
      compacted_at TEXT NOT NULL,
      FOREIGN KEY (conversation_id, through_message_sequence)
        REFERENCES ronto_message(conversation_id, sequence) ON DELETE CASCADE,
      FOREIGN KEY (conversation_id, first_retained_message_sequence)
        REFERENCES ronto_message(conversation_id, sequence) ON DELETE CASCADE,
      CHECK (
        first_retained_message_sequence IS NULL OR
        first_retained_message_sequence <= through_message_sequence
      )
    )
  `;
});
