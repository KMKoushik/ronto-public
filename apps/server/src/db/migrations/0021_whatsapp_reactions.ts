import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE ronto_whatsapp_outbox_next (
    id TEXT PRIMARY KEY,
    inbox_id TEXT NOT NULL REFERENCES ronto_whatsapp_inbox(id) ON DELETE CASCADE,
    assistant_message_id TEXT REFERENCES ronto_message(id) ON DELETE CASCADE,
    external_channel_id TEXT NOT NULL,
    part_index INTEGER NOT NULL CHECK (part_index >= 0),
    text TEXT NOT NULL CHECK (length(text) > 0),
    provider_message_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
    next_attempt_at TEXT NOT NULL,
    last_error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    delivery_kind TEXT NOT NULL DEFAULT 'text'
      CHECK (delivery_kind IN ('text', 'file', 'reaction')),
    file_id TEXT REFERENCES ronto_file(id) ON DELETE SET NULL,
    approval_id TEXT REFERENCES ronto_tool_approval(tool_call_id) ON DELETE SET NULL,
    UNIQUE (inbox_id, part_index),
    CHECK (
      (delivery_kind = 'reaction' AND assistant_message_id IS NULL
        AND file_id IS NULL AND approval_id IS NULL AND part_index = 0
        AND text IN ('👍', '❤️', '😂', '😮', '😢', '🙏'))
      OR
      (delivery_kind IN ('text', 'file') AND assistant_message_id IS NOT NULL)
    )
  )`;
  yield* sql`INSERT INTO ronto_whatsapp_outbox_next (
      id, inbox_id, assistant_message_id, external_channel_id, part_index,
      text, provider_message_id, status, attempt_count, next_attempt_at,
      last_error, created_at, updated_at, delivery_kind, file_id, approval_id
    ) SELECT
      id, inbox_id, assistant_message_id, external_channel_id, part_index,
      text, provider_message_id, status, attempt_count, next_attempt_at,
      last_error, created_at, updated_at, delivery_kind, file_id, approval_id
    FROM ronto_whatsapp_outbox`;
  yield* sql`DROP TABLE ronto_whatsapp_outbox`;
  yield* sql`ALTER TABLE ronto_whatsapp_outbox_next RENAME TO ronto_whatsapp_outbox`;

  yield* sql`CREATE INDEX ronto_whatsapp_outbox_pending_idx
    ON ronto_whatsapp_outbox(status, next_attempt_at)
    WHERE status IN ('pending', 'sending')`;
  yield* sql`CREATE INDEX ronto_whatsapp_outbox_file_idx
    ON ronto_whatsapp_outbox(file_id) WHERE file_id IS NOT NULL`;
  yield* sql`CREATE INDEX ronto_whatsapp_outbox_approval_idx
    ON ronto_whatsapp_outbox(approval_id) WHERE approval_id IS NOT NULL`;

  const invalid = `
    (NEW.assistant_message_id IS NOT NULL AND
      (SELECT conversation_id FROM ronto_whatsapp_inbox WHERE id = NEW.inbox_id)
        <> (SELECT conversation_id FROM ronto_message WHERE id = NEW.assistant_message_id))
    OR NEW.external_channel_id <> (SELECT external_channel_id FROM ronto_whatsapp_inbox WHERE id = NEW.inbox_id)
    OR (NEW.file_id IS NOT NULL AND
      (SELECT c.channel_id FROM ronto_whatsapp_inbox i JOIN ronto_conversation c ON c.id = i.conversation_id WHERE i.id = NEW.inbox_id)
        <> (SELECT channel_id FROM ronto_file WHERE id = NEW.file_id))
    OR (NEW.approval_id IS NOT NULL AND
      (SELECT conversation_id FROM ronto_whatsapp_inbox WHERE id = NEW.inbox_id)
        <> (SELECT r.conversation_id FROM ronto_tool_call t JOIN ronto_agent_run r ON r.id = t.run_id WHERE t.id = NEW.approval_id))`;
  for (const event of ["INSERT", "UPDATE"]) {
    yield* sql.unsafe(`CREATE TRIGGER ronto_whatsapp_outbox_family_consistency_${event.toLowerCase()}
      BEFORE ${event} ON ronto_whatsapp_outbox WHEN ${invalid}
      BEGIN SELECT RAISE(ABORT, 'Cross-family or cross-conversation relationship denied'); END`);
  }
});
