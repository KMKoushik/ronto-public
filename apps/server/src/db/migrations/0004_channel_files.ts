import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ronto_file (
      id TEXT PRIMARY KEY,
      channel_id TEXT NOT NULL REFERENCES ronto_channel(id) ON DELETE RESTRICT,
      originating_conversation_id TEXT REFERENCES ronto_conversation(id) ON DELETE SET NULL,
      originating_message_id TEXT REFERENCES ronto_message(id) ON DELETE SET NULL,
      originating_run_id TEXT REFERENCES ronto_agent_run(id) ON DELETE SET NULL,
      created_by_member_id TEXT REFERENCES ronto_family_member(id) ON DELETE SET NULL,
      kind TEXT NOT NULL CHECK (kind IN ('upload', 'download', 'generated')),
      name TEXT NOT NULL CHECK (length(name) > 0),
      storage_path TEXT NOT NULL UNIQUE CHECK (length(storage_path) > 0),
      media_type TEXT NOT NULL CHECK (length(media_type) > 0),
      byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
      checksum TEXT NOT NULL CHECK (length(checksum) > 0),
      created_at TEXT NOT NULL
    )
  `;
  yield* sql`
    INSERT INTO ronto_file (
      id,
      channel_id,
      originating_conversation_id,
      originating_message_id,
      originating_run_id,
      created_by_member_id,
      kind,
      name,
      storage_path,
      media_type,
      byte_size,
      checksum,
      created_at
    )
    SELECT
      artifact.id,
      COALESCE(conversation.channel_id, default_channel.id),
      artifact.conversation_id,
      artifact.message_id,
      artifact.run_id,
      NULL,
      CASE artifact.kind
        WHEN 'attachment' THEN 'upload'
        WHEN 'download' THEN 'download'
        ELSE 'generated'
      END,
      artifact.id,
      artifact.storage_path,
      artifact.media_type,
      artifact.byte_size,
      artifact.checksum,
      artifact.created_at
    FROM ronto_artifact artifact
    LEFT JOIN ronto_conversation conversation ON conversation.id = artifact.conversation_id
    JOIN ronto_channel default_channel
      ON default_channel.family_id = artifact.family_id
      AND default_channel.is_default = 1
  `;
  yield* sql`DROP TABLE ronto_artifact`;
  yield* sql`CREATE INDEX ronto_file_channel_created_idx ON ronto_file (channel_id, created_at DESC)`;
  yield* sql`CREATE INDEX ronto_file_conversation_idx ON ronto_file (originating_conversation_id)`;
});
