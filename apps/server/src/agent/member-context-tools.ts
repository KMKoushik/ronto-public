import type { AgentTool } from "@earendil-works/pi-agent-core";
import { ChannelId, FamilyMemberId } from "@ronto/api";
import { Context, Effect } from "effect";
import { Type } from "typebox";

import { RontoStore } from "../db/ronto-store.ts";

type ServiceContract<Service> =
  Service extends Context.Service<infer _Self, infer Contract> ? Contract : never;
type Store = ServiceContract<typeof RontoStore>;
const emptyParameters = Type.Object({});

export const createMemberContextTools = (
  store: Store,
  channelId: ChannelId,
  memberId: FamilyMemberId,
): Array<AgentTool> => {
  const authorize = Effect.gen(function* () {
    const channel = yield* store.findChannel(channelId, memberId);
    if (channel === null) return yield* Effect.fail(new Error("Channel unavailable"));
  });
  const familyTool: AgentTool<typeof emptyParameters> = {
    name: "list_family_members",
    label: "Family Members",
    description: "List registered family members with stable member IDs and names, and an exact count. Only use when the user asks about family membership or who someone is. This is not a WhatsApp group participant roster.",
    parameters: emptyParameters,
    execute: async (_id, _parameters, signal) => {
      const members = await Effect.runPromise(authorize.pipe(
        Effect.andThen(store.listFamilyMemberProfiles(memberId)),
      ), { signal });
      const result = { count: members.length, members };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  };
  const channelTool: AgentTool<typeof emptyParameters> = {
    name: "list_channel_members",
    label: "Channel Members",
    description: "List active registered members of the current channel with IDs, names, family roles and count. Only use when the user asks about channel membership. Unlinked WhatsApp participants are not registered channel members.",
    parameters: emptyParameters,
    execute: async (_id, _parameters, signal) => {
      const members = await Effect.runPromise(authorize.pipe(
        Effect.andThen(store.listChannelMembers(channelId, memberId)),
      ), { signal });
      const result = { channelId, count: members.length, members };
      return { content: [{ type: "text", text: JSON.stringify(result) }], details: result };
    },
  };
  return [familyTool, channelTool];
};
