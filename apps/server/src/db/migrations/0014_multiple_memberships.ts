import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  // The startup migration connection disables FK actions before its transaction.
  // Otherwise dropping these parents would cascade into family content.
  yield* sql`
    CREATE TABLE ronto_family_new (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`INSERT INTO ronto_family_new SELECT id, name, created_at, updated_at FROM ronto_family`;
  yield* sql`DROP TABLE ronto_family`;
  yield* sql`ALTER TABLE ronto_family_new RENAME TO ronto_family`;
  yield* sql`
    CREATE TABLE ronto_family_member_new (
      id TEXT PRIMARY KEY,
      family_id TEXT NOT NULL REFERENCES ronto_family(id) ON DELETE RESTRICT,
      user_id TEXT NOT NULL REFERENCES user(id) ON DELETE RESTRICT,
      role TEXT NOT NULL CHECK (role IN ('primary', 'member')),
      joined_at TEXT NOT NULL,
      UNIQUE (family_id, user_id)
    )
  `;
  yield* sql`INSERT INTO ronto_family_member_new SELECT id, family_id, user_id, role, joined_at FROM ronto_family_member`;
  yield* sql`DROP TABLE ronto_family_member`;
  yield* sql`ALTER TABLE ronto_family_member_new RENAME TO ronto_family_member`;
  yield* sql`CREATE INDEX ronto_family_member_family_idx ON ronto_family_member (family_id)`;
  yield* sql`CREATE INDEX ronto_family_member_user_idx ON ronto_family_member (user_id)`;
  // This check is inside the migrator's transaction, so a violation rolls back
  // the entire rebuild together with its migration ledger entry.
  const violations = yield* sql`PRAGMA foreign_key_check`;
  if (violations.length !== 0) return yield* Effect.die("Family migration foreign-key check failed");
});
