import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE ronto_message ADD COLUMN external_sender_id TEXT`;
  yield* sql`ALTER TABLE ronto_message ADD COLUMN external_sender_name TEXT`;

  // sender_member_id remains the authorized member for compatibility. The
  // linked sender is null when a bound group participant is not linked.
  yield* sql`
    ALTER TABLE ronto_whatsapp_inbox
    ADD COLUMN linked_sender_member_id TEXT
      REFERENCES ronto_family_member(id) ON DELETE SET NULL
  `;
  yield* sql`
    ALTER TABLE ronto_whatsapp_inbox ADD COLUMN sender_external_name TEXT
  `;
  yield* sql`
    ALTER TABLE ronto_whatsapp_inbox
    ADD COLUMN inbound_file_id TEXT REFERENCES ronto_file(id) ON DELETE SET NULL
  `;
  yield* sql`
    ALTER TABLE ronto_whatsapp_inbox ADD COLUMN inbound_caption TEXT
  `;
  yield* sql`
    UPDATE ronto_whatsapp_inbox SET linked_sender_member_id = sender_member_id
  `;

  yield* sql`
    CREATE TABLE ronto_whatsapp_media_receipt (
      id TEXT PRIMARY KEY,
      external_channel_id TEXT NOT NULL,
      external_message_id TEXT NOT NULL,
      sender_external_id TEXT NOT NULL,
      sender_external_name TEXT,
      authority_member_id TEXT NOT NULL
        REFERENCES ronto_family_member(id) ON DELETE RESTRICT,
      linked_sender_member_id TEXT
        REFERENCES ronto_family_member(id) ON DELETE SET NULL,
      conversation_id TEXT NOT NULL
        REFERENCES ronto_conversation(id) ON DELETE CASCADE,
      caption TEXT NOT NULL,
      file_id TEXT REFERENCES ronto_file(id) ON DELETE SET NULL,
      inbox_id TEXT UNIQUE
        REFERENCES ronto_whatsapp_inbox(id) ON DELETE CASCADE,
      response_mode TEXT NOT NULL CHECK (response_mode IN ('required', 'optional')),
      trigger_kind TEXT NOT NULL CHECK (
        trigger_kind IN ('dm', 'mention', 'reply', 'command', 'context')
      ),
      status TEXT NOT NULL CHECK (
        status IN ('receiving', 'retryable', 'queued', 'failed')
      ),
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (external_channel_id, external_message_id)
    )
  `;
  yield* sql`
    CREATE INDEX ronto_whatsapp_media_receipt_status_idx
    ON ronto_whatsapp_media_receipt(status, created_at)
    WHERE status IN ('receiving', 'queued')
  `;
  yield* sql`
    CREATE UNIQUE INDEX ronto_whatsapp_inbox_inbound_file_idx
    ON ronto_whatsapp_inbox(inbound_file_id)
    WHERE inbound_file_id IS NOT NULL
  `;
});
