import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function*() {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ronto_family (
      id TEXT PRIMARY KEY,
      singleton INTEGER NOT NULL DEFAULT 1 UNIQUE CHECK (singleton = 1),
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE ronto_family_member (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES ronto_family(id) ON DELETE RESTRICT,
      user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN ('primary', 'member')),
      joined_at TEXT NOT NULL,
      UNIQUE (family_id, user_id)
    )
  `;

  yield* sql`
    CREATE INDEX ronto_family_member_family_idx
    ON ronto_family_member (family_id)
  `;

  yield* sql`
    CREATE TABLE ronto_external_identity (
      id TEXT PRIMARY KEY,
      family_member_id TEXT NOT NULL REFERENCES ronto_family_member(id) ON DELETE CASCADE,
      adapter TEXT NOT NULL,
      external_user_id TEXT NOT NULL,
      display_name TEXT,
      created_at TEXT NOT NULL,
      UNIQUE (adapter, external_user_id)
    )
  `;

  yield* sql`
    CREATE INDEX ronto_external_identity_member_idx
    ON ronto_external_identity (family_member_id)
  `;

  yield* sql`
    CREATE TABLE ronto_conversation (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES ronto_family(id) ON DELETE RESTRICT,
      title TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
      created_by_member_id TEXT REFERENCES ronto_family_member(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      archived_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX ronto_conversation_family_updated_idx
    ON ronto_conversation (family_id, updated_at DESC)
  `;

  yield* sql`
    CREATE TABLE ronto_conversation_member (
      conversation_id TEXT NOT NULL REFERENCES ronto_conversation(id) ON DELETE CASCADE,
      family_member_id TEXT NOT NULL REFERENCES ronto_family_member(id) ON DELETE RESTRICT,
      joined_at TEXT NOT NULL,
      left_at TEXT,
      PRIMARY KEY (conversation_id, family_member_id),
      CHECK (left_at IS NULL OR left_at >= joined_at)
    )
  `;

  yield* sql`
    CREATE INDEX ronto_conversation_member_member_idx
    ON ronto_conversation_member (family_member_id, left_at)
  `;

  yield* sql`
    CREATE TABLE ronto_conversation_binding (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ronto_conversation(id) ON DELETE CASCADE,
      adapter TEXT NOT NULL,
      external_channel_id TEXT NOT NULL,
      external_thread_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      UNIQUE (adapter, external_channel_id, external_thread_id)
    )
  `;

  yield* sql`
    CREATE INDEX ronto_conversation_binding_conversation_idx
    ON ronto_conversation_binding (conversation_id)
  `;

  yield* sql`
    CREATE TABLE ronto_message (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ronto_conversation(id) ON DELETE CASCADE,
      sequence INTEGER NOT NULL CHECK (sequence > 0),
      sender_type TEXT NOT NULL CHECK (sender_type IN ('member', 'agent', 'system', 'tool')),
      sender_member_id TEXT,
      external_message_id TEXT,
      reply_to_message_id TEXT REFERENCES ronto_message(id) ON DELETE SET NULL,
      content_json TEXT NOT NULL CHECK (json_valid(content_json)),
      created_at TEXT NOT NULL,
      UNIQUE (conversation_id, sequence),
      UNIQUE (conversation_id, external_message_id),
      UNIQUE (id, conversation_id),
      FOREIGN KEY (conversation_id, sender_member_id)
        REFERENCES ronto_conversation_member(conversation_id, family_member_id) ON DELETE RESTRICT,
      CHECK (
        (sender_type = 'member' AND sender_member_id IS NOT NULL) OR
        (sender_type != 'member' AND sender_member_id IS NULL)
      )
    )
  `;

  yield* sql`
    CREATE INDEX ronto_message_conversation_created_idx
    ON ronto_message (conversation_id, created_at)
  `;

  yield* sql`
    CREATE TABLE ronto_agent_run (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL REFERENCES ronto_conversation(id) ON DELETE CASCADE,
      trigger_message_id TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('pending', 'running', 'waiting_for_approval', 'succeeded', 'failed', 'cancelled')
      ),
      model_provider TEXT,
      model_id TEXT,
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      FOREIGN KEY (trigger_message_id, conversation_id)
        REFERENCES ronto_message(id, conversation_id) ON DELETE RESTRICT
    )
  `;

  yield* sql`
    CREATE INDEX ronto_agent_run_conversation_created_idx
    ON ronto_agent_run (conversation_id, created_at DESC)
  `;

  yield* sql`
    CREATE INDEX ronto_agent_run_status_idx
    ON ronto_agent_run (status)
  `;

  yield* sql`
    CREATE TABLE ronto_tool_call (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES ronto_agent_run(id) ON DELETE CASCADE,
      provider_call_id TEXT,
      tool_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (
        status IN ('proposed', 'waiting_for_approval', 'running', 'succeeded', 'failed', 'cancelled')
      ),
      input_json TEXT NOT NULL CHECK (json_valid(input_json)),
      output_json TEXT CHECK (output_json IS NULL OR json_valid(output_json)),
      error_json TEXT CHECK (error_json IS NULL OR json_valid(error_json)),
      idempotency_key TEXT UNIQUE,
      created_at TEXT NOT NULL,
      started_at TEXT,
      completed_at TEXT,
      UNIQUE (run_id, provider_call_id)
    )
  `;

  yield* sql`
    CREATE INDEX ronto_tool_call_run_created_idx
    ON ronto_tool_call (run_id, created_at)
  `;

  yield* sql`
    CREATE TABLE ronto_tool_approval (
      tool_call_id TEXT PRIMARY KEY REFERENCES ronto_tool_call(id) ON DELETE CASCADE,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
      decided_by_member_id TEXT REFERENCES ronto_family_member(id) ON DELETE SET NULL,
      requested_at TEXT NOT NULL,
      decided_at TEXT,
      CHECK (
        (status = 'pending' AND decided_at IS NULL) OR
        (status IN ('approved', 'rejected') AND decided_at IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE TABLE ronto_artifact (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES ronto_family(id) ON DELETE RESTRICT,
      conversation_id TEXT REFERENCES ronto_conversation(id) ON DELETE CASCADE,
      message_id TEXT REFERENCES ronto_message(id) ON DELETE SET NULL,
      run_id TEXT REFERENCES ronto_agent_run(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('screenshot', 'video', 'trace', 'download', 'attachment')),
      storage_path TEXT NOT NULL UNIQUE,
      media_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      checksum TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT
    )
  `;

  yield* sql`
    CREATE INDEX ronto_artifact_conversation_created_idx
    ON ronto_artifact (conversation_id, created_at)
  `;
});
