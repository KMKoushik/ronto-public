import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ronto_connector_member_token (
      family_member_id TEXT PRIMARY KEY
        REFERENCES ronto_family_member(id) ON DELETE CASCADE,
      external_token_id TEXT NOT NULL UNIQUE,
      encrypted_token TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE ronto_connector_connection (
      id TEXT PRIMARY KEY,
      family_member_id TEXT NOT NULL
        REFERENCES ronto_family_member(id) ON DELETE CASCADE,
      service TEXT NOT NULL,
      connection_alias TEXT NOT NULL UNIQUE,
      external_connection_id TEXT UNIQUE,
      oauth_state_hash TEXT,
      oauth_expires_at TEXT,
      requested_scopes_json TEXT NOT NULL
        CHECK (json_valid(requested_scopes_json)),
      granted_scopes_json TEXT NOT NULL
        CHECK (json_valid(granted_scopes_json)),
      status TEXT NOT NULL
        CHECK (status IN ('pending', 'active', 'disconnecting', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (family_member_id, service, connection_alias)
    )
  `;

  yield* sql`
    CREATE INDEX ronto_connector_connection_member_status_idx
    ON ronto_connector_connection(family_member_id, status)
  `;
});
