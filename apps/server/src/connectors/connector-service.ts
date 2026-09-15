import type { FamilyMemberId } from "@ronto/api";
import { Context, Effect, Layer, Schema } from "effect";
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { IsSchema } from "typebox";
import { Value } from "typebox/value";

import {
  ConnectorStore,
  type ConnectorConnection,
} from "./connector-store.ts";
import {
  OpenConnectorClient,
  type OpenConnectorAction,
  type OpenConnectorRequest,
} from "./open-connector-client.ts";

export interface MemberConnector {
  readonly id: string;
  readonly service: string;
  readonly requestedScopes: ReadonlyArray<string>;
  readonly grantedScopes: ReadonlyArray<string>;
}

export interface MemberConnectorAction {
  readonly connectionId: string;
  readonly id: string;
  readonly service: string;
  readonly name: string;
  readonly description: string;
  readonly requiredScopes: ReadonlyArray<string>;
  readonly inputSchema: Schema.JsonObject;
  readonly outputSchema: Schema.JsonObject;
}

export class ConnectorServiceError extends Schema.TaggedError<ConnectorServiceError>()(
  "ConnectorServiceError",
  {
    reason: Schema.Literals([
      "disabled",
      "not_configured",
      "not_found",
      "not_allowed",
      "invalid_token",
      "gateway_failed",
      "invalid_input",
    ]),
    message: Schema.String,
    cause: Schema.Defect(),
  },
) {}

const encryptionKey = (encoded: string): Buffer => {
  const key = Buffer.from(encoded, "base64");
  if (key.byteLength !== 32) {
    throw new Error("CONNECTOR_TOKEN_ENCRYPTION_KEY must contain 32 base64 bytes");
  }
  return key;
};

export const encryptConnectorToken = (
  encodedKey: string,
  token: string,
): string => {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(encodedKey), iv);
  const ciphertext = Buffer.concat([
    cipher.update(token, "utf8"),
    cipher.final(),
  ]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
};

const decryptConnectorToken = (
  encodedKey: string,
  encrypted: string,
): Effect.Effect<string, ConnectorServiceError> =>
  Effect.try({
    try: () => {
      const [version, payload] = encrypted.split(":");
      if (version !== "v1" || payload === undefined) {
        throw new Error("Unsupported encrypted connector token");
      }
      const bytes = Buffer.from(payload, "base64url");
      if (bytes.byteLength < 29) throw new Error("Invalid encrypted connector token");
      const decipher = createDecipheriv(
        "aes-256-gcm",
        encryptionKey(encodedKey),
        bytes.subarray(0, 12),
      );
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString("utf8");
    },
    catch: (cause) =>
      new ConnectorServiceError({
        reason: "invalid_token",
        message: "The connector credential could not be read",
        cause,
      }),
  });

const memberConnector = (connection: ConnectorConnection): MemberConnector => ({
  id: connection.id,
  service: connection.service,
  requestedScopes: connection.requestedScopesJson,
  grantedScopes: connection.grantedScopesJson,
});

const memberAction = (
  connection: ConnectorConnection,
  action: OpenConnectorAction,
): MemberConnectorAction => ({
  connectionId: connection.id,
  id: action.id,
  service: action.service,
  name: action.name,
  description: action.description,
  requiredScopes: action.requiredScopes,
  inputSchema: action.inputSchema,
  outputSchema: action.outputSchema,
});

const gmailModifyScope = "https://www.googleapis.com/auth/gmail.modify";
const gmailScopesIncludedByModify = new Set([
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
]);

const satisfiesRequiredScope = (granted: string, required: string): boolean =>
  granted === required ||
  (granted === gmailModifyScope && gmailScopesIncludedByModify.has(required));

const hasRequiredScopes = (
  connection: ConnectorConnection,
  action: OpenConnectorAction,
): boolean =>
  action.requiredScopes.every((scope) =>
    connection.grantedScopesJson.some((granted) =>
      satisfiesRequiredScope(granted, scope),
    ),
  );

export class ConnectorService extends Context.Service<
  ConnectorService,
  {
    readonly enabled: boolean;
    listConnections(
      memberId: FamilyMemberId,
    ): Effect.Effect<ReadonlyArray<MemberConnector>, ConnectorServiceError>;
    listActions(
      memberId: FamilyMemberId,
    ): Effect.Effect<ReadonlyArray<MemberConnectorAction>, ConnectorServiceError>;
    searchActions(
      memberId: FamilyMemberId,
      query: string,
      limit: number,
    ): Effect.Effect<ReadonlyArray<MemberConnectorAction>, ConnectorServiceError>;
    getAction(
      memberId: FamilyMemberId,
      connectionId: string,
      actionId: string,
    ): Effect.Effect<MemberConnectorAction, ConnectorServiceError>;
    validateInput(
      memberId: FamilyMemberId,
      connectionId: string,
      actionId: string,
      input: Schema.JsonObject,
    ): Effect.Effect<void, ConnectorServiceError>;
    execute(
      memberId: FamilyMemberId,
      connectionId: string,
      actionId: string,
      input: Schema.JsonObject,
      idempotencyKey: string,
    ): Effect.Effect<Schema.Json, ConnectorServiceError>;
    readTransitFile(
      fileId: string,
      maxBytes: number,
    ): Effect.Effect<Uint8Array, ConnectorServiceError>;
    deleteTransitFile(fileId: string): Effect.Effect<void, ConnectorServiceError>;
  }
>()("ronto/connectors/ConnectorService") {
  static readonly disabled = Layer.succeed(
    ConnectorService,
    ConnectorService.of({
      enabled: false,
      listConnections: () => Effect.succeed([]),
      listActions: () => Effect.succeed([]),
      searchActions: () => Effect.succeed([]),
      getAction: () =>
        Effect.fail(
          new ConnectorServiceError({
            reason: "disabled",
            message: "Connectors are not enabled",
            cause: null,
          }),
        ),
      validateInput: () =>
        Effect.fail(
          new ConnectorServiceError({
            reason: "disabled",
            message: "Connectors are not enabled",
            cause: null,
          }),
        ),
      execute: () =>
        Effect.fail(
          new ConnectorServiceError({
            reason: "disabled",
            message: "Connectors are not enabled",
            cause: null,
          }),
        ),
      readTransitFile: () =>
        Effect.fail(
          new ConnectorServiceError({
            reason: "disabled",
            message: "Connectors are not enabled",
            cause: null,
          }),
        ),
      deleteTransitFile: () =>
        Effect.fail(
          new ConnectorServiceError({
            reason: "disabled",
            message: "Connectors are not enabled",
            cause: null,
          }),
        ),
    }),
  );

  static layer(
    baseUrl: string,
    adminToken: string,
    encodedEncryptionKey: string,
    allowedServices: ReadonlySet<string>,
    request: OpenConnectorRequest = fetch,
  ): Layer.Layer<ConnectorService, never, ConnectorStore> {
    const clientLayer = OpenConnectorClient.layer(baseUrl, request);
    return Layer.effect(
      ConnectorService,
      Effect.gen(function* () {
        const store = yield* ConnectorStore;
        const client = yield* OpenConnectorClient;

        const access = Effect.fn("ConnectorService.access")(function* (
          memberId: FamilyMemberId,
        ) {
          const stored = yield* store.findMemberToken(memberId).pipe(
            Effect.mapError(
              (cause) =>
                new ConnectorServiceError({
                  reason: "gateway_failed",
                  message: "Connector access could not be loaded",
                  cause,
                }),
            ),
          );
          if (stored === null) {
            return yield* new ConnectorServiceError({
              reason: "not_configured",
              message: "This family member has no connector access",
              cause: null,
            });
          }
          const token = yield* decryptConnectorToken(
            encodedEncryptionKey,
            stored.encryptedToken,
          );
          return token;
        });

        const connections = Effect.fn("ConnectorService.connections")(
          function* (memberId: FamilyMemberId) {
            return yield* store.listConnections(memberId).pipe(
              Effect.map((items) =>
                items.filter(
                  (connection) => connection.status === "active" &&
                    allowedServices.has(connection.service),
                ),
              ),
              Effect.mapError(
                (cause) =>
                  new ConnectorServiceError({
                    reason: "gateway_failed",
                    message: "Connections could not be loaded",
                    cause,
                  }),
              ),
            );
          },
        );

        const ownedConnection = Effect.fn("ConnectorService.ownedConnection")(
          function* (memberId: FamilyMemberId, connectionId: string) {
            const connection = yield* store
              .findConnection(memberId, connectionId)
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ConnectorServiceError({
                      reason: "gateway_failed",
                      message: "The connection could not be loaded",
                      cause,
                    }),
                ),
              );
            if (connection === null || connection.status !== "active") {
              return yield* new ConnectorServiceError({
                reason: "not_found",
                message: "Connection not found",
                cause: null,
              });
            }
            return connection;
          },
        );

        const checkedAction = Effect.fn("ConnectorService.checkedAction")(
          function* (
            memberId: FamilyMemberId,
            connectionId: string,
            actionId: string,
          ) {
            const connection = yield* ownedConnection(memberId, connectionId);
            if (
              !allowedServices.has(connection.service) ||
              !actionId.startsWith(`${connection.service}.`)
            ) {
              return yield* new ConnectorServiceError({
                reason: "not_allowed",
                message: "This connector action is not allowed",
                cause: null,
              });
            }
            const token = yield* access(memberId);
            const action = yield* client.getAction(token, actionId).pipe(
              Effect.mapError(
                (cause) =>
                  new ConnectorServiceError({
                    reason: "gateway_failed",
                    message: "The connector action could not be loaded",
                    cause,
                  }),
              ),
            );
            if (
              action.id !== actionId ||
              action.service !== connection.service ||
              !hasRequiredScopes(connection, action)
            ) {
              return yield* new ConnectorServiceError({
                reason: "not_allowed",
                message: "The connection cannot use this action",
                cause: null,
              });
            }
            return { connection, token, action };
          },
        );

        return ConnectorService.of({
          enabled: true,
          listActions: Effect.fn("ConnectorService.listActions")(function* (memberId) {
            const memberConnections = yield* connections(memberId);
            if (memberConnections.length === 0) return [];
            const token = yield* access(memberId);
            const services = [...new Set(memberConnections.map((item) => item.service))];
            const catalogs = yield* Effect.forEach(
              services,
              (service) => client.listActions(token, service).pipe(
                Effect.map((actions) =>
                  actions.flatMap((action) =>
                    memberConnections.filter((connection) =>
                      connection.service === service &&
                      action.service === service &&
                      action.id.startsWith(`${service}.`) &&
                      hasRequiredScopes(connection, action),
                    ).map((connection) => memberAction(connection, action)),
                  ),
                ),
                Effect.mapError((cause) =>
                  new ConnectorServiceError({
                    reason: "gateway_failed",
                    message: "The connected service's action catalog could not be loaded",
                    cause,
                  }),
                ),
              ),
              { concurrency: 4 },
            );
            return catalogs.flat();
          }),
          listConnections: (memberId) =>
            connections(memberId).pipe(
              Effect.map((items) => items.map(memberConnector)),
            ),
          searchActions: Effect.fn("ConnectorService.searchActions")(
            function* (memberId, query, limit) {
              const memberConnections = yield* connections(memberId);
              if (memberConnections.length === 0) return [];
              const token = yield* access(memberId);
              const services = [...new Set(memberConnections.map((item) => item.service))];
              const catalogs = yield* Effect.forEach(
                services,
                (service) => client
                  .searchActions(token, query, service, Math.min(limit * 4, 40))
                  .pipe(
                    Effect.mapError((cause) =>
                      new ConnectorServiceError({
                        reason: "gateway_failed",
                        message: "Connector actions could not be searched",
                        cause,
                      }),
                    ),
                  ),
                { concurrency: 4 },
              );
              const candidates = catalogs.flat().flatMap((summary) =>
                memberConnections
                  .filter(
                    (connection) =>
                      connection.service === summary.service &&
                      allowedServices.has(summary.service) &&
                      summary.id.startsWith(`${summary.service}.`),
                  )
                  .map((connection) => ({ connection, summary })),
              );
              const detailed = yield* Effect.forEach(
                candidates.slice(0, limit * 4),
                ({ connection, summary }) =>
                  client.getAction(token, summary.id).pipe(
                    Effect.map((action) => ({ connection, action })),
                    Effect.mapError(
                      (cause) =>
                        new ConnectorServiceError({
                          reason: "gateway_failed",
                          message: "A connector action could not be loaded",
                          cause,
                        }),
                    ),
                  ),
                { concurrency: 4 },
              );
              return detailed
                .filter(({ connection, action }) =>
                  hasRequiredScopes(connection, action),
                )
                .map(({ connection, action }) =>
                  memberAction(connection, action),
                )
                .slice(0, limit);
            },
          ),
          getAction: Effect.fn("ConnectorService.getAction")(function* (
            memberId,
            connectionId,
            actionId,
          ) {
            const checked = yield* checkedAction(
              memberId,
              connectionId,
              actionId,
            );
            return memberAction(checked.connection, checked.action);
          }),
          validateInput: Effect.fn("ConnectorService.validateInput")(
            function* (memberId, connectionId, actionId, input) {
              const checked = yield* checkedAction(
                memberId,
                connectionId,
                actionId,
              );
              if (
                !IsSchema(checked.action.inputSchema) ||
                !Value.Check(checked.action.inputSchema, input)
              ) {
                const issues = IsSchema(checked.action.inputSchema)
                  ? [...Value.Errors(checked.action.inputSchema, input)]
                      .slice(0, 5)
                      .map(({ message, instancePath }) =>
                        `${instancePath || "/"}: ${message}`
                      )
                  : ["The connector returned an invalid input schema"];
                return yield* new ConnectorServiceError({
                  reason: "invalid_input",
                  message: `The connector action input is invalid: ${issues.join("; ")}`,
                  cause: null,
                });
              }
            },
          ),
          execute: Effect.fn("ConnectorService.execute")(function* (
            memberId,
            connectionId,
            actionId,
            input,
            idempotencyKey,
          ) {
            const checked = yield* checkedAction(
              memberId,
              connectionId,
              actionId,
            );
            return yield* client
              .execute(
                checked.token,
                actionId,
                input,
                checked.connection.connectionAlias,
                idempotencyKey,
              )
              .pipe(
                Effect.mapError(
                  (cause) =>
                    new ConnectorServiceError({
                      reason: "gateway_failed",
                      message: "The connector action failed",
                      cause,
                    }),
                ),
              );
          }),
          readTransitFile: (fileId, maxBytes) =>
            client.readTransitFile(adminToken, fileId, maxBytes).pipe(
              Effect.mapError((cause) => new ConnectorServiceError({
                reason: "gateway_failed",
                message: "The connector transit file could not be read",
                cause,
              })),
            ),
          deleteTransitFile: (fileId) =>
            client.deleteTransitFile(adminToken, fileId).pipe(
              Effect.mapError((cause) => new ConnectorServiceError({
                reason: "gateway_failed",
                message: "The connector transit file could not be deleted",
                cause,
              })),
            ),
        });
      }).pipe(Effect.provide(clientLayer)),
    );
  }
}
