import type { FamilyMemberId } from "@ronto/api";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";

const ConnectorStatus = Schema.Literals([
  "pending",
  "active",
  "disconnecting",
  "failed",
]);

export const ConnectorMemberToken = Schema.Struct({
  familyMemberId: Schema.String,
  externalTokenId: Schema.String,
  encryptedToken: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type ConnectorMemberToken = typeof ConnectorMemberToken.Type;

export const ConnectorConnection = Schema.Struct({
  id: Schema.String,
  familyMemberId: Schema.String,
  service: Schema.String,
  connectionAlias: Schema.String,
  externalConnectionId: Schema.NullOr(Schema.String),
  oauthStateHash: Schema.NullOr(Schema.String),
  oauthExpiresAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  requestedScopesJson: Schema.fromJsonString(Schema.Array(Schema.String)),
  grantedScopesJson: Schema.fromJsonString(Schema.Array(Schema.String)),
  status: ConnectorStatus,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type ConnectorConnection = typeof ConnectorConnection.Type;

export interface SaveConnectorConnection {
  readonly id: string;
  readonly familyMemberId: FamilyMemberId;
  readonly service: string;
  readonly connectionAlias: string;
  readonly externalConnectionId: string | null;
  readonly oauthStateHash: string | null;
  readonly oauthExpiresAt: DateTime.Utc | null;
  readonly requestedScopes: ReadonlyArray<string>;
  readonly grantedScopes: ReadonlyArray<string>;
  readonly status: typeof ConnectorStatus.Type;
}

type ConnectorStoreError = SqlError | Schema.SchemaError;

export class ConnectorStore extends Context.Service<
  ConnectorStore,
  {
    saveMemberToken(
      familyMemberId: FamilyMemberId,
      externalTokenId: string,
      encryptedToken: string,
    ): Effect.Effect<void, ConnectorStoreError>;
    findMemberToken(
      familyMemberId: FamilyMemberId,
    ): Effect.Effect<ConnectorMemberToken | null, ConnectorStoreError>;
    deleteMemberToken(
      familyMemberId: FamilyMemberId,
    ): Effect.Effect<boolean, ConnectorStoreError>;
    saveConnection(
      connection: SaveConnectorConnection,
    ): Effect.Effect<void, ConnectorStoreError>;
    listConnections(
      familyMemberId: FamilyMemberId,
    ): Effect.Effect<ReadonlyArray<ConnectorConnection>, ConnectorStoreError>;
    findConnection(
      familyMemberId: FamilyMemberId,
      connectionId: string,
    ): Effect.Effect<ConnectorConnection | null, ConnectorStoreError>;
    deleteConnection(
      familyMemberId: FamilyMemberId,
      connectionId: string,
    ): Effect.Effect<boolean, ConnectorStoreError>;
  }
>()("ronto/connectors/ConnectorStore") {
  static readonly layer = Layer.effect(
    ConnectorStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const findToken = SqlSchema.findOneOption({
        Request: Schema.String,
        Result: ConnectorMemberToken,
        execute: (familyMemberId) => sql`
          SELECT family_member_id, external_token_id, encrypted_token,
                 created_at, updated_at
          FROM ronto_connector_member_token
          WHERE family_member_id = ${familyMemberId}
        `,
      });
      const listMemberConnections = SqlSchema.findAll({
        Request: Schema.String,
        Result: ConnectorConnection,
        execute: (familyMemberId) => sql`
          SELECT id, family_member_id, service, connection_alias,
                 external_connection_id, oauth_state_hash, oauth_expires_at, requested_scopes_json,
                 granted_scopes_json, status, created_at, updated_at
          FROM ronto_connector_connection
          WHERE family_member_id = ${familyMemberId}
          ORDER BY created_at, id
        `,
      });
      const findMemberConnection = SqlSchema.findOneOption({
        Request: Schema.Struct({
          familyMemberId: Schema.String,
          connectionId: Schema.String,
        }),
        Result: ConnectorConnection,
        execute: ({ familyMemberId, connectionId }) => sql`
          SELECT id, family_member_id, service, connection_alias,
                 external_connection_id, oauth_state_hash, oauth_expires_at, requested_scopes_json,
                 granted_scopes_json, status, created_at, updated_at
          FROM ronto_connector_connection
          WHERE family_member_id = ${familyMemberId} AND id = ${connectionId}
        `,
      });

      const saveMemberToken = Effect.fn("ConnectorStore.saveMemberToken")(
        function* (
          familyMemberId: FamilyMemberId,
          externalTokenId: string,
          encryptedToken: string,
        ) {
          const now = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            INSERT INTO ronto_connector_member_token (
              family_member_id, external_token_id, encrypted_token,
              created_at, updated_at
            ) VALUES (
              ${familyMemberId}, ${externalTokenId}, ${encryptedToken},
              ${now}, ${now}
            )
            ON CONFLICT(family_member_id) DO UPDATE SET
              external_token_id = excluded.external_token_id,
              encrypted_token = excluded.encrypted_token,
              updated_at = excluded.updated_at
          `;
        },
      );

      const saveConnection = Effect.fn("ConnectorStore.saveConnection")(
        function* (connection: SaveConnectorConnection) {
          const now = DateTime.formatIso(yield* DateTime.now);
          yield* sql`
            INSERT INTO ronto_connector_connection (
              id, family_member_id, service, connection_alias,
               external_connection_id, oauth_state_hash, oauth_expires_at, requested_scopes_json,
              granted_scopes_json, status, created_at, updated_at
            ) VALUES (
              ${connection.id}, ${connection.familyMemberId},
              ${connection.service}, ${connection.connectionAlias},
               ${connection.externalConnectionId},
               ${connection.oauthStateHash},
               ${connection.oauthExpiresAt === null ? null : DateTime.formatIso(connection.oauthExpiresAt)},
              ${JSON.stringify(connection.requestedScopes)},
              ${JSON.stringify(connection.grantedScopes)},
              ${connection.status}, ${now}, ${now}
            )
            ON CONFLICT(id) DO UPDATE SET
              external_connection_id = excluded.external_connection_id,
               oauth_state_hash = excluded.oauth_state_hash,
               oauth_expires_at = excluded.oauth_expires_at,
              requested_scopes_json = excluded.requested_scopes_json,
              granted_scopes_json = excluded.granted_scopes_json,
              status = excluded.status,
              updated_at = excluded.updated_at
            WHERE ronto_connector_connection.family_member_id = excluded.family_member_id
          `;
        },
      );

      return ConnectorStore.of({
        saveMemberToken,
        findMemberToken: (familyMemberId) =>
          findToken(familyMemberId).pipe(Effect.map(Option.getOrNull)),
        deleteMemberToken: (familyMemberId) =>
          sql`
            DELETE FROM ronto_connector_member_token
            WHERE family_member_id = ${familyMemberId}
            RETURNING family_member_id
          `.pipe(Effect.map((rows) => rows.length > 0)),
        saveConnection,
        listConnections: listMemberConnections,
        findConnection: (familyMemberId, connectionId) =>
          findMemberConnection({ familyMemberId, connectionId }).pipe(
            Effect.map(Option.getOrNull),
          ),
        deleteConnection: (familyMemberId, connectionId) =>
          sql`
            DELETE FROM ronto_connector_connection
            WHERE family_member_id = ${familyMemberId} AND id = ${connectionId}
            RETURNING id
          `.pipe(Effect.map((rows) => rows.length > 0)),
      });
    }),
  );
}
