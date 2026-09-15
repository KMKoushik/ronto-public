import {
  AgentFailure,
  AgentRunDto,
  AuthenticatedUser,
  ChannelFileDto,
  Conflict,
  ConnectorAuthorizationDto,
  ConnectorApprovalDto,
  ConnectorDto,
  ConnectorProviderDto,
  ChannelDto,
  ChannelMemoryDto,
  ConversationId,
  ConversationDto,
  FamilyMemoryDto,
  FamilyInviteDto,
  FamilyDto,
  FamilyId,
  FamilyMembershipDto,
  PlatformInvitationDto,
  PlatformFamilyDto,
  FamilyMemberProfileDto,
  FamilyMemberSummaryDto,
  MeDto,
  MemberDto,
  MessageDto,
  NotFound,
  RontoApi,
  FileId,
  WhatsappBindingDto,
  WhatsappClaimDto,
  WhatsappHealthDto,
  WhatsappIdentityDto,
  WhatsappDmFamilyDto,
  WhatsappPairingCodeDto,
} from "@ronto/api";
import { DateTime, Effect, Fiber, Layer } from "effect";
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi";
import { SqlClient } from "effect/unstable/sql";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { AgentInvocationError, AgentService } from "../agent/agent-service.ts";
import { BrowserService } from "../agent/browser-service.ts";
import {
  ChannelWorkspace,
  ChannelWorkspaceError,
} from "../agent/channel-workspace.ts";
import { FamilySandbox } from "../sandbox/family-sandbox.ts";
import { sandboxLimits } from "../sandbox/sandbox-config.ts";
import type {
  AgentRun,
  Channel,
  ChannelFile,
  FamilyMember,
  Message,
} from "../db/models.ts";
import {
  RontoStore,
  type ConversationSummary,
  type FamilyMembership,
  type FamilyMemberSummary,
} from "../db/ronto-store.ts";
import { AuthorizationLive } from "./authorization.ts";
import { ConversationTurn } from "./conversation-turn.ts";
import { cancelActiveTurn, hasActiveTurn } from "./active-turns.ts";
import { WhatsappAdapterLive } from "../whatsapp/whatsapp-adapter.ts";
import { SessionSummaryWorkerLive } from "../agent/session-summary-worker.ts";
import { WhatsappAuth } from "../whatsapp/whatsapp-auth-state.ts";
import {
  WhatsappClient,
  WhatsappClientError,
} from "../whatsapp/whatsapp-client.ts";
import { WhatsappStore } from "../whatsapp/whatsapp-store.ts";
import { ConnectorService } from "../connectors/connector-service.ts";
import { ConnectorStore } from "../connectors/connector-store.ts";
import {
  ConnectorManagement,
  type ManagedConnector,
} from "../connectors/connector-management.ts";
import type { ConnectorServiceError } from "../connectors/connector-service.ts";
import {
  ConnectorApprovals,
  ConnectorApprovalError,
} from "../connectors/connector-approvals.ts";
import {
  ConnectorApprovalStore,
  type ConnectorApproval,
} from "../connectors/connector-approval-store.ts";
import { FamilyAccess } from "./family-access.ts";
import { PlatformStore } from "../platform/platform-store.ts";

const memberDto = (member: FamilyMember): MemberDto =>
  new MemberDto({
    id: member.id,
    familyId: member.familyId,
    userId: member.userId,
    role: member.role,
    joinedAt: member.joinedAt,
  });
const familyMembershipDto = (
  membership: FamilyMembership,
): FamilyMembershipDto =>
  new FamilyMembershipDto({
    family: new FamilyDto(membership.family),
    member: memberDto(membership.member),
  });

const conversationDto = (conversation: ConversationSummary): ConversationDto =>
  new ConversationDto(conversation);
const channelDto = (channel: Channel): ChannelDto => new ChannelDto(channel);
const familyMemberSummaryDto = (
  member: FamilyMemberSummary,
): FamilyMemberSummaryDto => new FamilyMemberSummaryDto(member);
const channelFileDto = (file: ChannelFile): ChannelFileDto =>
  new ChannelFileDto({
    id: file.id,
    channelId: file.channelId,
    originatingConversationId: file.originatingConversationId,
    originatingMessageId: file.originatingMessageId,
    originatingRunId: file.originatingRunId,
    createdByMemberId: file.createdByMemberId,
    kind: file.kind,
    name: file.name,
    mediaType: file.mediaType,
    byteSize: file.byteSize,
    checksum: file.checksum,
    createdAt: file.createdAt,
  });
const connectorDto = (connector: ManagedConnector): ConnectorDto =>
  new ConnectorDto(connector);
const connectorApprovalDto = (
  approval: ConnectorApproval,
  status: ConnectorApprovalDto["status"] = approval.approvalStatus === "rejected"
    ? "rejected"
    : approval.approvalStatus === "pending"
      ? approval.toolStatus === "cancelled" ? "expired" : "pending"
      : approval.executionStatus === "pending" ||
          approval.executionStatus === "running"
        ? "approved"
        : approval.executionStatus,
): ConnectorApprovalDto =>
  new ConnectorApprovalDto({
    id: approval.id,
    conversationId: ConversationId.make(approval.conversationId),
    actionId: approval.actionId,
    title: approval.title,
    description: approval.description,
    status,
    expiresAt: approval.expiresAt,
  });

const connectorApiError = (error: ConnectorServiceError) => {
  if (error.reason === "not_found") {
    return new NotFound({ message: error.message });
  }
  if (
    error.reason === "disabled" ||
    error.reason === "not_configured" ||
    error.reason === "not_allowed"
  ) {
    return new Conflict({ message: error.message });
  }
  return new AgentFailure({ message: error.message });
};
const connectorApprovalApiError = (error: ConnectorApprovalError) =>
  error.reason === "not_found"
    ? new NotFound({ message: error.message })
    : new AgentFailure({ message: error.message });

export const messageDto = (message: Message): MessageDto =>
  new MessageDto({
    id: message.id,
    conversationId: message.conversationId,
    sequence: message.sequence,
    senderType: message.externalSenderId === null
      ? message.senderType
      : "external",
    senderMemberId: message.externalSenderId === null
      ? message.senderMemberId
      : null,
    externalSenderId: message.externalSenderId,
    externalSenderName: message.externalSenderName,
    replyToMessageId: message.replyToMessageId,
    content: message.contentJson,
    createdAt: message.createdAt,
  });

export const agentRunDto = (run: AgentRun): AgentRunDto =>
  new AgentRunDto({
    id: run.id,
    conversationId: run.conversationId,
    triggerMessageId: run.triggerMessageId,
    status: run.status,
    modelProvider: run.modelProvider,
    modelId: run.modelId,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
  });

export const RontoApiHandlersNoDeps = HttpApiBuilder.group(
  RontoApi,
  "ronto",
  Effect.fn(function* (handlers) {
    const store = yield* RontoStore;
    const channelWorkspace = yield* ChannelWorkspace;
    const conversationTurn = yield* ConversationTurn;
    const whatsapp = yield* WhatsappClient;
    const whatsappStore = yield* WhatsappStore;
    const connectorManagement = yield* ConnectorManagement;
    const connectorApprovals = yield* ConnectorApprovals;
    const familyAccess = yield* FamilyAccess;
    const platform = yield* PlatformStore;
    const meDto = Effect.fn("RontoApi.meDto")(function* () {
      const user = yield* AuthenticatedUser;
      const memberships = yield* store.listMembershipsByUser(user.id).pipe(Effect.orDie);
      const grant = yield* platform.findCreationGrant(user.id).pipe(Effect.orDie);
      return new MeDto({
        user,
        memberships: memberships.map(familyMembershipDto),
        isPlatformAdministrator: yield* platform.isAdministrator(user.id).pipe(Effect.orDie),
        canCreateFamily: grant?.status === "granted",
      });
    });

    const currentMember = Effect.fn("RontoApi.currentMember")(function* (
      familyId: FamilyId,
    ) {
      const user = yield* AuthenticatedUser;
      return yield* familyAccess.resolveMember(user.id, familyId);
    });

    const serveFile = Effect.fn("RontoApi.serveFile")(function* (
      familyId: FamilyId,
      fileId: FileId,
      disposition: "attachment" | "inline",
    ) {
      const member = yield* currentMember(familyId);
      const file = yield* store.findFile(fileId, member.id).pipe(Effect.orDie);
      if (file === null)
        return yield* new NotFound({ message: "File not found" });
      const content = yield* channelWorkspace
        .readManaged(file.channelId, file.storagePath)
        .pipe(Effect.orDie);
      const safelyViewable =
        file.mediaType === "application/pdf" ||
        file.mediaType === "application/json" ||
        file.mediaType === "text/plain" ||
        file.mediaType === "text/csv" ||
        file.mediaType === "text/markdown" ||
        (file.mediaType.startsWith("image/") &&
          file.mediaType !== "image/svg+xml") ||
        file.mediaType.startsWith("audio/") ||
        file.mediaType.startsWith("video/");
      return HttpApiSchema.withHeaders({
        body: content,
        headers: {
          "content-disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          "content-type":
            disposition === "inline" && !safelyViewable
              ? "application/octet-stream"
              : file.mediaType,
          "x-content-type-options": "nosniff",
          "cache-control": "private, no-store",
        },
      });
    });
    const currentPrimary = Effect.fn("RontoApi.currentPrimary")(function* (
      familyId: FamilyId,
    ) {
      const user = yield* AuthenticatedUser;
      return yield* familyAccess.resolvePrimary(user.id, familyId);
    });

    return handlers.handleAll({
      listPlatformFamilies: Effect.fn("RontoApi.listPlatformFamilies")(function* () {
        const user = yield* AuthenticatedUser;
        const families = yield* platform.listFamilies(user.id).pipe(
          Effect.catchTag(["SqlError", "SchemaError"], Effect.die),
          Effect.catchTag("AdmissionDenied", (error) => new NotFound({ message: error.message })),
        );
        return yield* Effect.forEach(families, (family) =>
          channelWorkspace.familyUsage(family.id).pipe(
            Effect.map((usage) => new PlatformFamilyDto({
              ...family,
              durableStorageBytes: usage.bytes,
              sandboxStatus: !family.sandboxProvisioned
                ? "unprovisioned" as const
                : usage.device === family.sandboxDirectoryDevice &&
                    usage.inode === family.sandboxDirectoryInode
                  ? "ready" as const
                  : "unhealthy" as const,
              limits: {
                cpus: sandboxLimits.cpus,
                memoryBytes: sandboxLimits.memoryBytes,
                pids: sandboxLimits.pids,
                commandSeconds: sandboxLimits.commandSeconds,
                storageBytes: sandboxLimits.storageKiB * 1024,
                temporaryBytes: sandboxLimits.tmpBytes,
                outputBytes: sandboxLimits.outputBytes,
              },
            })),
            Effect.orDie,
          ),
        );
      }),
      createPlatformInvitation: Effect.fn("RontoApi.createPlatformInvitation")(function* () {
        const user = yield* AuthenticatedUser;
        const result = yield* platform.createInvitation(user.id).pipe(
          Effect.catchTag(["SqlError", "SchemaError"], Effect.die),
          Effect.catchTag("AdmissionDenied", (error) => new NotFound({ message: error.message })),
        );
        return { token: result.token, invitation: new PlatformInvitationDto(result.invitation) };
      }),
      listPlatformInvitations: Effect.fn("RontoApi.listPlatformInvitations")(function* () {
        const user = yield* AuthenticatedUser;
        return (yield* platform.listInvitations(user.id).pipe(
          Effect.catchTag(["SqlError", "SchemaError"], Effect.die),
          Effect.catchTag("AdmissionDenied", (error) => new NotFound({ message: error.message })),
        )).map((invite) => new PlatformInvitationDto(invite));
      }),
      revokePlatformInvitation: Effect.fn("RontoApi.revokePlatformInvitation")(function* ({ params }) {
        const user = yield* AuthenticatedUser;
        yield* platform.revokeInvitation(user.id, params.id).pipe(
          Effect.catchTag(["SqlError", "SchemaError"], Effect.die),
          Effect.catchTag("AdmissionDenied", (error) => new NotFound({ message: error.message })),
        );
      }),
      redeemPlatformInvitation: Effect.fn("RontoApi.redeemPlatformInvitation")(function* ({ payload }) {
        const user = yield* AuthenticatedUser;
        yield* platform.redeemInvitation(user.id, payload.token).pipe(
          Effect.catchTag(["SqlError", "SchemaError"], Effect.die),
          Effect.catchTag("AdmissionDenied", (error) => new NotFound({ message: error.message })),
        );
        return yield* meDto();
      }),
      me: Effect.fn("RontoApi.me")(function* () {
        return yield* meDto();
      }),
      onboard: Effect.fn("RontoApi.onboard")(function* ({ payload }) {
        const user = yield* AuthenticatedUser;
        const grant = yield* platform.findCreationGrant(user.id).pipe(Effect.orDie);
        if (grant?.status !== "granted") return yield* new Conflict({ message: "A family creation invitation is required" });
        yield* store
          .createFamily(payload.familyName, user.id)
          .pipe(
            Effect.catch((error) => error._tag === "NoSuchElementError"
              ? new Conflict({ message: "Family creation permission unavailable" })
              : error._tag === "FamilyCapacityUnavailable"
                ? new Conflict({ message: error.message })
                : Effect.die(error)),
          );
        return yield* meDto();
      }),
      listFamilyMembers: Effect.fn("RontoApi.listFamilyMembers")(function* ({ params }) {
        const member = yield* currentPrimary(params.familyId);
        return (yield* store
          .listFamilyMembers(member.id)
          .pipe(Effect.orDie)).map(familyMemberSummaryDto);
      }),
      listFamilyMemberProfiles: Effect.fn("RontoApi.listFamilyMemberProfiles")(
        function* ({ params }) {
          const member = yield* currentMember(params.familyId);
          return (yield* store
            .listFamilyMemberProfiles(member.id)
            .pipe(Effect.orDie)).map(
            (profile) => new FamilyMemberProfileDto(profile),
          );
        },
      ),
      createFamilyInvite: Effect.fn("RontoApi.createFamilyInvite")(function* ({
        params,
        payload,
      }) {
        const primary = yield* currentPrimary(params.familyId);
        const token = randomBytes(24).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = DateTime.add(yield* DateTime.now, { days: 7 });
        yield* store
          .createFamilyInvite(
            primary.id,
            randomUUID(),
            payload.role,
            tokenHash,
            expiresAt,
          )
          .pipe(Effect.orDie);
        return new FamilyInviteDto({ token, role: payload.role, expiresAt });
      }),
      redeemFamilyInvite: Effect.fn("RontoApi.redeemFamilyInvite")(function* ({
        payload,
      }) {
        const user = yield* AuthenticatedUser;
        const tokenHash = createHash("sha256")
          .update(payload.token)
          .digest("hex");
        yield* store
          .redeemFamilyInvite(user.id, tokenHash)
          .pipe(
            Effect.catch((error) =>
              error._tag === "NoSuchElementError"
                ? new NotFound({
                    message:
                      "This invitation is invalid, expired, or already used",
                  })
                : Effect.die(error),
            ),
          );
        return yield* meDto();
      }),
      getFamilyMemory: Effect.fn("RontoApi.getFamilyMemory")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        const memory = yield* channelWorkspace
          .readFamilyMemory(member.familyId)
          .pipe(Effect.orDie);
        return new FamilyMemoryDto({ familyId: member.familyId, ...memory });
      }),
      updateFamilyMemory: Effect.fn("RontoApi.updateFamilyMemory")(
        function* ({ params, payload }) {
          const member = yield* currentMember(params.familyId);
          const memory = yield* channelWorkspace
            .writeFamilyMemory(
              member.familyId,
              payload.content,
              payload.revision,
            )
            .pipe(
              Effect.catchTag(
                "ChannelWorkspaceError",
                (error: ChannelWorkspaceError) =>
                  error.kind === "io"
                    ? Effect.die(error)
                    : Effect.fail(new Conflict({ message: error.message })),
              ),
            );
          return new FamilyMemoryDto({ familyId: member.familyId, ...memory });
        },
      ),
      getWhatsappHealth: Effect.fn("RontoApi.getWhatsappHealth")(function* ({ params }) {
        yield* currentMember(params.familyId);
        return new WhatsappHealthDto({ status: yield* whatsapp.status });
      }),
      requestWhatsappPairingCode: Effect.fn(
        "RontoApi.requestWhatsappPairingCode",
      )(function* ({ payload }) {
        const user = yield* AuthenticatedUser;
        if (!(yield* platform.isAdministrator(user.id).pipe(Effect.orDie))) {
          return yield* new NotFound({ message: "Platform access not found" });
        }
        const code = yield* whatsapp
          .requestPairingCode(payload.phoneNumber)
          .pipe(
            Effect.catchTag(
              "WhatsappClientError",
              (error: WhatsappClientError) =>
                new Conflict({ message: error.message }),
            ),
          );
        return new WhatsappPairingCodeDto({ code });
      }),
      getPlatformWhatsappHealth: Effect.fn("RontoApi.getPlatformWhatsappHealth")(function* () {
        const user = yield* AuthenticatedUser;
        if (!(yield* platform.isAdministrator(user.id).pipe(Effect.orDie))) {
          return yield* new NotFound({ message: "Platform access not found" });
        }
        return new WhatsappHealthDto({ status: yield* whatsapp.status });
      }),
      createWhatsappIdentityClaim: Effect.fn(
        "RontoApi.createWhatsappIdentityClaim",
      )(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        const token = randomBytes(24).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = DateTime.add(yield* DateTime.now, { minutes: 15 });
        yield* whatsappStore
          .createIdentityClaim(
            member.id,
            randomUUID(),
            member.id,
            tokenHash,
            expiresAt,
          )
          .pipe(Effect.orDie);
        return new WhatsappClaimDto({ token, expiresAt });
      }),
      listWhatsappIdentities: Effect.fn(
        "RontoApi.listWhatsappIdentities",
      )(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        return (yield* whatsappStore
          .listIdentities(member.id)
          .pipe(Effect.orDie)).map(
          (identity) => new WhatsappIdentityDto(identity),
        );
      }),
      listWhatsappDmFamilies: Effect.fn(
        "RontoApi.listWhatsappDmFamilies",
      )(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        return (yield* whatsappStore.listMemberDmFamilies(member.id).pipe(
          Effect.orDie,
        )).map((family) => new WhatsappDmFamilyDto(family));
      }),
      selectWhatsappDmFamily: Effect.fn(
        "RontoApi.selectWhatsappDmFamily",
      )(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        return new WhatsappDmFamilyDto(
          yield* whatsappStore.selectDmFamily(member.id).pipe(Effect.orDie),
        );
      }),
      revokeWhatsappIdentity: Effect.fn(
        "RontoApi.revokeWhatsappIdentity",
      )(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        yield* whatsappStore
          .revokeIdentity(member.id, params.identityId)
          .pipe(Effect.orDie);
      }),
      createWhatsappBindingClaim: Effect.fn(
        "RontoApi.createWhatsappBindingClaim",
      )(function* ({ params }) {
        const primary = yield* currentPrimary(params.familyId);
        const conversation = yield* store
          .findConversation(params.conversationId, primary.id)
          .pipe(Effect.orDie);
        if (conversation === null) {
          return yield* new NotFound({ message: "Conversation not found" });
        }
        const token = randomBytes(24).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = DateTime.add(yield* DateTime.now, { minutes: 15 });
        yield* whatsappStore
          .createBindingClaim(
            primary.id,
            randomUUID(),
            conversation.id,
            tokenHash,
            expiresAt,
          )
          .pipe(Effect.orDie);
        return new WhatsappClaimDto({ token, expiresAt });
      }),
      listWhatsappBindings: Effect.fn(
        "RontoApi.listWhatsappBindings",
      )(function* ({ params }) {
        const primary = yield* currentPrimary(params.familyId);
        const conversation = yield* store
          .findConversation(params.conversationId, primary.id)
          .pipe(Effect.orDie);
        if (conversation === null) {
          return yield* new NotFound({ message: "Conversation not found" });
        }
        return (yield* whatsappStore
          .listBindings(primary.id, params.conversationId)
          .pipe(Effect.orDie)).map(
          (binding) =>
            new WhatsappBindingDto({
              ...binding,
              conversationId: ConversationId.make(binding.conversationId),
            }),
        );
      }),
      removeWhatsappBinding: Effect.fn(
        "RontoApi.removeWhatsappBinding",
      )(function* ({ params }) {
        const primary = yield* currentPrimary(params.familyId);
        const conversation = yield* store
          .findConversation(params.conversationId, primary.id)
          .pipe(Effect.orDie);
        if (conversation === null) {
          return yield* new NotFound({ message: "Conversation not found" });
        }
        const removed = yield* whatsappStore
          .removeBinding(
            primary.id,
            params.conversationId,
            params.bindingId,
          )
          .pipe(Effect.orDie);
        if (!removed) {
          return yield* new NotFound({ message: "WhatsApp binding not found" });
        }
      }),
      listConversations: Effect.fn("RontoApi.listConversations")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        const conversations = yield* store
          .listConversations(member.id)
          .pipe(Effect.orDie);
        return conversations.map(conversationDto);
      }),
      listChannels: Effect.fn("RontoApi.listChannels")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        return (yield* store.listChannels(member.id).pipe(Effect.orDie)).map(
          channelDto,
        );
      }),
      createChannel: Effect.fn("RontoApi.createChannel")(function* ({
        params,
        payload,
      }) {
        const member = yield* currentMember(params.familyId);
        const channel = yield* store
          .createChannel(
            member.familyId,
            member.id,
            payload.name,
            payload.purpose,
          )
          .pipe(
            Effect.catchTag(
              "NoSuchElementError",
              () => new NotFound({ message: "Family member not found" }),
            ),
            Effect.orDie,
          );
        return channelDto(channel);
      }),
      setChannelMemberAccess: Effect.fn("RontoApi.setChannelMemberAccess")(
        function* ({ params, payload }) {
          const primary = yield* currentPrimary(params.familyId);
          const members = yield* store
            .listFamilyMembers(primary.id)
            .pipe(Effect.orDie);
          const target = members.find(({ id }) => id === params.memberId);
          const channel = (yield* store
            .listChannels(primary.id)
            .pipe(Effect.orDie)).find(({ id }) => id === params.channelId);
          if (target === undefined || channel === undefined) {
            return yield* new NotFound({ message: "Family member or channel not found" });
          }
          if (!payload.active && (target.role === "primary" || channel.isDefault)) {
            return yield* new Conflict({
              message:
                target.role === "primary"
                  ? "Primary family members have access to every channel"
                  : "Every family member has access to General",
            });
          }
          yield* store
            .setChannelMemberAccess(
              primary.id,
              channel.id,
              target.id,
              payload.active,
            )
            .pipe(Effect.orDie);
          const updated = (yield* store
            .listFamilyMembers(primary.id)
            .pipe(Effect.orDie)).find(({ id }) => id === target.id);
          if (updated === undefined)
            return yield* Effect.die("Updated family member could not be read");
          return familyMemberSummaryDto(updated);
        },
      ),
      listConnectors: Effect.fn("RontoApi.listConnectors")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        return (yield* connectorManagement.list(member.id).pipe(
          Effect.mapError(connectorApiError),
        )).map(connectorDto);
      }),
      listConnectorProviders: Effect.fn(
        "RontoApi.listConnectorProviders",
      )(function* ({ params }) {
        yield* currentMember(params.familyId);
        return (yield* connectorManagement.listProviders().pipe(
          Effect.mapError(connectorApiError),
        )).map((provider) => new ConnectorProviderDto(provider));
      }),
      startConnectorOAuth: Effect.fn("RontoApi.startConnectorOAuth")(
        function* ({ params, payload }) {
          const member = yield* currentMember(params.familyId);
          const authorization = yield* connectorManagement
            .startOAuth(member.id, payload.service, payload.requestedScopes)
            .pipe(Effect.mapError(connectorApiError));
          return new ConnectorAuthorizationDto({
            connection: connectorDto(authorization.connection),
            authorizationUrl: authorization.authorizationUrl,
          });
        },
      ),
      reconcileConnector: Effect.fn("RontoApi.reconcileConnector")(
        function* ({ params }) {
          const member = yield* currentMember(params.familyId);
          return connectorDto(
            yield* connectorManagement
              .reconcile(member.id, params.connectionId)
              .pipe(Effect.mapError(connectorApiError)),
          );
        },
      ),
      disconnectConnector: Effect.fn("RontoApi.disconnectConnector")(
        function* ({ params }) {
          const member = yield* currentMember(params.familyId);
          yield* connectorManagement
            .disconnect(member.id, params.connectionId)
            .pipe(Effect.mapError(connectorApiError));
        },
      ),
      listConnectorApprovals: Effect.fn("RontoApi.listConnectorApprovals")(
        function* ({ params }) {
          const member = yield* currentMember(params.familyId);
          return (yield* connectorApprovals.list(member.id).pipe(
            Effect.mapError(connectorApprovalApiError),
          )).map((approval) => connectorApprovalDto(approval));
        },
      ),
      decideConnectorApproval: Effect.fn(
        "RontoApi.decideConnectorApproval",
      )(function* ({ params, payload }) {
        const member = yield* currentMember(params.familyId);
        const resolution = yield* connectorApprovals
          .resolve(member.id, params.approvalId, payload.decision)
          .pipe(Effect.mapError(connectorApprovalApiError));
        return connectorApprovalDto(
          resolution.approval,
          resolution.outcome === "running"
            ? "approved"
            : resolution.outcome,
        );
      }),
      getChannelMemory: Effect.fn("RontoApi.getChannelMemory")(function* ({
        params,
      }) {
        const member = yield* currentMember(params.familyId);
        const channel = yield* store
          .findChannel(params.channelId, member.id)
          .pipe(Effect.orDie);
        if (channel === null) {
          return yield* new NotFound({ message: "Channel not found" });
        }
        const memory = yield* channelWorkspace
          .readMemory(channel.id)
          .pipe(Effect.orDie);
        return new ChannelMemoryDto({ channelId: channel.id, ...memory });
      }),
      updateChannelMemory: Effect.fn("RontoApi.updateChannelMemory")(
        function* ({ params, payload }) {
          const member = yield* currentMember(params.familyId);
          const channel = yield* store
            .findChannel(params.channelId, member.id)
            .pipe(Effect.orDie);
          if (channel === null) {
            return yield* new NotFound({ message: "Channel not found" });
          }
          const memory = yield* channelWorkspace
            .writeMemory(channel.id, payload.content, payload.revision)
            .pipe(
              Effect.catchTag(
                "ChannelWorkspaceError",
                (error: ChannelWorkspaceError) =>
                  error.kind === "io"
                    ? Effect.die(error)
                    : Effect.fail(new Conflict({ message: error.message })),
              ),
            );
          return new ChannelMemoryDto({ channelId: channel.id, ...memory });
        },
      ),
      listChannelFiles: Effect.fn("RontoApi.listChannelFiles")(function* ({
        params,
      }) {
        const member = yield* currentMember(params.familyId);
        const channel = yield* store
          .findChannel(params.channelId, member.id)
          .pipe(Effect.orDie);
        if (channel === null)
          return yield* new NotFound({ message: "Channel not found" });
        return (yield* store
          .listChannelFiles(channel.id, member.id)
          .pipe(Effect.orDie)).map(channelFileDto);
      }),
      uploadConversationFile: Effect.fn("RontoApi.uploadConversationFile")(
        function* ({ params, payload }) {
          const member = yield* currentMember(params.familyId);
          const conversation = yield* store
            .findConversation(params.conversationId, member.id)
            .pipe(Effect.orDie);
          if (conversation === null)
            return yield* new NotFound({ message: "Conversation not found" });

          const content = yield* Effect.tryPromise(() =>
            readFile(payload.file.path),
          ).pipe(Effect.orDie);
          const file = yield* store
            .createConversationFile({
              fileId: FileId.make(randomUUID()),
              conversationId: conversation.id,
              memberId: member.id,
              messageId: null,
              runId: null,
              kind: "upload",
              name: payload.file.name || "file",
              mediaType: payload.file.contentType || "application/octet-stream",
              byteSize: content.byteLength,
              checksum: createHash("sha256").update(content).digest("hex"),
            })
            .pipe(Effect.orDie);
          yield* channelWorkspace
            .writeManaged(file.channelId, file.storagePath, content)
            .pipe(
              Effect.catch((error) =>
                store
                  .deleteFile(file.id, member.id)
                  .pipe(Effect.orDie, Effect.andThen(Effect.die(error))),
              ),
            );
          return channelFileDto(file);
        },
      ),
      downloadFile: Effect.fn("RontoApi.downloadFile")(({ params }) =>
        serveFile(params.familyId, params.fileId, "attachment"),
      ),
      viewFile: Effect.fn("RontoApi.viewFile")(({ params }) =>
        serveFile(params.familyId, params.fileId, "inline"),
      ),
      deleteFile: Effect.fn("RontoApi.deleteFile")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        const file = yield* store
          .findFile(params.fileId, member.id)
          .pipe(Effect.orDie);
        if (file === null)
          return yield* new NotFound({ message: "File not found" });
        yield* channelWorkspace
          .deleteManaged(file.channelId, file.storagePath)
          .pipe(Effect.orDie);
        const deleted = yield* store
          .deleteFile(file.id, member.id)
          .pipe(Effect.orDie);
        if (deleted === null)
          return yield* new NotFound({ message: "File not found" });
      }),
      createConversation: Effect.fn("RontoApi.createConversation")(function* ({
        params,
        payload,
      }) {
        const member = yield* currentMember(params.familyId);
        const conversation = yield* store
          .createConversation(params.channelId, member.id, payload.title)
          .pipe(
            Effect.catch((error) => error._tag === "NoSuchElementError"
              ? new NotFound({ message: "Channel not found" })
              : Effect.die(error)),
          );
        const summary = yield* store
          .findConversation(conversation.id, member.id)
          .pipe(Effect.orDie);
        if (summary === null) {
          return yield* Effect.die("Created conversation could not be read");
        }
        return conversationDto(summary);
      }),
      deleteConversation: Effect.fn("RontoApi.deleteConversation")(function* ({
        params,
      }) {
        const member = yield* currentMember(params.familyId);
        const activeRun = yield* store
          .findActiveAgentRun(params.id, member.id)
          .pipe(Effect.orDie);
        if (activeRun !== null) {
          if (hasActiveTurn(params.id))
            return yield* new Conflict({
              message: "Stop the active response before deleting this session",
            });
          yield* store.cancelAgentRun(activeRun.id).pipe(Effect.orDie);
        }
        const deleted = yield* store
          .deleteConversation(params.id, member.id)
          .pipe(Effect.orDie);
        if (!deleted)
          return yield* new NotFound({ message: "Conversation not found" });
      }),
      listMessages: Effect.fn("RontoApi.listMessages")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        const conversation = yield* store
          .findConversation(params.id, member.id)
          .pipe(Effect.orDie);
        if (conversation === null) {
          return yield* new NotFound({ message: "Conversation not found" });
        }
        const messages = yield* store
          .listMessagesForMember(params.id, member.id)
          .pipe(Effect.orDie);
        return messages.map(messageDto);
      }),
      getActiveRun: Effect.fn("RontoApi.getActiveRun")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        const conversation = yield* store
          .findConversation(params.id, member.id)
          .pipe(Effect.orDie);
        if (conversation === null)
          return yield* new NotFound({ message: "Conversation not found" });
        const run = yield* store
          .findActiveAgentRun(params.id, member.id)
          .pipe(Effect.orDie);
        return run === null ? null : agentRunDto(run);
      }),
      cancelActiveRun: Effect.fn("RontoApi.cancelActiveRun")(function* ({ params }) {
        const member = yield* currentMember(params.familyId);
        const conversation = yield* store
          .findConversation(params.id, member.id)
          .pipe(Effect.orDie);
        if (conversation === null)
          return yield* new NotFound({ message: "Conversation not found" });
        const activeRun = yield* store
          .findActiveAgentRun(params.id, member.id)
          .pipe(Effect.orDie);
        if (activeRun === null) return;
        let fiber = cancelActiveTurn(params.id);
        for (let attempt = 0; fiber === undefined && attempt < 20; attempt += 1) {
          yield* Effect.sleep(10);
          fiber = cancelActiveTurn(params.id);
        }
        if (fiber === undefined) {
          yield* store.cancelAgentRun(activeRun.id).pipe(Effect.orDie);
          return;
        }
        if (fiber !== undefined) yield* Fiber.await(fiber);
      }),
      sendMessage: Effect.fn("RontoApi.sendMessage")(function* ({
        params,
        payload,
      }) {
        const member = yield* currentMember(params.familyId);
        const turn = yield* conversationTurn.run(member.id, params.id, payload).pipe(
          Effect.catchTag(
            "ConversationTurnNotFound",
            (error) => new NotFound({ message: error.message }),
          ),
          Effect.catchTag(
            "AgentInvocationError",
            (error: AgentInvocationError) =>
              new AgentFailure({ message: error.message }),
          ),
        );
        return {
          memberMessage: messageDto(turn.memberMessage),
          agentMessage: messageDto(turn.agentMessage),
          run: agentRunDto(turn.run),
        };
      }),
    });
  }),
);

export const ChannelWorkspaceLive = ChannelWorkspace.layer();
const FamilySandboxLive = FamilySandbox.layer.pipe(
  Layer.provide(ChannelWorkspaceLive),
);
export const BrowserServiceLive = BrowserService.layer;
export const FamilyAccessLive = FamilyAccess.layer.pipe(
  Layer.provide(RontoStore.layer),
);
const connectorUrl = process.env.OPEN_CONNECTOR_URL?.trim() || undefined;
const connectorEncryptionKey =
  process.env.CONNECTOR_TOKEN_ENCRYPTION_KEY?.trim() || undefined;
const connectorAdminToken =
  process.env.OPEN_CONNECTOR_ADMIN_TOKEN?.trim() || undefined;
const connectorServices = new Set(["gmail", "googlecalendar"]);
const ConnectorServiceLive: Layer.Layer<
  ConnectorService,
  never,
  SqlClient.SqlClient
> =
  connectorUrl === undefined &&
    connectorEncryptionKey === undefined &&
    connectorAdminToken === undefined
    ? ConnectorService.disabled
    : connectorUrl !== undefined &&
        connectorEncryptionKey !== undefined &&
        connectorAdminToken !== undefined &&
        connectorServices.size > 0
      ? ConnectorService.layer(
          connectorUrl,
          connectorAdminToken,
          connectorEncryptionKey,
          connectorServices,
        ).pipe(Layer.provide(ConnectorStore.layer))
      : Layer.effect(
          ConnectorService,
          Effect.die(
            new Error(
              "OPEN_CONNECTOR_URL, OPEN_CONNECTOR_ADMIN_TOKEN, and CONNECTOR_TOKEN_ENCRYPTION_KEY must be configured together",
            ),
          ),
        );
const ConnectorManagementLive: Layer.Layer<
  ConnectorManagement,
  never,
  SqlClient.SqlClient
> = connectorUrl !== undefined &&
  connectorAdminToken !== undefined &&
  connectorEncryptionKey !== undefined &&
  connectorServices.size > 0
  ? ConnectorManagement.layer(
      connectorUrl,
      process.env.WEB_URL ?? "http://localhost:2718",
      connectorAdminToken,
      connectorEncryptionKey,
      connectorServices,
    ).pipe(Layer.provide(ConnectorStore.layer))
  : ConnectorManagement.disabled;
const ConnectorApprovalsLive = ConnectorApprovals.layer.pipe(
  Layer.provide(ConnectorServiceLive),
  Layer.provide(ConnectorApprovalStore.layer),
);
export const AgentServiceLive = AgentService.layer.pipe(
  Layer.provide([
    ChannelWorkspaceLive,
    FamilySandboxLive,
    BrowserServiceLive,
    RontoStore.layer,
    ConnectorServiceLive,
    ConnectorApprovalsLive,
  ]),
);
export const ConversationTurnLive = ConversationTurn.layer.pipe(
  Layer.provide(AgentServiceLive),
  Layer.provide([RontoStore.layer, ChannelWorkspaceLive]),
);
export const SessionSummaryRuntimeLive = SessionSummaryWorkerLive.pipe(
  Layer.provide(AgentServiceLive),
  Layer.provide(RontoStore.layer),
);

export const WhatsappStoreLive = WhatsappStore.layer;
export const WhatsappAuthLive = WhatsappAuth.layer.pipe(
  Layer.provideMerge(WhatsappStoreLive),
);
export const WhatsappClientLive = WhatsappClient.layer.pipe(
  Layer.provideMerge(WhatsappAuthLive),
);
export const WhatsappRuntimeLive = WhatsappAdapterLive.pipe(
  Layer.provideMerge(WhatsappClientLive),
  Layer.provide([
    ConversationTurnLive,
    ChannelWorkspaceLive,
    ConnectorApprovalsLive,
  ]),
);

export const RontoApiHandlers = RontoApiHandlersNoDeps.pipe(
  Layer.provide([
    PlatformStore.layer,
    RontoStore.layer,
    FamilyAccessLive,
    ConnectorManagementLive,
    ConnectorApprovalsLive,
    AgentServiceLive,
    ConversationTurnLive,
    ChannelWorkspaceLive,
    AuthorizationLive,
    WhatsappRuntimeLive,
  ]),
);

export const AdmissionApiHandlers = HttpApiBuilder.group(RontoApi, "admission", (handlers) =>
  Effect.gen(function* () {
    const platform = yield* PlatformStore;
    return handlers.handle("validateInvitation", Effect.fn("AdmissionApi.validateInvitation")(
      function* ({ payload }) {
        yield* platform.validateInvitation(payload.kind, payload.token).pipe(
          Effect.catchTag(["SqlError", "SchemaError"], Effect.die),
          Effect.catchTag("AdmissionDenied", () => new NotFound({ message: "Invitation unavailable" })),
        );
        return { valid: true };
      },
    ));
  }),
).pipe(Layer.provide(PlatformStore.layer));
