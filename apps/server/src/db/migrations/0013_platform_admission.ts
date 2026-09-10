import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    CREATE TABLE ronto_platform_administrator (
      singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
      user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE RESTRICT,
      bootstrapped_from_email TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `;

  yield* sql`
    CREATE TABLE ronto_platform_invite (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      created_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      revoked_at TEXT,
      claimed_by_user_id TEXT UNIQUE REFERENCES user(id) ON DELETE RESTRICT,
      claimed_at TEXT,
      CHECK (
        (claimed_by_user_id IS NULL AND claimed_at IS NULL) OR
        (claimed_by_user_id IS NOT NULL AND claimed_at IS NOT NULL)
      )
    )
  `;

  yield* sql`
    CREATE INDEX ronto_platform_invite_created_idx
    ON ronto_platform_invite (created_at DESC)
  `;

  yield* sql`
    CREATE TABLE ronto_family_creation_grant (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE REFERENCES user(id) ON DELETE RESTRICT,
      platform_invite_id TEXT UNIQUE REFERENCES ronto_platform_invite(id) ON DELETE RESTRICT,
      granted_by_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
      status TEXT NOT NULL CHECK (status IN ('granted', 'consumed', 'revoked')),
      granted_at TEXT NOT NULL,
      consumed_at TEXT,
      revoked_at TEXT,
      created_family_id TEXT UNIQUE REFERENCES ronto_family(id) ON DELETE RESTRICT,
      CHECK (
        (status = 'granted' AND consumed_at IS NULL AND revoked_at IS NULL AND created_family_id IS NULL) OR
        (status = 'consumed' AND consumed_at IS NOT NULL AND revoked_at IS NULL AND created_family_id IS NOT NULL) OR
        (status = 'revoked' AND consumed_at IS NULL AND revoked_at IS NOT NULL AND created_family_id IS NULL)
      )
    )
  `;
});
