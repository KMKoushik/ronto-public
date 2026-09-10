import { ChannelId, FamilyId } from "@ronto/api";
import { Context, Effect, Layer, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/unstable/sql";
import { SandboxIdentifier } from "./sandbox-config.ts";

export class SandboxUnavailable extends Schema.TaggedError<SandboxUnavailable>()(
  "SandboxUnavailable", { message: Schema.String },
) {}

export const SandboxSlot = Schema.Struct({
  id: FamilyId,
  projectId: Schema.Int,
  directoryDevice: Schema.Int,
  directoryInode: Schema.Int,
});
export type SandboxSlot = typeof SandboxSlot.Type;

export class SandboxStore extends Context.Service<SandboxStore, {
  readonly resolve: (familyId: FamilyId, channelId: ChannelId) => Effect.Effect<SandboxSlot, SandboxUnavailable>;
}>()("ronto/sandbox/SandboxStore") {
  static readonly layer = Layer.effect(SandboxStore, Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const find = SqlSchema.findOneOption({
      Request: Schema.Struct({ familyId: FamilyId, channelId: ChannelId }),
      Result: SandboxSlot,
      execute: ({ familyId, channelId }) => sql`
        SELECT slot.id, slot.project_id, slot.directory_device, slot.directory_inode
        FROM ronto_family_sandbox_slot slot
        JOIN ronto_channel channel ON channel.family_id = slot.assigned_family_id
        WHERE slot.assigned_family_id = ${familyId} AND channel.id = ${channelId}
          AND slot.provisioned_at IS NOT NULL
      `,
    });
    const resolve = Effect.fn("SandboxStore.resolve")(function* (familyId: FamilyId, channelId: ChannelId) {
      if (!Schema.is(SandboxIdentifier)(familyId) || !Schema.is(SandboxIdentifier)(channelId)) {
        return yield* new SandboxUnavailable({ message: "Family sandbox unavailable" });
      }
      const result = yield* find({ familyId, channelId }).pipe(Effect.orDie);
      if (Option.isNone(result)) return yield* new SandboxUnavailable({ message: "Family sandbox has not been provisioned" });
      return result.value;
    });
    return SandboxStore.of({ resolve });
  }));
}
