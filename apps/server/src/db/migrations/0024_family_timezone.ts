import { Effect } from "effect";
import { SqlClient } from "effect/unstable/sql";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`ALTER TABLE ronto_family ADD COLUMN timezone TEXT
    CHECK (timezone IS NULL OR length(timezone) BETWEEN 1 AND 64)`;
});
