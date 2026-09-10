import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE ronto_whatsapp_outbox
    ADD COLUMN delivery_kind TEXT NOT NULL DEFAULT 'text'
      CHECK (delivery_kind IN ('text', 'file'))
  `;
  yield* sql`
    ALTER TABLE ronto_whatsapp_outbox
    ADD COLUMN file_id TEXT REFERENCES ronto_file(id) ON DELETE SET NULL
  `;
  yield* sql`
    CREATE INDEX ronto_whatsapp_outbox_file_idx
    ON ronto_whatsapp_outbox(file_id)
    WHERE file_id IS NOT NULL
  `;
});
