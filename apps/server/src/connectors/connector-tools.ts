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

const textResult = (text: string) => ({
  content: [{ type: "text" as const, text }],
  details: {},
});

export const describeConnections = (
  connector: ConnectorService["Service"],
  memberId: FamilyMemberId,
) => Effect.gen(function* () {
  const connections = yield* connector.listConnections(memberId);
  const actions = yield* connector.listActions(memberId);
  return connections.map((connection) => ({
    id: connection.id,
    service: connection.service,
    actions: actions.filter((action) => action.connectionId === connection.id)
      .map((action) => ({ id: action.id, description: action.description })),
  }));
});

export const createConnectorTools = (
  connector: ConnectorService["Service"],
  approvals: ConnectorApprovals["Service"],
  memberId: FamilyMemberId,
  runId: AgentRunId,
  origin: "web" | "whatsapp",
  onActionResult: (result: ConnectorActionResult) => void,
  workspace: ChannelWorkspaceService,
  channelId: ChannelId,
): ReadonlyArray<AgentTool> => {
  if (!connector.enabled) return [];

  const listConnections: AgentTool<typeof NoParameters> = {
    name: "list_connections",
    label: "List Connections",
    description:
      "Refresh the current member's connected services and complete available action index. Connection IDs are Ronto-local references and may only be used with connector tools.",
    parameters: NoParameters,
    execute: async () =>
      textResult(
        JSON.stringify(await Effect.runPromise(
          describeConnections(connector, memberId),
        ), null, 2),
      ),
  };

  const searchActions: AgentTool<typeof SearchParameters> = {
    name: "search_actions",
    label: "Search Actions",
    description:
      "Search within the current member's connected services. Results are limited matches, not a complete capability list. Prefer the action index already in context; use list_connections for a complete refresh. Empty matches do not establish missing permissions.",
    parameters: SearchParameters,
    execute: async (_toolCallId, parameters) =>
      textResult(
        JSON.stringify(await Effect.runPromise(
          connector.searchActions(
            memberId,
            parameters.query,
            parameters.limit ?? 5,
          ).pipe(Effect.map((actions) => ({
            complete: false,
            limit: parameters.limit ?? 5,
            actions,
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
    execute: async (_toolCallId, parameters) =>
      textResult(
        JSON.stringify(await Effect.runPromise(
          connector.getAction(
            memberId,
            parameters.connectionId,
            parameters.actionId,
          ),
        ), null, 2),
      ),
  };

  const executeAction: AgentTool<typeof ExecuteParameters> = {
    name: "execute_action",
    label: "Execute Action",
    description:
      "Execute an allowed action through one of the current member's connections. Use get_action_guide first and match its schema. Start Gmail searches with gmail.fetch_emails, detail summary and maxResults 20; then fetch selected message IDs. Results include metadata, previews and local file references to complete readable bodies. Use read/grep for omitted text, not another identical fetch. Refresh Gmail for latest updates.",
    parameters: ExecuteParameters,
    execute: async (toolCallId, parameters) => {
      const suppliedInput = await Schema.decodeUnknownPromise(Schema.JsonObject)(
        parameters.input,
      );
      const input = parameters.actionId === "gmail.fetch_emails"
        ? { detail: "summary", maxResults: 20, ...suppliedInput }
        : suppliedInput;
      const result = await Effect.runPromise(
        approvals.request({
          runId,
          memberId,
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
            memberId,
            connectionId: parameters.connectionId,
            runId,
            actionId: parameters.actionId,
            input,
          }, result.output))
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
