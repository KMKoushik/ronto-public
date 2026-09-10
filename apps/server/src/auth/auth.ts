import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { DatabaseSync } from "node:sqlite";

import { databasePath } from "../db/database.ts";
import { InvitationInput } from "@ronto/api";
import { Context, Effect, Layer, Schema } from "effect";
import { PlatformStore } from "../platform/platform-store.ts";

export const makeAuth = (
  filename: string,
  beforeSignup: (headers: Headers | undefined) => Promise<void> = async () => {
    throw new APIError("FORBIDDEN", { message: "An invitation is required" });
  },
) => {
  const database = new DatabaseSync(filename);
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA foreign_keys = ON");

  const instance = betterAuth({
    database,
    baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3141",
    trustedOrigins: [process.env.WEB_URL ?? "http://localhost:2718"],
    emailAndPassword: {
      enabled: true,
    },
    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") await beforeSignup(ctx.headers);
      }),
    },
  });

  return { auth: instance, database };
};

export const { auth, database: authDatabase } = makeAuth(databasePath);

export class Auth extends Context.Service<Auth, ReturnType<typeof makeAuth>["auth"]>()("ronto/auth/Auth") {
  static readonly layer = Layer.effect(Auth, Effect.gen(function* () {
    const platform = yield* PlatformStore;
    const instance = yield* Effect.acquireRelease(
      Effect.sync(() => makeAuth(databasePath, async (headers) => {
        const allowed = await Effect.runPromise(
          Effect.gen(function* () {
            const input = yield* Schema.decodeUnknownEffect(InvitationInput)({
              kind: headers?.get("x-ronto-invitation-kind"),
              token: headers?.get("x-ronto-invitation-token"),
            });
            yield* platform.validateInvitation(input.kind, input.token);
            return true;
          }).pipe(
            Effect.catchTag(["SchemaError", "AdmissionDenied"], () => Effect.succeed(false)),
          ),
        );
        if (!allowed) throw new APIError("FORBIDDEN", { message: "Invitation unavailable" });
      })),
      (instance) => Effect.sync(() => instance.database.close()),
    );
    return instance.auth;
  })).pipe(Layer.provide(PlatformStore.layer));
}
