import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ronto_family_invite (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES ronto_family(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('primary', 'member')),
      token_hash TEXT NOT NULL UNIQUE,
      created_by_member_id TEXT NOT NULL REFERENCES ronto_family_member(id) ON DELETE CASCADE,
      claimed_by_member_id TEXT UNIQUE REFERENCES ronto_family_member(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      claimed_at TEXT,
      CHECK (
        (claimed_by_member_id IS NULL AND claimed_at IS NULL) OR
        (claimed_by_member_id IS NOT NULL AND claimed_at IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE INDEX ronto_family_invite_family_created_idx
    ON ronto_family_invite (family_id, created_at DESC)
  `;

  yield* sql`
    INSERT INTO ronto_channel_member (
      channel_id, family_member_id, joined_at
    )
    SELECT channel.id, member.id, member.joined_at
    FROM ronto_channel channel
    JOIN ronto_family_member member
      ON member.family_id = channel.family_id
      AND member.role = 'primary'
    WHERE NOT EXISTS (
      SELECT 1 FROM ronto_channel_member existing
      WHERE existing.channel_id = channel.id
        AND existing.family_member_id = member.id
        AND existing.left_at IS NULL
    )
    ON CONFLICT (channel_id, family_member_id) DO UPDATE SET left_at = NULL
  `;

  yield* sql`
    INSERT INTO ronto_conversation_member (
      conversation_id, family_member_id, joined_at
    )
    SELECT conversation.id, member.id, member.joined_at
    FROM ronto_conversation conversation
    JOIN ronto_family_member member
      ON member.family_id = conversation.family_id
      AND member.role = 'primary'
    WHERE NOT EXISTS (
      SELECT 1 FROM ronto_conversation_member existing
      WHERE existing.conversation_id = conversation.id
        AND existing.family_member_id = member.id
        AND existing.left_at IS NULL
    )
    ON CONFLICT (conversation_id, family_member_id) DO UPDATE SET left_at = NULL
  `;
});
