import {
  Conflict,
  FamilyId,
  NotFound,
  type UserId,
} from "@ronto/api";
import { Context, Effect, Layer } from "effect";

import type { FamilyMember } from "../db/models.ts";
import { RontoStore } from "../db/ronto-store.ts";

export class FamilyAccess extends Context.Service<
  FamilyAccess,
  {
    readonly resolveMember: (
      userId: UserId,
      familyId: FamilyId,
    ) => Effect.Effect<FamilyMember, NotFound>;
    readonly resolvePrimary: (
      userId: UserId,
      familyId: FamilyId,
    ) => Effect.Effect<FamilyMember, NotFound | Conflict>;
  }
>()("ronto/http/FamilyAccess") {
  static readonly layer = Layer.effect(
    FamilyAccess,
    Effect.gen(function* () {
      const store = yield* RontoStore;
      const resolveMember = Effect.fn("FamilyAccess.resolveMember")(
        function* (userId: UserId, familyId: FamilyId) {
          const member = yield* store
            .findMemberByUserAndFamily(userId, familyId)
            .pipe(Effect.orDie);
          if (member === null) {
            return yield* new NotFound({ message: "Family not found" });
          }
          return member;
        },
      );
      const resolvePrimary = Effect.fn("FamilyAccess.resolvePrimary")(
        function* (userId: UserId, familyId: FamilyId) {
          const member = yield* resolveMember(userId, familyId);
          if (member.role !== "primary") {
            return yield* new Conflict({
              message: "Only a primary family member can manage family access",
            });
          }
          return member;
        },
      );
      return FamilyAccess.of({ resolveMember, resolvePrimary });
    }),
  );
}
