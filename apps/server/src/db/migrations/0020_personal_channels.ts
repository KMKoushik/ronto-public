import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`ALTER TABLE ronto_channel ADD COLUMN personal_owner_member_id TEXT
    REFERENCES ronto_family_member(id) ON DELETE RESTRICT`;
  yield* sql`CREATE UNIQUE INDEX ronto_channel_personal_owner_idx
    ON ronto_channel(personal_owner_member_id)
    WHERE personal_owner_member_id IS NOT NULL`;
  yield* sql`CREATE TRIGGER ronto_channel_personal_owner_insert
    BEFORE INSERT ON ronto_channel
    WHEN NEW.personal_owner_member_id IS NOT NULL AND NEW.family_id <>
      (SELECT family_id FROM ronto_family_member WHERE id = NEW.personal_owner_member_id)
    BEGIN SELECT RAISE(ABORT, 'Personal channel owner must belong to the family'); END`;
  yield* sql`CREATE TRIGGER ronto_channel_personal_owner_update
    BEFORE UPDATE OF personal_owner_member_id ON ronto_channel
    WHEN NEW.personal_owner_member_id IS NOT OLD.personal_owner_member_id
    BEGIN SELECT RAISE(ABORT, 'Personal channel ownership is immutable'); END`;
  yield* sql`CREATE TRIGGER ronto_channel_personal_members_insert
    BEFORE INSERT ON ronto_channel_member
    WHEN (SELECT personal_owner_member_id FROM ronto_channel WHERE id = NEW.channel_id) IS NOT NULL
      AND NEW.family_member_id IS NOT (SELECT personal_owner_member_id FROM ronto_channel WHERE id = NEW.channel_id)
    BEGIN SELECT RAISE(ABORT, 'Personal channels accept only their owner'); END`;
  yield* sql`CREATE TRIGGER ronto_channel_personal_members_update
    BEFORE UPDATE OF family_member_id, left_at ON ronto_channel_member
    WHEN NEW.left_at IS NULL
      AND (SELECT personal_owner_member_id FROM ronto_channel WHERE id = NEW.channel_id) IS NOT NULL
      AND NEW.family_member_id IS NOT (SELECT personal_owner_member_id FROM ronto_channel WHERE id = NEW.channel_id)
    BEGIN SELECT RAISE(ABORT, 'Personal channels accept only their owner'); END`;

  // Existing selections start fresh in personal channels. Prior General
  // sessions remain canonical history with their original ownership.
  yield* sql`INSERT INTO ronto_channel (
      id, family_id, name, purpose, is_default, created_at, updated_at,
      personal_owner_member_id
    )
    SELECT 'personal-channel-' || member.id, member.family_id,
      'Personal ' || member.id, 'Personal direct conversations', 0,
      selection.updated_at, selection.updated_at, member.id
    FROM ronto_whatsapp_dm_selection selection
    JOIN ronto_family_member member
      ON member.user_id = selection.user_id AND member.family_id = selection.family_id`;
  yield* sql`INSERT INTO ronto_channel_member (channel_id, family_member_id, joined_at)
    SELECT 'personal-channel-' || member.id, member.id, selection.updated_at
    FROM ronto_whatsapp_dm_selection selection
    JOIN ronto_family_member member
      ON member.user_id = selection.user_id AND member.family_id = selection.family_id`;
  yield* sql`INSERT INTO ronto_conversation (
      id, family_id, channel_id, title, status, created_by_member_id,
      created_at, updated_at, archived_at
    )
    SELECT 'personal-session-' || member.id, member.family_id,
      'personal-channel-' || member.id, NULL, 'active', member.id,
      selection.updated_at, selection.updated_at, NULL
    FROM ronto_whatsapp_dm_selection selection
    JOIN ronto_family_member member
      ON member.user_id = selection.user_id AND member.family_id = selection.family_id`;
  yield* sql`INSERT INTO ronto_conversation_member (
      conversation_id, family_member_id, joined_at
    )
    SELECT 'personal-session-' || member.id, member.id, selection.updated_at
    FROM ronto_whatsapp_dm_selection selection
    JOIN ronto_family_member member
      ON member.user_id = selection.user_id AND member.family_id = selection.family_id`;
  yield* sql`UPDATE ronto_whatsapp_dm_selection AS selection
    SET conversation_id = 'personal-session-' || (
      SELECT member.id FROM ronto_family_member member
      WHERE member.user_id = selection.user_id AND member.family_id = selection.family_id
    )`;
});
