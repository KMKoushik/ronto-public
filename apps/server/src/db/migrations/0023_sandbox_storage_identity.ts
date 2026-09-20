import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE ronto_family_sandbox_slot ADD COLUMN storage_kind TEXT`;
  yield* sql`ALTER TABLE ronto_family_sandbox_slot ADD COLUMN storage_identity TEXT`;
});
