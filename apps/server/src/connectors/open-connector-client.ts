import { Context, Effect, Layer, Schema } from "effect";

const maxResponseBytes = 5 * 1024 * 1024;

export const OpenConnectorConnection = Schema.Struct({
  id: Schema.String,
  service: Schema.String,
  status: Schema.String,
  authType: Schema.String,
  displayName: Schema.String,
  accountLabel: Schema.String,
  isDefault: Schema.Boolean,
  scopes: Schema.Array(Schema.String),
  connectionName: Schema.String,
});
export type OpenConnectorConnection = typeof OpenConnectorConnection.Type;

export const OpenConnectorAction = Schema.Struct({
  id: Schema.String,
  service: Schema.String,
  name: Schema.String,
  description: Schema.String,
  requiredScopes: Schema.Array(Schema.String),
  inputSchema: Schema.JsonObject,
  outputSchema: Schema.JsonObject,
});
export type OpenConnectorAction = typeof OpenConnectorAction.Type;

export const OpenConnectorActionSummary = Schema.Struct({
  id: Schema.String,
  service: Schema.String,
  name: Schema.String,
  description: Schema.String,
  inputSchema: Schema.JsonObject,
  outputSchema: Schema.JsonObject,
});
export type OpenConnectorActionSummary =
  typeof OpenConnectorActionSummary.Type;

const ConnectionsResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Array(OpenConnectorConnection),
});
const ActionsResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Array(OpenConnectorActionSummary),
});
const ActionResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: OpenConnectorAction,
});
const ExecutionResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Json,
});
const ActionCatalogResponse = Schema.Struct({
  success: Schema.Literal(true),
  data: Schema.Array(OpenConnectorAction),
});
const ErrorResponse = Schema.Struct({
  success: Schema.Literal(false),
  errorCode: Schema.optional(Schema.String),
});
const AdminErrorResponse = Schema.Struct({
  error: Schema.Struct({ code: Schema.String }),
});
const RuntimeTokenRecord = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  allowedActions: Schema.Array(Schema.String),
  blockedActions: Schema.Array(Schema.String),
  allowedProxies: Schema.Array(Schema.String),
  allowedConnections: Schema.Array(Schema.String),
});
const CreatedRuntimeToken = Schema.Struct({
  token: Schema.String,
  record: RuntimeTokenRecord,
});
const AdminConnection = Schema.Struct({
  id: Schema.String,
  service: Schema.String,
  connectionName: Schema.String,
  authType: Schema.String,
  configured: Schema.Boolean,
  virtual: Schema.Boolean,
  default: Schema.Boolean,
  profile: Schema.Struct({
    accountId: Schema.String,
    displayName: Schema.String,
    grantedScopes: Schema.Array(Schema.String),
  }),
});
const OAuthAuthorization = Schema.Struct({
  authorizationUrl: Schema.String,
  state: Schema.String,
});
const OAuthConfig = Schema.Struct({
  service: Schema.String,
  configured: Schema.Boolean,
  expectedRedirectUri: Schema.String,
  effectiveScopes: Schema.Array(Schema.String),
});
const RevokedRuntimeToken = Schema.Struct({
  id: Schema.String,
  revoked: Schema.Literal(true),
});

const decodeConnections = Schema.decodeUnknownEffect(ConnectionsResponse);
const decodeActions = Schema.decodeUnknownEffect(ActionsResponse);
const decodeAction = Schema.decodeUnknownEffect(ActionResponse);
const decodeExecution = Schema.decodeUnknownEffect(ExecutionResponse);
const decodeError = Schema.decodeUnknownOption(ErrorResponse);
const decodeAdminError = Schema.decodeUnknownOption(AdminErrorResponse);
const decodeCreatedRuntimeToken = Schema.decodeUnknownEffect(CreatedRuntimeToken);
const decodeRuntimeTokenRecord = Schema.decodeUnknownEffect(RuntimeTokenRecord);
const decodeAdminConnections = Schema.decodeUnknownEffect(
  Schema.Array(AdminConnection),
);
const decodeOAuthAuthorization = Schema.decodeUnknownEffect(OAuthAuthorization);
const decodeOAuthConfigs = Schema.decodeUnknownEffect(Schema.Array(OAuthConfig));
const decodeRevokedRuntimeToken = Schema.decodeUnknownEffect(RevokedRuntimeToken);

export type OpenConnectorAdminConnection = typeof AdminConnection.Type;
export type OpenConnectorOAuthAuthorization = typeof OAuthAuthorization.Type;
export type OpenConnectorCreatedRuntimeToken = typeof CreatedRuntimeToken.Type;
export type OpenConnectorOAuthConfig = typeof OAuthConfig.Type;

export class OpenConnectorClientError extends Schema.TaggedError<OpenConnectorClientError>()(
  "OpenConnectorClientError",
  {
    operation: Schema.String,
    status: Schema.NullOr(Schema.Int),
    code: Schema.NullOr(Schema.String),
    cause: Schema.Defect(),
  },
) {}

export type OpenConnectorRequest = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

const normalizeBaseUrl = (input: string): string => {
  const url = new URL(input);
  if (
    url.protocol !== "http:" ||
    url.hostname !== "127.0.0.1" && url.hostname !== "[::1]"
  ) {
    throw new Error("OpenConnector must use a loopback HTTP URL");
  }
  url.pathname = url.pathname.replace(/\/$/, "");
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
};

const readBoundedJson = async (response: Response): Promise<Schema.Json> => {
  const contentLength = response.headers.get("content-length");
  if (
    contentLength !== null &&
    Number.parseInt(contentLength, 10) > maxResponseBytes
  ) {
    throw new Error("OpenConnector response exceeds 5MB");
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > maxResponseBytes) {
    throw new Error("OpenConnector response exceeds 5MB");
  }
  return Schema.decodeUnknownSync(Schema.Json)(
    JSON.parse(new TextDecoder().decode(bytes)),
  );
};

const makeOpenConnectorClient = (
  baseUrlInput: string,
  request: OpenConnectorRequest,
): OpenConnectorClient["Service"] => {
  const baseUrl = normalizeBaseUrl(baseUrlInput);

  const call = Effect.fn("OpenConnectorClient.call")(function* (
    operation: string,
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body: string | undefined,
    connectionName: string | undefined,
    idempotencyKey: string | undefined,
    runtimeToken: string,
  ) {
    const response = yield* Effect.tryPromise({
      try: (signal) => {
        const headers = new Headers({
          Accept: "application/json",
          Authorization: `Bearer ${runtimeToken}`,
        });
        if (body !== undefined) headers.set("Content-Type", "application/json");
        if (connectionName !== undefined) {
          headers.set("X-Oo-Connector-Alias", connectionName);
        }
        if (idempotencyKey !== undefined) {
          headers.set("Idempotency-Key", idempotencyKey);
        }
        const init: RequestInit = { method, headers, signal };
        if (body !== undefined) init.body = body;
        return request(`${baseUrl}${path}`, init);
      },
      catch: (cause) =>
        new OpenConnectorClientError({
          operation,
          status: null,
          code: null,
          cause,
        }),
    });
    const payload = yield* Effect.tryPromise({
      try: () => readBoundedJson(response),
      catch: (cause) =>
        new OpenConnectorClientError({
          operation,
          status: response.status,
          code: null,
          cause,
        }),
    });
    if (!response.ok) {
      const error = decodeError(payload);
      const adminError = decodeAdminError(payload);
      return yield* new OpenConnectorClientError({
        operation,
        status: response.status,
        code:
          error._tag === "Some"
            ? error.value.errorCode ?? null
            : adminError._tag === "Some"
              ? adminError.value.error.code
              : null,
        cause: new Error("OpenConnector rejected the request"),
      });
    }
    return payload;
  });

  const listConnections = Effect.fn("OpenConnectorClient.listConnections")(
    function* (runtimeToken: string) {
      const payload = yield* call(
        "list connections",
        "GET",
        "/v1/apps",
        undefined,
        undefined,
        undefined,
        runtimeToken,
      );
      return yield* decodeConnections(payload).pipe(
        Effect.map((response) => response.data),
        Effect.mapError(
          (cause) =>
            new OpenConnectorClientError({
              operation: "list connections",
              status: 200,
              code: null,
              cause,
            }),
        ),
      );
    },
  );

  const searchActions = Effect.fn("OpenConnectorClient.searchActions")(
    function* (
      runtimeToken: string,
      query: string,
      service: string | undefined,
      limit: number,
    ) {
      const search = new URLSearchParams({ q: query, limit: String(limit) });
      if (service !== undefined) search.set("service", service);
      const payload = yield* call(
        "search actions",
        "GET",
        `/v1/actions/search?${search.toString()}`,
        undefined,
        undefined,
        undefined,
        runtimeToken,
      );
      return yield* decodeActions(payload).pipe(
        Effect.map((response) => response.data),
        Effect.mapError(
          (cause) =>
            new OpenConnectorClientError({
              operation: "search actions",
              status: 200,
              code: null,
              cause,
            }),
        ),
      );
    },
  );

  const listActions = Effect.fn("OpenConnectorClient.listActions")(
    function* (runtimeToken: string, service: string) {
      const payload = yield* call(
        "list actions",
        "GET",
        `/v1/actions?${new URLSearchParams({ service })}`,
        undefined,
        undefined,
        undefined,
        runtimeToken,
      );
      return yield* Schema.decodeUnknownEffect(ActionCatalogResponse)(payload).pipe(
        Effect.map((response) => response.data),
        Effect.mapError((cause) => new OpenConnectorClientError({
          operation: "list actions",
          status: 200,
          code: null,
          cause,
        })),
      );
    },
  );

  const getAction = Effect.fn("OpenConnectorClient.getAction")(function* (
    runtimeToken: string,
    actionId: string,
  ) {
    const payload = yield* call(
      "get action",
      "GET",
      `/v1/actions/${encodeURIComponent(actionId)}`,
      undefined,
      undefined,
      undefined,
      runtimeToken,
    );
    return yield* decodeAction(payload).pipe(
      Effect.map((response) => response.data),
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "get action",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const execute = Effect.fn("OpenConnectorClient.execute")(function* (
    runtimeToken: string,
    actionId: string,
    input: Schema.JsonObject,
    connectionName: string,
    idempotencyKey: string,
  ) {
    const payload = yield* call(
      "execute action",
      "POST",
      `/v1/actions/${encodeURIComponent(actionId)}`,
      JSON.stringify({ input }),
      connectionName,
      idempotencyKey,
      runtimeToken,
    );
    return yield* decodeExecution(payload).pipe(
      Effect.map((response) => response.data),
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "execute action",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const createRuntimeToken = Effect.fn(
    "OpenConnectorClient.createRuntimeToken",
  )(function* (
    adminToken: string,
    name: string,
    allowedActions: ReadonlyArray<string>,
    allowedConnections: ReadonlyArray<string>,
  ) {
    const payload = yield* call(
      "create runtime token",
      "POST",
      "/api/runtime-tokens",
      JSON.stringify({
        name,
        allowedActions,
        blockedActions: [],
        allowedProxies: [],
        allowedConnections,
      }),
      undefined,
      undefined,
      adminToken,
    );
    return yield* decodeCreatedRuntimeToken(payload).pipe(
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "create runtime token",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const updateRuntimeToken = Effect.fn(
    "OpenConnectorClient.updateRuntimeToken",
  )(function* (
    adminToken: string,
    tokenId: string,
    allowedActions: ReadonlyArray<string>,
    allowedConnections: ReadonlyArray<string>,
  ) {
    const payload = yield* call(
      "update runtime token",
      "PUT",
      `/api/runtime-tokens/${encodeURIComponent(tokenId)}`,
      JSON.stringify({
        allowedActions,
        blockedActions: [],
        allowedProxies: [],
        allowedConnections,
      }),
      undefined,
      undefined,
      adminToken,
    );
    return yield* decodeRuntimeTokenRecord(payload).pipe(
      Effect.asVoid,
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "update runtime token",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const revokeRuntimeToken = Effect.fn(
    "OpenConnectorClient.revokeRuntimeToken",
  )(function* (adminToken: string, tokenId: string) {
    const payload = yield* call(
      "revoke runtime token",
      "DELETE",
      `/api/runtime-tokens/${encodeURIComponent(tokenId)}`,
      undefined,
      undefined,
      undefined,
      adminToken,
    );
    return yield* decodeRevokedRuntimeToken(payload).pipe(
      Effect.asVoid,
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "revoke runtime token",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const listAdminConnections = Effect.fn(
    "OpenConnectorClient.listAdminConnections",
  )(function* (adminToken: string) {
    const payload = yield* call(
      "list admin connections",
      "GET",
      "/api/connections",
      undefined,
      undefined,
      undefined,
      adminToken,
    );
    return yield* decodeAdminConnections(payload).pipe(
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "list admin connections",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const startOAuth = Effect.fn("OpenConnectorClient.startOAuth")(function* (
    adminToken: string,
    service: string,
    connectionName: string,
  ) {
    const payload = yield* call(
      "start OAuth",
      "POST",
      "/api/oauth/authorizations",
      JSON.stringify({ service, connectionName }),
      undefined,
      undefined,
      adminToken,
    );
    return yield* decodeOAuthAuthorization(payload).pipe(
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "start OAuth",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const listOAuthConfigs = Effect.fn(
    "OpenConnectorClient.listOAuthConfigs",
  )(function* (adminToken: string) {
    const payload = yield* call(
      "list OAuth configs",
      "GET",
      "/api/oauth/configs",
      undefined,
      undefined,
      undefined,
      adminToken,
    );
    return yield* decodeOAuthConfigs(payload).pipe(
      Effect.mapError(
        (cause) =>
          new OpenConnectorClientError({
            operation: "list OAuth configs",
            status: 200,
            code: null,
            cause,
          }),
      ),
    );
  });

  const disconnect = Effect.fn("OpenConnectorClient.disconnect")(function* (
    adminToken: string,
    service: string,
    connectionName: string,
  ) {
    yield* call(
      "disconnect",
      "DELETE",
      `/api/connections/${encodeURIComponent(service)}`,
      JSON.stringify({ connectionName }),
      undefined,
      undefined,
      adminToken,
    );
  });

  return OpenConnectorClient.of({
    listConnections,
    listActions,
    searchActions,
    getAction,
    execute,
    createRuntimeToken,
    updateRuntimeToken,
    revokeRuntimeToken,
    listAdminConnections,
    startOAuth,
    listOAuthConfigs,
    disconnect,
  });
};

export class OpenConnectorClient extends Context.Service<
  OpenConnectorClient,
  {
    listConnections(runtimeToken: string): Effect.Effect<
      ReadonlyArray<OpenConnectorConnection>,
      OpenConnectorClientError
    >;
    searchActions(
      runtimeToken: string,
      query: string,
      service: string | undefined,
      limit: number,
    ): Effect.Effect<
      ReadonlyArray<OpenConnectorActionSummary>,
      OpenConnectorClientError
    >;
    listActions(
      runtimeToken: string,
      service: string,
    ): Effect.Effect<ReadonlyArray<OpenConnectorAction>, OpenConnectorClientError>;
    getAction(
      runtimeToken: string,
      actionId: string,
    ): Effect.Effect<OpenConnectorAction, OpenConnectorClientError>;
    execute(
      runtimeToken: string,
      actionId: string,
      input: Schema.JsonObject,
      connectionName: string,
      idempotencyKey: string,
    ): Effect.Effect<Schema.Json, OpenConnectorClientError>;
    createRuntimeToken(
      adminToken: string,
      name: string,
      allowedActions: ReadonlyArray<string>,
      allowedConnections: ReadonlyArray<string>,
    ): Effect.Effect<OpenConnectorCreatedRuntimeToken, OpenConnectorClientError>;
    updateRuntimeToken(
      adminToken: string,
      tokenId: string,
      allowedActions: ReadonlyArray<string>,
      allowedConnections: ReadonlyArray<string>,
    ): Effect.Effect<void, OpenConnectorClientError>;
    revokeRuntimeToken(
      adminToken: string,
      tokenId: string,
    ): Effect.Effect<void, OpenConnectorClientError>;
    listAdminConnections(
      adminToken: string,
    ): Effect.Effect<
      ReadonlyArray<OpenConnectorAdminConnection>,
      OpenConnectorClientError
    >;
    startOAuth(
      adminToken: string,
      service: string,
      connectionName: string,
    ): Effect.Effect<OpenConnectorOAuthAuthorization, OpenConnectorClientError>;
    listOAuthConfigs(
      adminToken: string,
    ): Effect.Effect<
      ReadonlyArray<OpenConnectorOAuthConfig>,
      OpenConnectorClientError
    >;
    disconnect(
      adminToken: string,
      service: string,
      connectionName: string,
    ): Effect.Effect<void, OpenConnectorClientError>;
  }
>()("ronto/connectors/OpenConnectorClient") {
  static layer(
    baseUrl: string,
    request: OpenConnectorRequest = fetch,
  ): Layer.Layer<OpenConnectorClient> {
    return Layer.succeed(
      OpenConnectorClient,
      makeOpenConnectorClient(baseUrl, request),
    );
  }
}
