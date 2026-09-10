import { NodeHttpServer, NodeRuntime } from "@effect/platform-node";
import { Effect, Layer } from "effect";
import {
  HttpRouter,
  HttpServerRequest,
  HttpServerResponse,
} from "effect/unstable/http";
import { HttpApiBuilder } from "effect/unstable/httpapi";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PlatformStore } from "./platform/platform-store.ts";

import { Auth } from "./auth/auth.ts";
import { DatabaseLive } from "./db/database.ts";
import { RontoApi } from "@ronto/api";
import {
  RontoApiHandlers,
  AdmissionApiHandlers,
  SessionSummaryRuntimeLive,
} from "./http/ronto-api.ts";
import { ConversationStreamRoutes } from "./http/conversation-stream.ts";

const AuthRoutes = HttpRouter.use((router) =>
  router.add("*", "/api/auth/*", (request) =>
    HttpServerRequest.toWeb(request).pipe(
      Effect.flatMap((webRequest) => Effect.gen(function* () {
        const auth = yield* Auth;
        return yield* Effect.promise(() => auth.handler(webRequest));
      })),
      Effect.map(HttpServerResponse.fromWeb),
    ),
  ),
);

const HealthRoute = HttpRouter.use((router) =>
  router.add("GET", "/api/health", Effect.gen(function* () {
    const connectorUrl = process.env.OPEN_CONNECTOR_URL?.trim();
    if (!connectorUrl) {
      return HttpServerResponse.jsonUnsafe({ status: "ok" });
    }
    const healthy = yield* Effect.tryPromise(() =>
      fetch(new URL("/health", connectorUrl), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(2_000),
      })
    ).pipe(
      Effect.map((response) => response.ok),
      Effect.orElseSucceed(() => false),
    );
    return healthy
      ? HttpServerResponse.jsonUnsafe({ status: "ok" })
      : HttpServerResponse.jsonUnsafe(
          { status: "unavailable", dependency: "open-connector" },
          { status: 503 },
        );
  })),
);

const ConnectorOAuthCallbackRoute = HttpRouter.use((router) =>
  router.add("GET", "/oauth/callback", (request) => Effect.gen(function* () {
    const connectorUrl = process.env.OPEN_CONNECTOR_URL?.trim();
    if (!connectorUrl) {
      return yield* Effect.succeed(HttpServerResponse.jsonUnsafe(
        { error: "Connectors are not enabled" },
        { status: 404 },
      ));
    }
    const incoming = yield* HttpServerRequest.toWeb(request);
    const target = new URL("/oauth/callback", connectorUrl);
    target.search = new URL(incoming.url).search;
    return yield* Effect.tryPromise(() =>
      fetch(target, {
        headers: { Accept: "text/html,application/json" },
        signal: AbortSignal.timeout(30_000),
      }),
    ).pipe(
      Effect.map(HttpServerResponse.fromWeb),
      Effect.catch(() =>
        Effect.succeed(
          HttpServerResponse.jsonUnsafe(
            { error: "The connector callback failed" },
            { status: 502 },
          ),
        ),
      ),
    );
  })),
);

const ApiRoutes = HttpApiBuilder.layer(RontoApi).pipe(
  Layer.provide([RontoApiHandlers, AdmissionApiHandlers]),
);

const Routes = Layer.mergeAll(
  AuthRoutes,
  HealthRoute,
  ConnectorOAuthCallbackRoute,
  ConversationStreamRoutes,
  ApiRoutes,
  SessionSummaryRuntimeLive,
).pipe(
  Layer.provide(
    HttpRouter.cors({
      allowedOrigins: [process.env.WEB_URL ?? "http://localhost:2718"],
      credentials: true,
    }),
  ),
);

const BootstrappedDatabase = Layer.effectDiscard(Effect.gen(function* () {
  const platform = yield* PlatformStore;
  if ((yield* platform.findAdministrator()) !== null) return;
  const email = process.env.PLATFORM_ADMIN_EMAIL?.trim();
  if (!email) return yield* Effect.die(new Error("PLATFORM_ADMIN_EMAIL is required for initial bootstrap"));
  yield* platform.bootstrapAdministrator(email, randomUUID());
})).pipe(Layer.provide(PlatformStore.layer), Layer.provideMerge(DatabaseLive));

HttpRouter.serve(Routes).pipe(
  Layer.provide(Auth.layer),
  Layer.provideMerge(BootstrappedDatabase),
  Layer.provide(
    NodeHttpServer.layer(createServer, {
      host: process.env.HOST ?? "127.0.0.1",
      port: Number(process.env.PORT ?? 3141),
    }),
  ),
  Layer.launch,
  NodeRuntime.runMain,
);
