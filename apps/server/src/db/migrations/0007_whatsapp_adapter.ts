import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE ronto_whatsapp_claim (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('identity', 'conversation')),
    token_hash TEXT NOT NULL UNIQUE,
    family_member_id TEXT REFERENCES ronto_family_member(id) ON DELETE CASCADE,
    conversation_id TEXT REFERENCES ronto_conversation(id) ON DELETE CASCADE,
    created_by_member_id TEXT NOT NULL REFERENCES ronto_family_member(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    claimed_at TEXT,
    CHECK ((kind = 'identity' AND family_member_id IS NOT NULL AND conversation_id IS NULL)
      OR (kind = 'conversation' AND family_member_id IS NULL AND conversation_id IS NOT NULL))
  )`;
  yield* sql`CREATE INDEX ronto_whatsapp_claim_token_idx ON ronto_whatsapp_claim(token_hash)`;

  yield* sql`CREATE TABLE ronto_whatsapp_inbox (
    id TEXT PRIMARY KEY,
    external_channel_id TEXT NOT NULL,
    external_message_id TEXT NOT NULL,
    sender_external_id TEXT NOT NULL,
    sender_member_id TEXT NOT NULL REFERENCES ronto_family_member(id) ON DELETE RESTRICT,
    conversation_id TEXT NOT NULL REFERENCES ronto_conversation(id) ON DELETE CASCADE,
    text TEXT NOT NULL CHECK (length(text) > 0),
    response_mode TEXT NOT NULL CHECK (response_mode IN ('required', 'optional')),
    trigger_kind TEXT NOT NULL CHECK (trigger_kind IN ('dm', 'mention', 'reply', 'command', 'context')),
    status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'responded', 'silent', 'failed')),
    canonical_message_id TEXT REFERENCES ronto_message(id) ON DELETE SET NULL,
    run_id TEXT REFERENCES ronto_agent_run(id) ON DELETE SET NULL,
    error TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    UNIQUE (external_channel_id, external_message_id)
  )`;
  yield* sql`CREATE INDEX ronto_whatsapp_inbox_pending_idx ON ronto_whatsapp_inbox(status, created_at) WHERE status IN ('queued', 'processing')`;

  yield* sql`CREATE TABLE ronto_whatsapp_outbox (
    id TEXT PRIMARY KEY,
    inbox_id TEXT NOT NULL REFERENCES ronto_whatsapp_inbox(id) ON DELETE CASCADE,
    assistant_message_id TEXT NOT NULL REFERENCES ronto_message(id) ON DELETE CASCADE,
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
    UNIQUE (inbox_id, part_index)
  )`;
  yield* sql`CREATE INDEX ronto_whatsapp_outbox_pending_idx ON ronto_whatsapp_outbox(status, next_attempt_at) WHERE status IN ('pending', 'sending')`;

  yield* sql`CREATE TABLE ronto_whatsapp_auth (
    category TEXT NOT NULL,
    key TEXT NOT NULL,
    value_json TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    PRIMARY KEY (category, key)
  )`;
});
