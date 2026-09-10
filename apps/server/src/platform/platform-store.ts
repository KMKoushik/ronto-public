import { FamilyId, UserId } from "@ronto/api";
import { Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { createHash, randomBytes, randomUUID } from "node:crypto";

export class AdmissionDenied extends Schema.TaggedError<AdmissionDenied>()(
  "AdmissionDenied",
  { message: Schema.String },
) {}

const PlatformInvitation = Schema.Struct({
  id: Schema.String,
  createdByUserId: UserId,
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  claimedByUserId: Schema.NullOr(UserId),
  claimedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
});
export type PlatformInvitation = typeof PlatformInvitation.Type;

const CreationGrant = Schema.Struct({
  id: Schema.String,
  userId: UserId,
  status: Schema.Literals(["granted", "consumed", "revoked"]),
  createdFamilyId: Schema.NullOr(FamilyId),
});
export type CreationGrant = typeof CreationGrant.Type;

const PlatformFamily = Schema.Struct({
  id: FamilyId,
  name: Schema.String,
  creatorUserId: Schema.NullOr(UserId),
  creatorName: Schema.NullOr(Schema.String),
  memberCount: Schema.Int,
  managedFileBytes: Schema.Int,
  sandboxProvisioned: Schema.BooleanFromBit,
  sandboxDirectoryDevice: Schema.NullOr(Schema.Int),
  sandboxDirectoryInode: Schema.NullOr(Schema.Int),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
});
export type PlatformFamily = typeof PlatformFamily.Type;

const tokenHash = (token: string) =>
  createHash("sha256").update(token).digest("hex");

const Administrator = Schema.Struct({
  userId: UserId,
  bootstrappedFromEmail: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
});
export type Administrator = typeof Administrator.Type;

const UserIdentity = Schema.Struct({
  id: UserId,
  email: Schema.NonEmptyString,
});

const LegacyFamily = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.DateTimeUtcFromString,
});

type PlatformStoreError = SqlError | Schema.SchemaError;

export class PlatformStore extends Context.Service<
  PlatformStore,
  {
    readonly bootstrapAdministrator: (
      email: string,
      legacyGrantId: string,
    ) => Effect.Effect<Administrator, PlatformStoreError>;
    readonly findAdministrator: () => Effect.Effect<
      Administrator | null,
      PlatformStoreError
    >;
    readonly isAdministrator: (
      userId: UserId,
    ) => Effect.Effect<boolean, PlatformStoreError>;
    readonly createInvitation: (
      userId: UserId,
    ) => Effect.Effect<
      { readonly token: string; readonly invitation: PlatformInvitation },
      PlatformStoreError | AdmissionDenied
    >;
    readonly listInvitations: (
      userId: UserId,
    ) => Effect.Effect<ReadonlyArray<PlatformInvitation>, PlatformStoreError | AdmissionDenied>;
    readonly revokeInvitation: (
      userId: UserId,
      invitationId: string,
    ) => Effect.Effect<void, PlatformStoreError | AdmissionDenied>;
    readonly redeemInvitation: (
      userId: UserId,
      token: string,
    ) => Effect.Effect<void, PlatformStoreError | AdmissionDenied>;
    readonly findCreationGrant: (
      userId: UserId,
    ) => Effect.Effect<CreationGrant | null, PlatformStoreError>;
    readonly validateInvitation: (
      kind: "platform" | "family",
      token: string,
    ) => Effect.Effect<void, PlatformStoreError | AdmissionDenied>;
    readonly listFamilies: (userId: UserId) => Effect.Effect<
      ReadonlyArray<PlatformFamily>, PlatformStoreError | AdmissionDenied
    >;
  }
>()("ronto/platform/PlatformStore") {
  static readonly layer = Layer.effect(
    PlatformStore,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const findAdministratorRecord = SqlSchema.findOneOption({
        Request: Schema.Void,
        Result: Administrator,
        execute: () => sql`
          SELECT user_id, bootstrapped_from_email, created_at
          FROM ronto_platform_administrator
          WHERE singleton = 1
        `,
      });
      const findBootstrapUsers = SqlSchema.findAll({
        Request: Schema.String,
        Result: UserIdentity,
        execute: (email) => sql`
          SELECT id, email
          FROM user
          WHERE email = ${email} COLLATE NOCASE
        `,
      });
      const findLegacyFamilies = SqlSchema.findAll({
        Request: UserId,
        Result: LegacyFamily,
        execute: (userId) => sql`
          SELECT family.id, family.created_at
          FROM ronto_family family
          JOIN ronto_family_member member ON member.family_id = family.id
          WHERE member.user_id = ${userId} AND member.role = 'primary'
          ORDER BY member.joined_at, family.id
        `,
      });

      const findAdministrator = Effect.fn(
        "PlatformStore.findAdministrator",
      )(function* () {
        return Option.getOrNull(yield* findAdministratorRecord(undefined));
      });

      const bootstrapAdministrator = Effect.fn(
        "PlatformStore.bootstrapAdministrator",
      )(function* (email: string, legacyGrantId: string) {
        const existing = yield* findAdministrator();
        if (existing !== null) return existing;
        const users = yield* findBootstrapUsers(email.trim());
        if (users.length !== 1) {
          return yield* Effect.die(
            new Error(
              `PLATFORM_ADMIN_EMAIL must resolve to exactly one existing user; found ${users.length}`,
            ),
          );
        }
        const administrator = users[0];
        if (administrator === undefined) {
          return yield* Effect.die("Platform administrator disappeared");
        }
        const legacyFamilies = yield* findLegacyFamilies(administrator.id);
        if (legacyFamilies.length > 1) {
          return yield* Effect.die(
            "The bootstrap administrator is primary in multiple legacy families",
          );
        }
        const now = yield* DateTime.now;
        const nowIso = DateTime.formatIso(now);
        return yield* sql.withTransaction(
          Effect.gen(function* () {
            yield* sql`
              INSERT INTO ronto_platform_administrator (
                singleton, user_id, bootstrapped_from_email, created_at
              ) VALUES (1, ${administrator.id}, ${administrator.email}, ${nowIso})
            `;
            const legacyFamily = legacyFamilies[0];
            if (legacyFamily !== undefined) {
              const familyCreatedAt = DateTime.formatIso(legacyFamily.createdAt);
              yield* sql`
                INSERT INTO ronto_family_creation_grant (
                  id, user_id, platform_invite_id, granted_by_user_id,
                  status, granted_at, consumed_at, revoked_at, created_family_id
                ) VALUES (
                  ${legacyGrantId}, ${administrator.id}, NULL, ${administrator.id},
                  'consumed', ${familyCreatedAt}, ${familyCreatedAt},
                  NULL, ${legacyFamily.id}
                )
              `;
            }
            return {
              userId: administrator.id,
              bootstrappedFromEmail: administrator.email,
              createdAt: now,
            };
          }),
        );
      });

      const isAdministrator = Effect.fn(
        "PlatformStore.isAdministrator",
      )(function* (userId: UserId) {
        const administrator = yield* findAdministrator();
        return administrator?.userId === userId;
      });

      const insertInvitation = SqlSchema.findOneOption({
        Request: Schema.Struct({
          userId: UserId, id: Schema.String, hash: Schema.String,
          now: Schema.String, expiresAt: Schema.String,
        }),
        Result: PlatformInvitation,
        execute: ({ userId, id, hash, now, expiresAt }) => sql`
          INSERT INTO ronto_platform_invite (
            id, token_hash, created_by_user_id, created_at, expires_at
          )
          SELECT ${id}, ${hash}, ${userId}, ${now}, ${expiresAt}
          WHERE EXISTS (
            SELECT 1 FROM ronto_platform_administrator
            WHERE singleton = 1 AND user_id = ${userId}
          )
          RETURNING id, created_by_user_id, created_at, expires_at,
            revoked_at, claimed_by_user_id, claimed_at
        `,
      });
      const findInvitations = SqlSchema.findAll({
        Request: Schema.Void,
        Result: PlatformInvitation,
        execute: () => sql`
          SELECT id, created_by_user_id, created_at, expires_at,
            revoked_at, claimed_by_user_id, claimed_at
          FROM ronto_platform_invite
          ORDER BY created_at DESC, id
        `,
      });
      const revokeInvite = SqlSchema.findOneOption({
        Request: Schema.Struct({ userId: UserId, id: Schema.String, now: Schema.String }),
        Result: Schema.Struct({ id: Schema.String }),
        execute: ({ userId, id, now }) => sql`
          UPDATE ronto_platform_invite SET revoked_at = ${now}
          WHERE id = ${id} AND revoked_at IS NULL AND claimed_at IS NULL
            AND EXISTS (
              SELECT 1 FROM ronto_platform_administrator
              WHERE singleton = 1 AND user_id = ${userId}
            )
          RETURNING id
        `,
      });
      const claimInvitation = SqlSchema.findOneOption({
        Request: Schema.Struct({ userId: UserId, hash: Schema.String, now: Schema.String }),
        Result: Schema.Struct({ id: Schema.String, createdByUserId: UserId }),
        execute: ({ userId, hash, now }) => sql`
          UPDATE ronto_platform_invite
          SET claimed_by_user_id = ${userId}, claimed_at = ${now}
          WHERE token_hash = ${hash}
            AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > ${now}
            AND NOT EXISTS (
              SELECT 1 FROM ronto_family_creation_grant WHERE user_id = ${userId}
            )
          RETURNING id, created_by_user_id
        `,
      });
      const findGrant = SqlSchema.findOneOption({
        Request: UserId,
        Result: CreationGrant,
        execute: (userId) => sql`
          SELECT id, user_id, status, created_family_id
          FROM ronto_family_creation_grant WHERE user_id = ${userId}
        `,
      });

      const createInvitation = Effect.fn("PlatformStore.createInvitation")(
        function* (userId: UserId) {
          const token = randomBytes(24).toString("base64url");
          const now = yield* DateTime.now;
          const invitation = yield* insertInvitation({
            userId, id: randomUUID(), hash: tokenHash(token),
            now: DateTime.formatIso(now),
            expiresAt: DateTime.formatIso(DateTime.add(now, { days: 7 })),
          });
          if (Option.isNone(invitation)) {
            return yield* new AdmissionDenied({ message: "Platform access not found" });
          }
          return { token, invitation: invitation.value };
        },
      );
      const listInvitations = Effect.fn("PlatformStore.listInvitations")(
        function* (userId: UserId) {
          if (!(yield* isAdministrator(userId))) {
            return yield* new AdmissionDenied({ message: "Platform access not found" });
          }
          return yield* findInvitations(undefined);
        },
      );
      const revokeInvitation = Effect.fn("PlatformStore.revokeInvitation")(
        function* (userId: UserId, invitationId: string) {
          const revoked = yield* revokeInvite({
            userId, id: invitationId, now: DateTime.formatIso(yield* DateTime.now),
          });
          if (Option.isNone(revoked)) {
            return yield* new AdmissionDenied({ message: "Invitation unavailable" });
          }
        },
      );
      const redeemInvitation = Effect.fn("PlatformStore.redeemInvitation")(
        function* (userId: UserId, token: string) {
          yield* sql.withTransaction(Effect.gen(function* () {
            const now = DateTime.formatIso(yield* DateTime.now);
            const invitation = yield* claimInvitation({ userId, hash: tokenHash(token), now });
            if (Option.isNone(invitation)) {
              return yield* new AdmissionDenied({ message: "Invitation unavailable" });
            }
            yield* sql`
              INSERT INTO ronto_family_creation_grant (
                id, user_id, platform_invite_id, granted_by_user_id, status, granted_at
              ) VALUES (
                ${randomUUID()}, ${userId}, ${invitation.value.id},
                ${invitation.value.createdByUserId}, 'granted', ${now}
              )
            `;
          }));
        },
      );
      const findCreationGrant = Effect.fn("PlatformStore.findCreationGrant")(
        function* (userId: UserId) {
          return Option.getOrNull(yield* findGrant(userId));
        },
      );

      const findAvailableInvite = SqlSchema.findOneOption({
        Request: Schema.Struct({ kind: Schema.Literals(["platform", "family"]), hash: Schema.String, now: Schema.String }),
        Result: Schema.Struct({ id: Schema.String }),
        execute: ({ kind, hash, now }) => kind === "platform" ? sql`
          SELECT id FROM ronto_platform_invite WHERE token_hash = ${hash}
            AND claimed_at IS NULL AND revoked_at IS NULL AND expires_at > ${now}
        ` : sql`
          SELECT id FROM ronto_family_invite WHERE token_hash = ${hash}
            AND claimed_at IS NULL AND expires_at > ${now}
        `,
      });
      const validateInvitation = Effect.fn("PlatformStore.validateInvitation")(
        function* (kind: "platform" | "family", token: string) {
          const invitation = yield* findAvailableInvite({
            kind, hash: tokenHash(token), now: DateTime.formatIso(yield* DateTime.now),
          });
          if (Option.isNone(invitation)) {
            return yield* new AdmissionDenied({ message: "Invitation unavailable" });
          }
        },
      );

      const findFamilyMetadata = SqlSchema.findAll({
        Request: Schema.Void,
        Result: PlatformFamily,
        execute: () => sql`
          SELECT family.id, family.name, family.created_at, family.updated_at,
            grant.user_id AS creator_user_id, creator.name AS creator_name,
            (SELECT COUNT(*) FROM ronto_family_member member WHERE member.family_id = family.id) AS member_count,
            (SELECT COALESCE(SUM(file.byte_size), 0) FROM ronto_file file
              JOIN ronto_channel channel ON channel.id = file.channel_id
              WHERE channel.family_id = family.id) AS managed_file_bytes,
            CASE WHEN slot.provisioned_at IS NOT NULL THEN 1 ELSE 0 END AS sandbox_provisioned,
            slot.directory_device AS sandbox_directory_device,
            slot.directory_inode AS sandbox_directory_inode
          FROM ronto_family family
          LEFT JOIN ronto_family_creation_grant grant ON grant.created_family_id = family.id
          LEFT JOIN user creator ON creator.id = grant.user_id
          LEFT JOIN ronto_family_sandbox_slot slot ON slot.assigned_family_id = family.id
          ORDER BY family.created_at, family.id
        `,
      });
      const listFamilies = Effect.fn("PlatformStore.listFamilies")(
        function* (userId: UserId) {
          if (!(yield* isAdministrator(userId))) {
            return yield* new AdmissionDenied({ message: "Platform access not found" });
          }
          return yield* findFamilyMetadata(undefined);
        },
      );

      return PlatformStore.of({
        bootstrapAdministrator,
        findAdministrator,
        isAdministrator,
        createInvitation,
        listInvitations,
        revokeInvitation,
        redeemInvitation,
        findCreationGrant,
        validateInvitation,
        listFamilies,
      });
    }),
  );
}
