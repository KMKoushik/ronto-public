import {
  AuthenticatedUser,
  Authorization,
  Unauthorized,
  UserId,
} from "@ronto/api";
import { Effect, Layer, Schema } from "effect";
import { HttpServerRequest } from "effect/unstable/http";

import type { auth } from "../auth/auth.ts";
import { Auth } from "../auth/auth.ts";

const decodeUserId = Schema.decodeUnknownEffect(UserId);

export const authenticatedUser = (authInstance: typeof auth) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const session = yield* Effect.tryPromise({
      try: () =>
        authInstance.api.getSession({ headers: new Headers(request.headers) }),
      catch: () => new Unauthorized({ message: "Invalid session" }),
    });
    if (session === null) {
      return yield* new Unauthorized({ message: "Authentication required" });
    }
    const userId = yield* decodeUserId(session.user.id).pipe(
      Effect.mapError(
        () => new Unauthorized({ message: "Invalid authenticated user" }),
      ),
    );
    return AuthenticatedUser.of({
      id: userId,
      name: session.user.name,
      email: session.user.email,
    });
  });

export const authorizationLayer = (authInstance: typeof auth) =>
  Layer.succeed(
    Authorization,
    Authorization.of((httpEffect) =>
      Effect.gen(function*() {
        const user = yield* authenticatedUser(authInstance);
        return yield* Effect.provideService(
          httpEffect,
          AuthenticatedUser,
          user,
        );
      }),
    ),
  );

export const AuthorizationLive = Layer.unwrap(Effect.gen(function* () {
  return authorizationLayer(yield* Auth);
}));
