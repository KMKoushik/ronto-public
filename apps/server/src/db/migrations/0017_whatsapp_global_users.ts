import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`CREATE TABLE ronto_external_identity_next (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
    adapter TEXT NOT NULL,
    external_user_id TEXT NOT NULL,
    display_name TEXT,
    created_at TEXT NOT NULL,
    UNIQUE (adapter, external_user_id)
  )`;
  yield* sql`INSERT INTO ronto_external_identity_next (
    id, user_id, adapter, external_user_id, display_name, created_at
  ) SELECT identity.id, member.user_id, identity.adapter,
      identity.external_user_id, identity.display_name, identity.created_at
    FROM ronto_external_identity identity
    JOIN ronto_family_member member ON member.id = identity.family_member_id`;
  yield* sql`DROP TABLE ronto_external_identity`;
  yield* sql`ALTER TABLE ronto_external_identity_next RENAME TO ronto_external_identity`;
  yield* sql`CREATE INDEX ronto_external_identity_user_idx
    ON ronto_external_identity (user_id, adapter)`;

  yield* sql`CREATE TABLE ronto_whatsapp_dm_selection (
    user_id TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
    family_id TEXT NOT NULL,
    conversation_id TEXT NOT NULL UNIQUE REFERENCES ronto_conversation(id) ON DELETE CASCADE,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (family_id, user_id)
      REFERENCES ronto_family_member(family_id, user_id) ON DELETE RESTRICT
  )`;
  yield* sql`CREATE TRIGGER ronto_whatsapp_dm_selection_family_insert
    BEFORE INSERT ON ronto_whatsapp_dm_selection
    WHEN (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id) <> NEW.family_id
    BEGIN SELECT RAISE(ABORT, 'WhatsApp DM conversation family mismatch'); END`;
  yield* sql`CREATE TRIGGER ronto_whatsapp_dm_selection_family_update
    BEFORE UPDATE OF family_id, conversation_id ON ronto_whatsapp_dm_selection
    WHEN (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id) <> NEW.family_id
    BEGIN SELECT RAISE(ABORT, 'WhatsApp DM conversation family mismatch'); END`;
});
