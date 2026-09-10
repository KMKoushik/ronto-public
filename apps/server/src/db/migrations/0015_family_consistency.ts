import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

// These are source-owned SQL expressions, not identifiers or SQL from requests.
// Keep parent ownership immutable so updating a parent cannot invalidate an
// already-checked child. Nullable provenance can still be cleared on deletion.
// Subquery comparisons deliberately use <>: during cascading deletion a parent
// can already be absent. Foreign keys enforce existence, these triggers enforce
// matching ownership between parents that exist.
const ownership = [
  ["ronto_family_member", "family_id"],
  ["ronto_channel", "family_id"],
  ["ronto_conversation", "family_id"],
  ["ronto_conversation", "channel_id"],
  ["ronto_message", "conversation_id"],
  ["ronto_agent_run", "conversation_id"],
  ["ronto_file", "channel_id"],
  ["ronto_tool_call", "run_id"],
  ["ronto_tool_call", "family_member_id"],
  ["ronto_connector_connection", "family_member_id"],
  ["ronto_whatsapp_inbox", "conversation_id"],
  ["ronto_whatsapp_media_receipt", "conversation_id"],
] as const;

const relationships = [
  { table: "ronto_channel_member", invalid: `
    (SELECT family_id FROM ronto_channel WHERE id = NEW.channel_id)
      <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.family_member_id)` },
  { table: "ronto_conversation", invalid: `
    NEW.created_by_member_id IS NOT NULL AND NEW.family_id
      <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.created_by_member_id)` },
  { table: "ronto_conversation_member", invalid: `
    (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id)
      <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.family_member_id)` },
  { table: "ronto_message", invalid: `
    NEW.reply_to_message_id IS NOT NULL AND NEW.conversation_id
      <> (SELECT conversation_id FROM ronto_message WHERE id = NEW.reply_to_message_id)` },
  { table: "ronto_family_invite", invalid: `
    NEW.family_id <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.created_by_member_id)` },
  { table: "ronto_file", invalid: `
    (NEW.created_by_member_id IS NOT NULL AND
      (SELECT family_id FROM ronto_channel WHERE id = NEW.channel_id)
        <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.created_by_member_id))
    OR (NEW.originating_conversation_id IS NOT NULL AND NEW.channel_id
      <> (SELECT channel_id FROM ronto_conversation WHERE id = NEW.originating_conversation_id))
    OR (NEW.originating_message_id IS NOT NULL AND NEW.channel_id <>
      (SELECT c.channel_id FROM ronto_message m JOIN ronto_conversation c ON c.id = m.conversation_id WHERE m.id = NEW.originating_message_id))
    OR (NEW.originating_run_id IS NOT NULL AND NEW.channel_id <>
      (SELECT c.channel_id FROM ronto_agent_run r JOIN ronto_conversation c ON c.id = r.conversation_id WHERE r.id = NEW.originating_run_id))` },
  { table: "ronto_tool_call", invalid: `
    (NEW.family_member_id IS NOT NULL AND
      (SELECT c.family_id FROM ronto_agent_run r JOIN ronto_conversation c ON c.id = r.conversation_id WHERE r.id = NEW.run_id)
        <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.family_member_id))
    OR (NEW.connector_connection_id IS NOT NULL AND (NEW.family_member_id IS NULL OR NEW.family_member_id
      <> (SELECT family_member_id FROM ronto_connector_connection WHERE id = NEW.connector_connection_id)))` },
  { table: "ronto_tool_approval", invalid: `
    (NEW.decided_by_member_id IS NOT NULL AND
      (SELECT c.family_id FROM ronto_tool_call t JOIN ronto_agent_run r ON r.id = t.run_id JOIN ronto_conversation c ON c.id = r.conversation_id WHERE t.id = NEW.tool_call_id)
        <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.decided_by_member_id))
    OR (NEW.decided_by_member_id IS NOT NULL AND
      (SELECT family_member_id FROM ronto_tool_call WHERE id = NEW.tool_call_id) IS NOT NULL AND NEW.decided_by_member_id
        <> (SELECT family_member_id FROM ronto_tool_call WHERE id = NEW.tool_call_id))
    OR (NEW.result_message_id IS NOT NULL AND
      (SELECT r.conversation_id FROM ronto_tool_call t JOIN ronto_agent_run r ON r.id = t.run_id WHERE t.id = NEW.tool_call_id)
        <> (SELECT conversation_id FROM ronto_message WHERE id = NEW.result_message_id))` },
  { table: "ronto_whatsapp_claim", invalid: `
    (NEW.kind = 'identity' AND NEW.family_member_id IS NOT NEW.created_by_member_id)
    OR (NEW.kind = 'conversation' AND
      (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id)
        <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.created_by_member_id))` },
  { table: "ronto_whatsapp_inbox", invalid: `
    (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id)
      <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.sender_member_id)
    OR (NEW.linked_sender_member_id IS NOT NULL AND
      (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id)
        <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.linked_sender_member_id))
    OR (NEW.canonical_message_id IS NOT NULL AND NEW.conversation_id
      <> (SELECT conversation_id FROM ronto_message WHERE id = NEW.canonical_message_id))
    OR (NEW.run_id IS NOT NULL AND NEW.conversation_id
      <> (SELECT conversation_id FROM ronto_agent_run WHERE id = NEW.run_id))
    OR (NEW.inbound_file_id IS NOT NULL AND
      (SELECT channel_id FROM ronto_conversation WHERE id = NEW.conversation_id)
        <> (SELECT channel_id FROM ronto_file WHERE id = NEW.inbound_file_id))` },
  { table: "ronto_whatsapp_outbox", invalid: `
    (SELECT conversation_id FROM ronto_whatsapp_inbox WHERE id = NEW.inbox_id)
      <> (SELECT conversation_id FROM ronto_message WHERE id = NEW.assistant_message_id)
    OR NEW.external_channel_id <> (SELECT external_channel_id FROM ronto_whatsapp_inbox WHERE id = NEW.inbox_id)
    OR (NEW.file_id IS NOT NULL AND
      (SELECT c.channel_id FROM ronto_whatsapp_inbox i JOIN ronto_conversation c ON c.id = i.conversation_id WHERE i.id = NEW.inbox_id)
        <> (SELECT channel_id FROM ronto_file WHERE id = NEW.file_id))
    OR (NEW.approval_id IS NOT NULL AND
      (SELECT conversation_id FROM ronto_whatsapp_inbox WHERE id = NEW.inbox_id)
        <> (SELECT r.conversation_id FROM ronto_tool_call t JOIN ronto_agent_run r ON r.id = t.run_id WHERE t.id = NEW.approval_id))` },
  { table: "ronto_whatsapp_media_receipt", invalid: `
    (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id)
      <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.authority_member_id)
    OR (NEW.linked_sender_member_id IS NOT NULL AND
      (SELECT family_id FROM ronto_conversation WHERE id = NEW.conversation_id)
        <> (SELECT family_id FROM ronto_family_member WHERE id = NEW.linked_sender_member_id))
    OR (NEW.file_id IS NOT NULL AND
      (SELECT channel_id FROM ronto_conversation WHERE id = NEW.conversation_id)
        <> (SELECT channel_id FROM ronto_file WHERE id = NEW.file_id))
    OR (NEW.inbox_id IS NOT NULL AND NEW.conversation_id
      <> (SELECT conversation_id FROM ronto_whatsapp_inbox WHERE id = NEW.inbox_id))` },
];

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  for (const { table, invalid } of relationships) {
    // Check historical rows first, inside the migrator's transaction. Do not
    // silently repair ambiguous ownership or install partial constraints.
    const existing = yield* sql.unsafe(`SELECT 1 FROM ${table} AS candidate WHERE ${invalid.replaceAll("NEW.", "candidate.")} LIMIT 1`);
    if (existing.length !== 0) return yield* Effect.die(`Family consistency check failed for ${table}`);
    for (const event of ["INSERT", "UPDATE"]) {
      yield* sql.unsafe(`CREATE TRIGGER ${table}_family_consistency_${event.toLowerCase()}
        BEFORE ${event} ON ${table} WHEN ${invalid}
        BEGIN SELECT RAISE(ABORT, 'Cross-family or cross-conversation relationship denied'); END`);
    }
  }
  for (const [table, column] of ownership) {
    yield* sql.unsafe(`CREATE TRIGGER ${table}_${column}_immutable
      BEFORE UPDATE OF ${column} ON ${table} WHEN NEW.${column} IS NOT OLD.${column}
      BEGIN SELECT RAISE(ABORT, 'Ownership is immutable'); END`);
  }
});
