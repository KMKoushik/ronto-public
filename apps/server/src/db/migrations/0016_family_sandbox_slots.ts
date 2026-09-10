import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { randomUUID } from "node:crypto";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE ronto_family_sandbox_slot (
      id TEXT PRIMARY KEY,
      project_id INTEGER NOT NULL UNIQUE CHECK (project_id > 0),
      assigned_family_id TEXT UNIQUE REFERENCES ronto_family(id) ON DELETE RESTRICT,
      provisioned_at TEXT,
      directory_device INTEGER,
      directory_inode INTEGER,
      CHECK (assigned_family_id IS NULL OR assigned_family_id = id),
      CHECK ((directory_device IS NULL AND directory_inode IS NULL)
        OR (directory_device IS NOT NULL AND directory_inode IS NOT NULL)),
      CHECK (provisioned_at IS NULL OR directory_device IS NOT NULL)
    )
  `;
  const families = yield* SqlSchema.findAll({
    Request: Schema.Void,
    Result: Schema.Struct({ id: Schema.String }),
    execute: () => sql`SELECT id FROM ronto_family ORDER BY created_at, id`,
  })(undefined);
  if (families.length > 5) return yield* Effect.die("More than five existing families; review sandbox capacity before migrating");
  // Slots are unready until the offline privileged provisioner has verified
  // their filesystem quotas. Existing family IDs and data paths are preserved.
  for (let index = 0; index < 5; index++) {
    const family = families[index];
    yield* sql`INSERT INTO ronto_family_sandbox_slot (id, project_id, assigned_family_id)
      VALUES (${family?.id ?? randomUUID()}, ${10001 + index}, ${family?.id ?? null})`;
  }
});
