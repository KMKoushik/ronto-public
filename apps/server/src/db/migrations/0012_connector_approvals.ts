import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE ronto_tool_call
    ADD COLUMN family_member_id TEXT
      REFERENCES ronto_family_member(id) ON DELETE CASCADE
  `;
  yield* sql`
    ALTER TABLE ronto_tool_call
    ADD COLUMN connector_connection_id TEXT
      REFERENCES ronto_connector_connection(id) ON DELETE CASCADE
  `;
  yield* sql`
    ALTER TABLE ronto_tool_call
    ADD COLUMN connector_action_id TEXT
  `;
  yield* sql`
    ALTER TABLE ronto_tool_call
    ADD COLUMN approval_title TEXT
  `;
  yield* sql`
    ALTER TABLE ronto_tool_call
    ADD COLUMN approval_description TEXT
  `;
  yield* sql`
    ALTER TABLE ronto_tool_approval
    ADD COLUMN expires_at TEXT
  `;
  yield* sql`
    ALTER TABLE ronto_tool_approval
    ADD COLUMN execution_status TEXT NOT NULL DEFAULT 'pending'
      CHECK (execution_status IN (
        'pending', 'running', 'succeeded', 'failed', 'outcome_unknown'
      ))
  `;
  yield* sql`
    ALTER TABLE ronto_tool_approval
    ADD COLUMN origin TEXT NOT NULL DEFAULT 'web'
      CHECK (origin IN ('web', 'whatsapp'))
  `;
  yield* sql`
    ALTER TABLE ronto_tool_approval
    ADD COLUMN result_message_id TEXT
      REFERENCES ronto_message(id) ON DELETE SET NULL
  `;
  yield* sql`
    ALTER TABLE ronto_whatsapp_outbox
    ADD COLUMN approval_id TEXT
      REFERENCES ronto_tool_approval(tool_call_id) ON DELETE SET NULL
  `;
  yield* sql`
    CREATE INDEX ronto_tool_call_member_status_idx
    ON ronto_tool_call(family_member_id, status, created_at)
  `;
  yield* sql`
    CREATE INDEX ronto_whatsapp_outbox_approval_idx
    ON ronto_whatsapp_outbox(approval_id)
    WHERE approval_id IS NOT NULL
  `;
});
