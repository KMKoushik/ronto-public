import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentRunId, ChannelId, FamilyMemberId } from "@ronto/api";
import { Effect, Schema } from "effect";
import { Type } from "typebox";

import type { ConnectorService } from "./connector-service.ts";
import { storeConnectorResult } from "./connector-results.ts";
import type { ChannelWorkspaceService } from "../agent/channel-workspace.ts";
import type {
  ConnectorActionResult,
  ConnectorApprovals,
} from "./connector-approvals.ts";

const SearchParameters = Type.Object({
  query: Type.String({ minLength: 1 }),
  limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 10 })),
});
const GuideParameters = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  actionId: Type.String({ minLength: 3 }),
});
const ExecuteParameters = Type.Object({
  connectionId: Type.String({ minLength: 1 }),
  actionId: Type.String({ minLength: 3 }),
  input: Type.Object({}, { additionalProperties: true }),
});
const NoParameters = Type.Object({});

export interface ConnectorGrant {
  readonly memberId: FamilyMemberId;
  readonly memberName: string;
  readonly access: "owner" | "shared_read";
}

const sharedReadActions = new Set([
  "gmail.download_attachment",
  "gmail.fetch_emails",
  "gmail.fetch_message_by_message_id",
  "gmail.fetch_message_by_thread_id",
  "gmail.get_auto_forwarding",
  "gmail.get_draft",
  "gmail.get_filter",
  "gmail.get_label",
  "gmail.get_language_settings",
  "gmail.get_message",
  "gmail.get_profile",
  "gmail.get_vacation_settings",
  "gmail.list_drafts",
  "gmail.list_filters",
  "gmail.list_forwarding_addresses",
  "gmail.list_history",
  "gmail.list_labels",
  "gmail.list_threads",
  "gmail.search_threads",
  "gmail.settings_get_imap",
  "gmail.settings_get_pop",
  "googlecalendar.find_event",
  "googlecalendar.find_free_slots",
  "googlecalendar.free_busy_query",
  "googlecalendar.get_acl_rule",
  "googlecalendar.get_calendar",
  "googlecalendar.get_calendar_list_entry",
  "googlecalendar.get_colors",
  "googlecalendar.get_event",
  "googlecalendar.get_setting",
  "googlecalendar.list_acl",
  "googlecalendar.list_calendars",
  "googlecalendar.list_event_instances",
  "googlecalendar.list_events",
  "googlecalendar.list_events_all_calendars",
  "googlecalendar.list_settings",
  "googlecalendar.sync_events",
]);

const actionAllowed = (grant: ConnectorGrant, actionId: string): boolean =>
  grant.access === "owner" || sharedReadActions.has(actionId);

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export const describeConnections = (
  connector: ConnectorService["Service"],
  grants: ReadonlyArray<ConnectorGrant>,
) => Effect.gen(function* () {
  return (yield* Effect.forEach(grants, (grant) => Effect.gen(function* () {
    const connections = yield* connector.listConnections(grant.memberId);
    const actions = yield* connector.listActions(grant.memberId);
    return connections.map((connection) => ({
      id: connection.id,
      service: connection.service,
      owner: grant.memberName,
      access: grant.access,
      actions: actions.filter((action) =>
        action.connectionId === connection.id && actionAllowed(grant, action.id)
      ).map((action) => ({ id: action.id, description: action.description })),
    }));
  }), { concurrency: 4 })).flat();
});

export const createConnectorTools = (
  connector: ConnectorService["Service"],
  approvals: ConnectorApprovals["Service"],
  grants: ReadonlyArray<ConnectorGrant>,
  runId: AgentRunId,
  origin: "web" | "whatsapp",
  onActionResult: (result: ConnectorActionResult) => void,
  workspace: ChannelWorkspaceService,
  channelId: ChannelId,
): ReadonlyArray<AgentTool> => {
  if (!connector.enabled) return [];

  const resolveGrant = (connectionId: string) => Effect.gen(function* () {
    for (const grant of grants) {
      const connections = yield* connector.listConnections(grant.memberId);
      if (connections.some((connection) => connection.id === connectionId)) return grant;
    }
    return yield* Effect.die("Connector connection was not granted to this turn");
  });

  const listConnections: AgentTool<typeof NoParameters> = {
    name: "list_connections",
    label: "List Connections",
    description:
      "Refresh the connected services available to this speaker and complete available action index. Primary speakers may receive read-only access to another primary's account. Connection IDs are Ronto-local references and may only be used with connector tools.",
    parameters: NoParameters,
    execute: async () =>
      textResult(
        JSON.stringify(await Effect.runPromise(
          describeConnections(connector, grants),
        ), null, 2),
      ),
  };

  const searchActions: AgentTool<typeof SearchParameters> = {
    name: "search_actions",
    label: "Search Actions",
    description:
      "Search within the connected services available to this speaker. Results are limited matches, not a complete capability list. Prefer the action index already in context; use list_connections for a complete refresh. Empty matches do not establish missing permissions.",
    parameters: SearchParameters,
    execute: async (_toolCallId, parameters) =>
      textResult(
        JSON.stringify(await Effect.runPromise(
          Effect.forEach(grants, (grant) =>
            connector.searchActions(
              grant.memberId,
              parameters.query,
              parameters.limit ?? 5,
            ).pipe(Effect.map((actions) => actions
              .filter((action) => actionAllowed(grant, action.id))
              .map((action) => ({ ...action, owner: grant.memberName, access: grant.access })))),
          { concurrency: 4 }).pipe(Effect.map((matches) => ({
            complete: false,
            limit: parameters.limit ?? 5,
            actions: matches.flat().slice(0, parameters.limit ?? 5),
          }))),
        ), null, 2),
      ),
  };

  const getActionGuide: AgentTool<typeof GuideParameters> = {
    name: "get_action_guide",
    label: "Get Action Guide",
    description:
      "Get the description and input schema for one available connector action before executing it.",
    parameters: GuideParameters,
    execute: async (_toolCallId, parameters) => {
      const action = await Effect.runPromise(Effect.gen(function* () {
        const grant = yield* resolveGrant(parameters.connectionId);
        if (!actionAllowed(grant, parameters.actionId)) {
          return yield* Effect.die("Shared connector access is read-only");
        }
        return {
          ...(yield* connector.getAction(
            grant.memberId,
            parameters.connectionId,
            parameters.actionId,
          )),
          owner: grant.memberName,
          access: grant.access,
        };
      }));
      return textResult(JSON.stringify(action, null, 2));
    },
  };

  const executeAction: AgentTool<typeof ExecuteParameters> = {
    name: "execute_action",
    label: "Execute Action",
    description:
      "Execute an allowed action through one of the current member's connections. Use get_action_guide first and match its schema. Start Gmail searches with gmail.fetch_emails, detail summary and maxResults 20; then fetch selected message IDs. For requested Gmail attachment bytes, execute gmail.download_attachment with the selected messageId and attachmentId; Ronto imports the connector transit file and returns a local workspace path without placing file bytes in model context. Results include metadata, previews and local file references to complete readable bodies. Use read/grep for omitted text, not another identical fetch. Refresh Gmail for latest updates.",
    parameters: ExecuteParameters,
    execute: async (toolCallId, parameters) => {
      const grant = await Effect.runPromise(resolveGrant(parameters.connectionId));
      if (!actionAllowed(grant, parameters.actionId)) {
        throw new Error("Shared connector access is read-only");
      }
      const suppliedInput = await Schema.decodeUnknownPromise(Schema.JsonObject)(
        parameters.input,
      );
      const input = parameters.actionId === "gmail.fetch_emails"
        ? { detail: "summary", maxResults: 20, ...suppliedInput }
        : suppliedInput;
      const result = await Effect.runPromise(
        approvals.request({
          runId,
          memberId: grant.memberId,
          connectionId: parameters.connectionId,
          actionId: parameters.actionId,
          input,
          idempotencyKey: toolCallId,
          origin,
        }),
      );
      onActionResult(result);
      return textResult(result.kind === "executed"
          ? await Effect.runPromise(storeConnectorResult(workspace, channelId, {
            memberId: grant.memberId,
            connectionId: parameters.connectionId,
            runId,
            actionId: parameters.actionId,
            input,
          }, result.output, {
            read: (fileId, maxBytes) => Effect.runPromise(connector.readTransitFile(fileId, maxBytes)),
            delete: (fileId) => Effect.runPromise(connector.deleteTransitFile(fileId)),
          }))
        : JSON.stringify({
              approvalRequired: true,
              approvalId: result.approval.id,
              title: result.approval.title,
              description: result.approval.description,
            }));
    },
  };

  return [listConnections, searchActions, getActionGuide, executeAction];
};
