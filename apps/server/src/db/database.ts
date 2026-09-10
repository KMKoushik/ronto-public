import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { NodeFileSystem, NodePath } from "@effect/platform-node";
import { Effect, Layer, String } from "effect";
import { SqlClient } from "effect/unstable/sql";
import { fileURLToPath } from "node:url";

export const databasePath =
  process.env.DATABASE_PATH ??
  fileURLToPath(new URL("../../../../data/ronto.sqlite", import.meta.url));

const MigrationLayer = SqliteMigrator.layer({
  loader: SqliteMigrator.fromFileSystem(
    fileURLToPath(new URL("./migrations", import.meta.url)),
  ),
}).pipe(
  Layer.provide(NodeFileSystem.layer),
  Layer.provide(NodePath.layer),
);

export const databaseLayer = (filename: string) => {
  const sqlLayer = SqliteClient.layer({
    filename,
    transformQueryNames: String.camelToSnake,
    transformResultNames: String.snakeToCamel,
  });
  const configuredSqlLayer = Layer.effectDiscard(
    Effect.gen(function*() {
      const sql = yield* SqlClient.SqlClient;
      yield* sql`PRAGMA foreign_keys = OFF`;
    }),
  ).pipe(Layer.provideMerge(sqlLayer));

  const migrated = MigrationLayer.pipe(Layer.provideMerge(configuredSqlLayer));
  return Layer.effectDiscard(Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`PRAGMA foreign_keys = ON`;
    const violations = yield* sql`PRAGMA foreign_key_check`;
    if (violations.length !== 0) return yield* Effect.die("Database foreign-key check failed");
  })).pipe(Layer.provideMerge(migrated));
};

export const DatabaseLive = databaseLayer(databasePath);
