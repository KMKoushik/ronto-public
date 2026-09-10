import type { FamilyMemberId } from "@ronto/api";
import { Context, DateTime, Effect, Layer, Schema } from "effect";
import { createHash, randomUUID } from "node:crypto";

import {
  ConnectorStore,
  type ConnectorConnection,
} from "./connector-store.ts";
import {
  ConnectorServiceError,
  encryptConnectorToken,
} from "./connector-service.ts";
import {
  OpenConnectorClient,
  type OpenConnectorRequest,
} from "./open-connector-client.ts";

const emptyGrantSentinel = "00000000-0000-4000-8000-000000000000";

export interface ConnectorAuthorization {
  readonly connection: ManagedConnector;
  readonly authorizationUrl: string;
}

export interface ManagedConnector {
  readonly id: string;
  readonly service: string;
  readonly requestedScopes: ReadonlyArray<string>;
  readonly grantedScopes: ReadonlyArray<string>;
  readonly status: "pending" | "active" | "disconnecting" | "failed";
}

export interface ManagedConnectorProvider {
  readonly service: string;
  readonly scopes: ReadonlyArray<string>;
}

const managedConnector = (connection: ConnectorConnection): ManagedConnector => ({
  id: connection.id,
  service: connection.service,
  requestedScopes: connection.requestedScopesJson,
  grantedScopes: connection.grantedScopesJson,
  status: connection.status,
});

const managementError = (
  message: string,
  cause: Schema.Defect["Type"],
): ConnectorServiceError =>
  new ConnectorServiceError({
    reason: "gateway_failed",
    message,
    cause,
  });

const normalizedCallbackUrl = (publicOrigin: string): string => {
  const url = new URL("/oauth/callback", publicOrigin);
  if (
    url.protocol !== "https:" &&
    !(url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost"))
  ) {
    throw new Error("The connector public origin must use HTTPS or loopback HTTP");
  }
  return url.toString();
};

const validAuthorizationUrl = (value: string): boolean => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      (url.protocol === "http:" &&
        (url.hostname === "127.0.0.1" || url.hostname === "localhost"));
  } catch {
    return false;
  }
};

const sameScopes = (
  requested: ReadonlyArray<string>,
  granted: ReadonlyArray<string>,
): boolean =>
  requested.length === granted.length &&
  requested.every((scope) => granted.includes(scope));

export class ConnectorManagement extends Context.Service<
  ConnectorManagement,
  {
    readonly enabled: boolean;
    list(
      memberId: FamilyMemberId,
    ): Effect.Effect<ReadonlyArray<ManagedConnector>, ConnectorServiceError>;
    listProviders(): Effect.Effect<
      ReadonlyArray<ManagedConnectorProvider>,
      ConnectorServiceError
    >;
    startOAuth(
      memberId: FamilyMemberId,
      service: string,
      requestedScopes: ReadonlyArray<string>,
    ): Effect.Effect<ConnectorAuthorization, ConnectorServiceError>;
    reconcile(
      memberId: FamilyMemberId,
      connectionId: string,
    ): Effect.Effect<ManagedConnector, ConnectorServiceError>;
    disconnect(
      memberId: FamilyMemberId,
      connectionId: string,
    ): Effect.Effect<void, ConnectorServiceError>;
  }
>()("ronto/connectors/ConnectorManagement") {
  static readonly disabled = Layer.succeed(
    ConnectorManagement,
    ConnectorManagement.of({
      enabled: false,
      list: () => Effect.succeed([]),
      listProviders: () => Effect.succeed([]),
      startOAuth: () =>
        Effect.fail(
          new ConnectorServiceError({
            reason: "disabled",
            message: "Connectors are not enabled",
            cause: null,
          }),
        ),
      reconcile: () =>
        Effect.fail(
          new ConnectorServiceError({
            reason: "disabled",
            message: "Connectors are not enabled",
            cause: null,
          }),
        ),
      disconnect: () =>
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
    publicOrigin: string,
    adminToken: string,
    encodedEncryptionKey: string,
    allowedServices: ReadonlySet<string>,
    request: OpenConnectorRequest = fetch,
  ): Layer.Layer<ConnectorManagement, never, ConnectorStore> {
    const clientLayer = OpenConnectorClient.layer(baseUrl, request);
    return Layer.effect(
      ConnectorManagement,
      Effect.gen(function* () {
        if (allowedServices.size === 0) {
          return yield* Effect.die(
            new Error("At least one OpenConnector service must be enabled"),
          );
        }
        const store = yield* ConnectorStore;
        const client = yield* OpenConnectorClient;
        const allowedActions = [...allowedServices].map((service) =>
          `${service}.*`
        );
        const callbackUrl = normalizedCallbackUrl(publicOrigin);

        const configuredProviders = Effect.fn(
          "ConnectorManagement.configuredProviders",
        )(function* () {
          const configs = yield* client.listOAuthConfigs(adminToken).pipe(
            Effect.mapError((cause) =>
              managementError("Connector providers could not be loaded", cause),
            ),
          );
          const mismatched = configs.find(
            (config) =>
              config.configured &&
              allowedServices.has(config.service) &&
              config.expectedRedirectUri !== callbackUrl,
          );
          if (mismatched !== undefined) {
            return yield* managementError(
              "The connector callback URL is not configured for Ronto",
              null,
            );
          }
          return configs;
        });

        const connectionGrants = Effect.fn(
          "ConnectorManagement.connectionGrants",
        )(function* (memberId: FamilyMemberId) {
          const connections = yield* store.listConnections(memberId).pipe(
            Effect.mapError((cause) =>
              managementError("Connections could not be loaded", cause),
            ),
          );
          const grants = connections.flatMap((connection) =>
            connection.status === "active" &&
            connection.externalConnectionId !== null
              ? [connection.externalConnectionId]
              : [],
          );
          return grants.length === 0 ? [emptyGrantSentinel] : grants;
        });

        const ensureMemberToken = Effect.fn(
          "ConnectorManagement.ensureMemberToken",
        )(function* (memberId: FamilyMemberId) {
          const existing = yield* store.findMemberToken(memberId).pipe(
            Effect.mapError((cause) =>
              managementError("Connector access could not be loaded", cause),
            ),
          );
          if (existing !== null) return existing;
          const grants = yield* connectionGrants(memberId);
          const created = yield* client
            .createRuntimeToken(
              adminToken,
              `ronto-member-${randomUUID()}`,
              allowedActions,
              grants,
            )
            .pipe(
              Effect.mapError((cause) =>
                managementError("Connector access could not be created", cause),
              ),
            );
          const encryptedToken = encryptConnectorToken(
            encodedEncryptionKey,
            created.token,
          );
          yield* store
            .saveMemberToken(
              memberId,
              created.record.id,
              encryptedToken,
            )
            .pipe(
              Effect.tapError(() =>
                client
                  .revokeRuntimeToken(adminToken, created.record.id)
                  .pipe(Effect.ignore),
              ),
              Effect.mapError((cause) =>
                managementError("Connector access could not be saved", cause),
              ),
            );
          const saved = yield* store.findMemberToken(memberId).pipe(
            Effect.mapError((cause) =>
              managementError("Connector access could not be loaded", cause),
            ),
          );
          if (saved === null) {
            return yield* managementError(
              "Connector access was not saved",
              null,
            );
          }
          return saved;
        });

        const reconcileMemberGrant = Effect.fn(
          "ConnectorManagement.reconcileMemberGrant",
        )(function* (memberId: FamilyMemberId) {
          const token = yield* store.findMemberToken(memberId).pipe(
            Effect.mapError((cause) =>
              managementError("Connector access could not be loaded", cause),
            ),
          );
          if (token === null) return;
          const grants = yield* connectionGrants(memberId);
          if (grants[0] === emptyGrantSentinel) {
            yield* client
              .revokeRuntimeToken(adminToken, token.externalTokenId)
              .pipe(
                Effect.flatMap(() => store.deleteMemberToken(memberId)),
                Effect.mapError((cause) =>
                  managementError("Connector access could not be revoked", cause),
                ),
              );
            return;
          }
          yield* client
            .updateRuntimeToken(
              adminToken,
              token.externalTokenId,
              allowedActions,
              grants,
            )
            .pipe(
              Effect.mapError((cause) =>
                managementError("Connector access could not be updated", cause),
              ),
            );
        });

        const ownedConnection = Effect.fn(
          "ConnectorManagement.ownedConnection",
        )(function* (memberId: FamilyMemberId, connectionId: string) {
          const connection = yield* store
            .findConnection(memberId, connectionId)
            .pipe(
              Effect.mapError((cause) =>
                managementError("The connection could not be loaded", cause),
              ),
            );
          if (connection === null) {
            return yield* new ConnectorServiceError({
              reason: "not_found",
              message: "Connection not found",
              cause: null,
            });
          }
          return connection;
        });

        return ConnectorManagement.of({
          enabled: true,
          list: (memberId) =>
            store.listConnections(memberId).pipe(
              Effect.map((connections) => connections.map(managedConnector)),
              Effect.mapError((cause) =>
                managementError("Connections could not be loaded", cause),
              ),
            ),
          listProviders: () =>
            configuredProviders().pipe(
              Effect.map((configs) =>
                configs
                  .filter(
                    (config) =>
                      config.configured &&
                      config.effectiveScopes.length > 0 &&
                      allowedServices.has(config.service),
                  )
                  .map((config) => ({
                    service: config.service,
                    scopes: config.effectiveScopes,
                  })),
              ),
              Effect.mapError((cause) =>
                managementError("Connector providers could not be loaded", cause),
              ),
            ),
          startOAuth: Effect.fn("ConnectorManagement.startOAuth")(function* (
            memberId,
            service,
            requestedScopes,
          ) {
            if (
              requestedScopes.length === 0 ||
              !allowedServices.has(service)
            ) {
              return yield* new ConnectorServiceError({
                reason: "not_allowed",
                message: "This connector or permission set is not allowed",
                cause: null,
              });
            }
            const provider = (yield* configuredProviders()).find(
              (config) => config.service === service && config.configured,
            );
            if (
              provider === undefined ||
              requestedScopes.length !== provider.effectiveScopes.length ||
              requestedScopes.some(
                (scope) => !provider.effectiveScopes.includes(scope),
              )
            ) {
              return yield* new ConnectorServiceError({
                reason: "not_allowed",
                message: "This connector or permission set is not allowed",
                cause: null,
              });
            }
            yield* ensureMemberToken(memberId);
            const connectionId = randomUUID();
            const connectionAlias = randomUUID();
            const oauthExpiresAt = DateTime.add(yield* DateTime.now, {
              minutes: 15,
            });
            const pending = {
              id: connectionId,
              familyMemberId: memberId,
              service,
              connectionAlias,
              externalConnectionId: null,
              oauthStateHash: null,
              oauthExpiresAt,
              requestedScopes,
              grantedScopes: [],
              status: "pending" as const,
            };
            yield* store.saveConnection(pending).pipe(
              Effect.mapError((cause) =>
                managementError("The pending connection could not be saved", cause),
              ),
            );
            const authorization = yield* client
              .startOAuth(
                adminToken,
                service,
                connectionAlias,
              )
              .pipe(
                Effect.tapError(() =>
                  store
                    .saveConnection({ ...pending, status: "failed" })
                    .pipe(Effect.ignore),
                ),
                Effect.mapError((cause) =>
                  managementError("Authorization could not be started", cause),
                ),
              );
            if (!validAuthorizationUrl(authorization.authorizationUrl)) {
              yield* store
                .saveConnection({ ...pending, status: "failed" })
                .pipe(Effect.ignore);
              return yield* managementError(
                "The provider returned an unsafe authorization URL",
                null,
              );
            }
            const withState = {
              ...pending,
              oauthStateHash: createHash("sha256")
                .update(authorization.state)
                .digest("hex"),
            };
            yield* store.saveConnection(withState).pipe(
              Effect.mapError((cause) =>
                managementError("Authorization state could not be saved", cause),
              ),
            );
            return {
              connection: {
                id: withState.id,
                service: withState.service,
                requestedScopes: withState.requestedScopes,
                grantedScopes: withState.grantedScopes,
                status: withState.status,
              },
              authorizationUrl: authorization.authorizationUrl,
            };
          }),
          reconcile: Effect.fn("ConnectorManagement.reconcile")(function* (
            memberId,
            connectionId,
          ) {
            const pending = yield* ownedConnection(memberId, connectionId);
            if (pending.status === "active") {
              yield* ensureMemberToken(memberId);
              yield* reconcileMemberGrant(memberId);
              return managedConnector(pending);
            }
            if (pending.status !== "pending") {
              return yield* new ConnectorServiceError({
                reason: "not_allowed",
                message: "This connection cannot be completed",
                cause: null,
              });
            }
            if (
              pending.oauthExpiresAt !== null &&
              DateTime.toEpochMillis(yield* DateTime.now) >=
                DateTime.toEpochMillis(pending.oauthExpiresAt)
            ) {
              yield* store
                .saveConnection({
                  id: pending.id,
                  familyMemberId: memberId,
                  service: pending.service,
                  connectionAlias: pending.connectionAlias,
                  externalConnectionId: pending.externalConnectionId,
                  oauthStateHash: pending.oauthStateHash,
                  oauthExpiresAt: pending.oauthExpiresAt,
                  requestedScopes: pending.requestedScopesJson,
                  grantedScopes: pending.grantedScopesJson,
                  status: "failed",
                })
                .pipe(
                  Effect.flatMap(() => reconcileMemberGrant(memberId)),
                  Effect.mapError((cause) =>
                    cause._tag === "ConnectorServiceError"
                      ? cause
                      : managementError(
                          "The expired connection could not be closed",
                          cause,
                        ),
                  ),
                );
              return yield* new ConnectorServiceError({
                reason: "not_allowed",
                message: "This authorization request has expired",
                cause: null,
              });
            }
            const available = yield* client
              .listAdminConnections(adminToken)
              .pipe(
                Effect.mapError((cause) =>
                  managementError("Connections could not be reconciled", cause),
                ),
              );
            const matched = available.find(
              (connection) =>
                !connection.virtual &&
                connection.configured &&
                connection.service === pending.service &&
                connection.connectionName === pending.connectionAlias,
            );
            if (matched === undefined) return managedConnector(pending);
            if (!sameScopes(pending.requestedScopesJson, matched.profile.grantedScopes)) {
              yield* client
                .disconnect(adminToken, pending.service, pending.connectionAlias)
                .pipe(
                  Effect.catchTag("OpenConnectorClientError", (cause) =>
                    cause.code === "connection_not_found"
                      ? Effect.void
                      : Effect.fail(cause)
                  ),
                  Effect.mapError((cause) =>
                    managementError("The unexpected connector grant could not be removed", cause)
                  ),
                );
              yield* store
                .saveConnection({
                  id: pending.id,
                  familyMemberId: memberId,
                  service: pending.service,
                  connectionAlias: pending.connectionAlias,
                  externalConnectionId: null,
                  oauthStateHash: pending.oauthStateHash,
                  oauthExpiresAt: null,
                  requestedScopes: pending.requestedScopesJson,
                  grantedScopes: [],
                  status: "failed",
                })
                .pipe(
                  Effect.flatMap(() => reconcileMemberGrant(memberId)),
                  Effect.mapError((cause) =>
                    cause._tag === "ConnectorServiceError"
                      ? cause
                      : managementError("The unexpected connector grant could not be rejected", cause)
                  ),
                );
              return yield* new ConnectorServiceError({
                reason: "not_allowed",
                message: "The provider granted a different permission set than requested",
                cause: null,
              });
            }
            const completed = {
              id: pending.id,
              familyMemberId: memberId,
              service: pending.service,
              connectionAlias: pending.connectionAlias,
              externalConnectionId: matched.id,
              oauthStateHash: pending.oauthStateHash,
              oauthExpiresAt: null,
              requestedScopes: pending.requestedScopesJson,
              grantedScopes: matched.profile.grantedScopes,
              status: "pending" as const,
            };
            yield* store.saveConnection(completed).pipe(
              Effect.mapError((cause) =>
                managementError("The connection could not be saved", cause),
              ),
            );
            yield* store.saveConnection({ ...completed, status: "active" }).pipe(
              Effect.flatMap(() => ensureMemberToken(memberId)),
              Effect.flatMap(() => reconcileMemberGrant(memberId)),
              Effect.tapError(() =>
                store.saveConnection(completed).pipe(Effect.ignore),
              ),
              Effect.mapError((cause) =>
                cause._tag === "ConnectorServiceError"
                  ? cause
                  : managementError("The connection could not be activated", cause),
              ),
            );
            const active = yield* ownedConnection(memberId, connectionId);
            return managedConnector(active);
          }),
          disconnect: Effect.fn("ConnectorManagement.disconnect")(function* (
            memberId,
            connectionId,
          ) {
            const connection = yield* ownedConnection(memberId, connectionId);
            yield* store
              .saveConnection({
                id: connection.id,
                familyMemberId: memberId,
                service: connection.service,
                connectionAlias: connection.connectionAlias,
                externalConnectionId: connection.externalConnectionId,
                oauthStateHash: connection.oauthStateHash,
                oauthExpiresAt: connection.oauthExpiresAt,
                requestedScopes: connection.requestedScopesJson,
                grantedScopes: connection.grantedScopesJson,
                status: "disconnecting",
              })
              .pipe(
                Effect.flatMap(() => reconcileMemberGrant(memberId)),
                Effect.mapError((cause) =>
                  cause._tag === "ConnectorServiceError"
                    ? cause
                    : managementError("The connection could not be disabled", cause),
                ),
              );
            if (connection.externalConnectionId !== null) {
              yield* client
                .disconnect(
                  adminToken,
                  connection.service,
                  connection.connectionAlias,
                )
                .pipe(
                  Effect.catchTag("OpenConnectorClientError", (cause) =>
                    cause.code === "connection_not_found"
                      ? Effect.void
                      : Effect.fail(cause),
                  ),
                  Effect.mapError((cause) =>
                    managementError("The provider connection could not be removed", cause),
                  ),
                );
            }
            yield* store.deleteConnection(memberId, connectionId).pipe(
              Effect.mapError((cause) =>
                managementError("The connection record could not be removed", cause),
              ),
            );
          }),
        });
      }).pipe(Effect.provide(clientLayer)),
    );
  }
}
