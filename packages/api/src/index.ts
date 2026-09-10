import { Context, Schema } from "effect";
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSchema,
} from "effect/unstable/httpapi";
import { Multipart } from "effect/unstable/http";

export const UserId = Schema.String.pipe(Schema.brand("UserId"));
export type UserId = typeof UserId.Type;

export const FamilyId = Schema.String.pipe(Schema.brand("FamilyId"));
export type FamilyId = typeof FamilyId.Type;

export const FamilyMemberId = Schema.String.pipe(
  Schema.brand("FamilyMemberId"),
);
export type FamilyMemberId = typeof FamilyMemberId.Type;

export const ChannelId = Schema.String.pipe(Schema.brand("ChannelId"));
export type ChannelId = typeof ChannelId.Type;

export const ConversationId = Schema.String.pipe(
  Schema.brand("ConversationId"),
);
export type ConversationId = typeof ConversationId.Type;

export const MessageId = Schema.String.pipe(Schema.brand("MessageId"));
export type MessageId = typeof MessageId.Type;

export const AgentRunId = Schema.String.pipe(Schema.brand("AgentRunId"));
export type AgentRunId = typeof AgentRunId.Type;

export const FileId = Schema.String.pipe(Schema.brand("FileId"));
export type FileId = typeof FileId.Type;

export const FamilyMemberRole = Schema.Literals(["primary", "member"]);
export type FamilyMemberRole = typeof FamilyMemberRole.Type;
export const ConversationStatus = Schema.Literals(["active", "archived"]);
export const MessageSenderType = Schema.Literals([
  "member",
  "external",
  "agent",
  "system",
  "tool",
]);
export const AgentRunStatus = Schema.Literals([
  "pending",
  "running",
  "waiting_for_approval",
  "succeeded",
  "failed",
  "cancelled",
]);
export const FileKind = Schema.Literals(["upload", "download", "generated"]);
export type FileKind = typeof FileKind.Type;

export const MessageTextBlock = Schema.Struct({
  type: Schema.Literal("text"),
  text: Schema.NonEmptyString,
});

export const MessageFileBlock = Schema.Struct({
  type: Schema.Literal("file"),
  fileId: FileId,
});

export const MessageThinkingBlock = Schema.Struct({
  type: Schema.Literal("thinking"),
  thinking: Schema.NonEmptyString,
  thinkingSignature: Schema.optionalKey(Schema.String),
  redacted: Schema.optionalKey(Schema.Boolean),
  phase: Schema.optionalKey(Schema.Literals(["intermediate", "final"])),
});

export const MessageToolBlock = Schema.Struct({
  type: Schema.Literal("tool"),
  toolCallId: Schema.NonEmptyString,
  name: Schema.NonEmptyString,
  argumentsJson: Schema.String,
  resultJson: Schema.String,
  isError: Schema.Boolean,
});

export const MessageWorkBlock = Schema.Struct({
  type: Schema.Literal("work"),
  durationMs: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
});

export const MessageApprovalBlock = Schema.Struct({
  type: Schema.Literal("approval"),
  approvalId: Schema.NonEmptyString,
  title: Schema.NonEmptyString,
  description: Schema.NonEmptyString,
  expiresAt: Schema.DateTimeUtcFromString,
});

export const MessageInputContent = Schema.Struct({
  version: Schema.Literal(1),
  blocks: Schema.NonEmptyArray(
    Schema.Union([MessageTextBlock, MessageFileBlock]),
  ),
});
export type MessageInputContent = typeof MessageInputContent.Type;

export const MessageContent = Schema.Struct({
  version: Schema.Literal(1),
  blocks: Schema.NonEmptyArray(
    Schema.Union([
      MessageTextBlock,
      MessageFileBlock,
      MessageThinkingBlock,
      MessageToolBlock,
      MessageWorkBlock,
      MessageApprovalBlock,
    ]),
  ),
});
export type MessageContent = typeof MessageContent.Type;

export class AuthenticatedUser extends Context.Service<
  AuthenticatedUser,
  {
    readonly id: UserId;
    readonly name: string;
    readonly email: string;
  }
>()("ronto/api/AuthenticatedUser") {}

export class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  "Unauthorized",
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

export class NotFound extends Schema.TaggedError<NotFound>()(
  "NotFound",
  { message: Schema.String },
  { httpApiStatus: 404 },
) {}

export class Conflict extends Schema.TaggedError<Conflict>()(
  "Conflict",
  { message: Schema.String },
  { httpApiStatus: 409 },
) {}

export class AgentFailure extends Schema.TaggedError<AgentFailure>()(
  "AgentFailure",
  { message: Schema.String },
  { httpApiStatus: 502 },
) {}

export class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: AuthenticatedUser }
>()("ronto/api/Authorization", {
  error: Unauthorized,
}) {}

export class MemberDto extends Schema.Class<MemberDto>("MemberDto")({
  id: FamilyMemberId,
  familyId: FamilyId,
  userId: UserId,
  role: FamilyMemberRole,
  joinedAt: Schema.DateTimeUtc,
}) {}

export class FamilyDto extends Schema.Class<FamilyDto>("FamilyDto")({
  id: FamilyId,
  name: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

export class FamilyMembershipDto extends Schema.Class<FamilyMembershipDto>(
  "FamilyMembershipDto",
)({
  family: FamilyDto,
  member: MemberDto,
}) {}

export class FamilyMemberSummaryDto extends Schema.Class<FamilyMemberSummaryDto>(
  "FamilyMemberSummaryDto",
)({
  id: FamilyMemberId,
  role: FamilyMemberRole,
  name: Schema.String,
  email: Schema.String,
  channelIds: Schema.Array(ChannelId),
  joinedAt: Schema.DateTimeUtc,
}) {}

export class FamilyMemberProfileDto extends Schema.Class<FamilyMemberProfileDto>(
  "FamilyMemberProfileDto",
)({
  id: FamilyMemberId,
  name: Schema.String,
}) {}

export class FamilyInviteDto extends Schema.Class<FamilyInviteDto>(
  "FamilyInviteDto",
)({
  token: Schema.NonEmptyString,
  role: FamilyMemberRole,
  expiresAt: Schema.DateTimeUtc,
}) {}

export const WhatsappConnectionStatus = Schema.Literals([
  "disabled",
  "pairing",
  "connecting",
  "connected",
  "reconnecting",
  "logged_out",
]);

export class WhatsappHealthDto extends Schema.Class<WhatsappHealthDto>(
  "WhatsappHealthDto",
)({
  status: WhatsappConnectionStatus,
}) {}

export class WhatsappPairingCodeDto extends Schema.Class<WhatsappPairingCodeDto>(
  "WhatsappPairingCodeDto",
)({
  code: Schema.NonEmptyString,
}) {}

export class WhatsappClaimDto extends Schema.Class<WhatsappClaimDto>(
  "WhatsappClaimDto",
)({
  token: Schema.NonEmptyString,
  expiresAt: Schema.DateTimeUtc,
}) {}

export class WhatsappIdentityDto extends Schema.Class<WhatsappIdentityDto>(
  "WhatsappIdentityDto",
)({
  id: Schema.String,
  externalUserId: Schema.NonEmptyString,
  displayName: Schema.NullOr(Schema.String),
}) {}

export class WhatsappDmFamilyDto extends Schema.Class<WhatsappDmFamilyDto>(
  "WhatsappDmFamilyDto",
)({
  familyId: FamilyId,
  familyName: Schema.NonEmptyString,
  code: Schema.NonEmptyString,
  selected: Schema.Boolean,
  conversationId: Schema.NullOr(ConversationId),
}) {}

export class WhatsappBindingDto extends Schema.Class<WhatsappBindingDto>(
  "WhatsappBindingDto",
)({
  id: Schema.String,
  conversationId: ConversationId,
  externalChannelId: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtc,
}) {}

export const ConnectorStatus = Schema.Literals([
  "pending",
  "active",
  "disconnecting",
  "failed",
]);

export class ConnectorDto extends Schema.Class<ConnectorDto>("ConnectorDto")({
  id: Schema.String,
  service: Schema.String,
  requestedScopes: Schema.Array(Schema.String),
  grantedScopes: Schema.Array(Schema.String),
  status: ConnectorStatus,
}) {}

export class ConnectorAuthorizationDto extends Schema.Class<ConnectorAuthorizationDto>(
  "ConnectorAuthorizationDto",
)({
  connection: ConnectorDto,
  authorizationUrl: Schema.String,
}) {}

export class ConnectorProviderDto extends Schema.Class<ConnectorProviderDto>(
  "ConnectorProviderDto",
)({
  service: Schema.String,
  scopes: Schema.Array(Schema.String),
}) {}

export const ConnectorApprovalStatus = Schema.Literals([
  "pending",
  "approved",
  "rejected",
  "expired",
  "succeeded",
  "failed",
  "outcome_unknown",
]);

export class ConnectorApprovalDto extends Schema.Class<ConnectorApprovalDto>(
  "ConnectorApprovalDto",
)({
  id: Schema.String,
  conversationId: ConversationId,
  actionId: Schema.String,
  title: Schema.String,
  description: Schema.String,
  status: ConnectorApprovalStatus,
  expiresAt: Schema.DateTimeUtc,
}) {}

export class MeDto extends Schema.Class<MeDto>("MeDto")({
  user: Schema.Struct({
    id: UserId,
    name: Schema.String,
    email: Schema.String,
  }),
  memberships: Schema.Array(FamilyMembershipDto),
  isPlatformAdministrator: Schema.Boolean,
  canCreateFamily: Schema.Boolean,
}) {}

export const InvitationInput = Schema.Struct({
  kind: Schema.Literals(["platform", "family"]),
  token: Schema.NonEmptyString.check(Schema.isMaxLength(256)),
});

export class PlatformInvitationDto extends Schema.Class<PlatformInvitationDto>("PlatformInvitationDto")({
  id: Schema.String,
  createdByUserId: UserId,
  createdAt: Schema.DateTimeUtc,
  expiresAt: Schema.DateTimeUtc,
  revokedAt: Schema.NullOr(Schema.DateTimeUtc),
  claimedByUserId: Schema.NullOr(UserId),
  claimedAt: Schema.NullOr(Schema.DateTimeUtc),
}) {}

export class PlatformFamilyDto extends Schema.Class<PlatformFamilyDto>("PlatformFamilyDto")({
  id: FamilyId,
  name: Schema.String,
  creatorUserId: Schema.NullOr(UserId),
  creatorName: Schema.NullOr(Schema.String),
  memberCount: Schema.Int,
  managedFileBytes: Schema.Int,
  durableStorageBytes: Schema.Int,
  sandboxStatus: Schema.Literals(["unprovisioned", "ready", "unhealthy"]),
  limits: Schema.Struct({
    cpus: Schema.Int,
    memoryBytes: Schema.Int,
    pids: Schema.Int,
    commandSeconds: Schema.Int,
    storageBytes: Schema.Int,
    temporaryBytes: Schema.Int,
    outputBytes: Schema.Int,
  }),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

export class ConversationDto extends Schema.Class<ConversationDto>(
  "ConversationDto",
)({
  id: ConversationId,
  familyId: FamilyId,
  channelId: ChannelId,
  title: Schema.NullOr(Schema.String),
  status: ConversationStatus,
  createdByMemberId: Schema.NullOr(FamilyMemberId),
  participantCount: Schema.Int.check(Schema.isGreaterThan(0)),
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

export class ChannelDto extends Schema.Class<ChannelDto>("ChannelDto")({
  id: ChannelId,
  familyId: FamilyId,
  name: Schema.NonEmptyString,
  purpose: Schema.String,
  isDefault: Schema.Boolean,
  createdAt: Schema.DateTimeUtc,
  updatedAt: Schema.DateTimeUtc,
}) {}

export class ChannelMemoryDto extends Schema.Class<ChannelMemoryDto>(
  "ChannelMemoryDto",
)({
  channelId: ChannelId,
  content: Schema.String,
  revision: Schema.String,
}) {}

export class FamilyMemoryDto extends Schema.Class<FamilyMemoryDto>(
  "FamilyMemoryDto",
)({
  familyId: FamilyId,
  content: Schema.String,
  revision: Schema.String,
}) {}

export class ChannelFileDto extends Schema.Class<ChannelFileDto>(
  "ChannelFileDto",
)({
  id: FileId,
  channelId: ChannelId,
  originatingConversationId: Schema.NullOr(ConversationId),
  originatingMessageId: Schema.NullOr(MessageId),
  originatingRunId: Schema.NullOr(AgentRunId),
  createdByMemberId: Schema.NullOr(FamilyMemberId),
  kind: FileKind,
  name: Schema.NonEmptyString,
  mediaType: Schema.NonEmptyString,
  byteSize: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  checksum: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtc,
}) {}

const FileUpload = Schema.Struct({
  file: Multipart.SingleFileSchema,
}).pipe(
  HttpApiSchema.asMultipart({
    maxParts: 1,
    maxFileSize: 25 * 1024 * 1024,
    maxTotalSize: 25 * 1024 * 1024,
  }),
);

const FileDownload = HttpApiSchema.WithHeaders(
  Schema.Uint8Array.pipe(HttpApiSchema.asUint8Array()),
  {
    "content-disposition": Schema.String,
    "content-type": Schema.String,
    "x-content-type-options": Schema.String,
    "cache-control": Schema.String,
  },
);

export class MessageDto extends Schema.Class<MessageDto>("MessageDto")({
  id: MessageId,
  conversationId: ConversationId,
  sequence: Schema.Int.check(Schema.isGreaterThan(0)),
  senderType: MessageSenderType,
  senderMemberId: Schema.NullOr(FamilyMemberId),
  externalSenderId: Schema.NullOr(Schema.String),
  externalSenderName: Schema.NullOr(Schema.String),
  replyToMessageId: Schema.NullOr(MessageId),
  content: MessageContent,
  createdAt: Schema.DateTimeUtc,
}) {}

export class AgentRunDto extends Schema.Class<AgentRunDto>("AgentRunDto")({
  id: AgentRunId,
  conversationId: ConversationId,
  triggerMessageId: MessageId,
  status: AgentRunStatus,
  modelProvider: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtc,
  startedAt: Schema.NullOr(Schema.DateTimeUtc),
  completedAt: Schema.NullOr(Schema.DateTimeUtc),
}) {}

export const SendMessagePayload = Schema.Struct({
  content: MessageInputContent,
  replyToMessageId: Schema.NullOr(MessageId),
});
export type SendMessagePayload = typeof SendMessagePayload.Type;

export const TurnStreamEvent = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("started"),
    memberMessage: MessageDto,
    run: AgentRunDto,
  }),
  Schema.Struct({
    type: Schema.Literal("text"),
    text: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("title"),
    title: Schema.NonEmptyString,
  }),
  Schema.Struct({
    type: Schema.Literal("status"),
    status: Schema.NonEmptyString,
  }),
  Schema.Struct({ type: Schema.Literal("thinking-start") }),
  Schema.Struct({
    type: Schema.Literal("thinking-delta"),
    delta: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("thinking-end") }),
  Schema.Struct({
    type: Schema.Literal("tool-start"),
    toolCallId: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    argumentsJson: Schema.String,
  }),
  Schema.Struct({
    type: Schema.Literal("tool-end"),
    toolCallId: Schema.NonEmptyString,
    name: Schema.NonEmptyString,
    argumentsJson: Schema.String,
    resultJson: Schema.String,
    isError: Schema.Boolean,
  }),
  Schema.Struct({
    type: Schema.Literal("completed"),
    agentMessage: MessageDto,
    run: AgentRunDto,
  }),
  Schema.Struct({
    type: Schema.Literal("failed"),
    message: Schema.String,
  }),
  Schema.Struct({ type: Schema.Literal("cancelled") }),
]);
export type TurnStreamEvent = typeof TurnStreamEvent.Type;

const ApplicationErrors = [Unauthorized, NotFound, Conflict] as const;

export class RontoApiGroup extends HttpApiGroup.make("ronto")
  .add(
    HttpApiEndpoint.get("listPlatformFamilies", "/platform/families", {
      success: Schema.Array(PlatformFamilyDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("createPlatformInvitation", "/platform/invitations", {
      success: Schema.Struct({ token: Schema.String, invitation: PlatformInvitationDto }),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listPlatformInvitations", "/platform/invitations", {
      success: Schema.Array(PlatformInvitationDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.delete("revokePlatformInvitation", "/platform/invitations/:id", {
      params: { id: Schema.String },
      success: HttpApiSchema.NoContent,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("redeemPlatformInvitation", "/platform/invitations/redeem", {
      payload: Schema.Struct({ token: Schema.NonEmptyString.check(Schema.isMaxLength(256)) }),
      success: MeDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("me", "/me", {
      success: MeDto,
      error: Unauthorized,
    }),
    HttpApiEndpoint.post("onboard", "/onboarding", {
      payload: Schema.Struct({ familyName: Schema.NonEmptyString }),
      success: MeDto,
      error: [Unauthorized, Conflict],
    }),
    HttpApiEndpoint.get("listFamilyMembers", "/families/:familyId/members", {
      params: { familyId: FamilyId },
      success: Schema.Array(FamilyMemberSummaryDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listFamilyMemberProfiles", "/families/:familyId/member-profiles", {
      params: { familyId: FamilyId },
      success: Schema.Array(FamilyMemberProfileDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("createFamilyInvite", "/families/:familyId/invites", {
      params: { familyId: FamilyId },
      payload: Schema.Struct({ role: FamilyMemberRole }),
      success: FamilyInviteDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("redeemFamilyInvite", "/family/invites/redeem", {
      payload: Schema.Struct({ token: Schema.NonEmptyString }),
      success: MeDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("getFamilyMemory", "/families/:familyId/memory", {
      params: { familyId: FamilyId },
      success: FamilyMemoryDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.put("updateFamilyMemory", "/families/:familyId/memory", {
      params: { familyId: FamilyId },
      payload: Schema.Struct({
        content: Schema.String,
        revision: Schema.String,
      }),
      success: FamilyMemoryDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("getWhatsappHealth", "/families/:familyId/whatsapp/health", {
      params: { familyId: FamilyId },
      success: WhatsappHealthDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("getPlatformWhatsappHealth", "/platform/whatsapp/health", {
      success: WhatsappHealthDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("requestWhatsappPairingCode", "/platform/whatsapp/pairing-code", {
      payload: Schema.Struct({ phoneNumber: Schema.NonEmptyString }),
      success: WhatsappPairingCodeDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("createWhatsappIdentityClaim", "/families/:familyId/whatsapp/identity-claims", {
      params: { familyId: FamilyId },
      success: WhatsappClaimDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listWhatsappIdentities", "/families/:familyId/whatsapp/identities", {
      params: { familyId: FamilyId },
      success: Schema.Array(WhatsappIdentityDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listWhatsappDmFamilies", "/families/:familyId/whatsapp/dm-families", {
      params: { familyId: FamilyId },
      success: Schema.Array(WhatsappDmFamilyDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.put("selectWhatsappDmFamily", "/families/:familyId/whatsapp/dm-family", {
      params: { familyId: FamilyId },
      success: WhatsappDmFamilyDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listConnectors", "/families/:familyId/connectors", {
      params: { familyId: FamilyId },
      success: Schema.Array(ConnectorDto),
      error: [...ApplicationErrors, AgentFailure],
    }),
    HttpApiEndpoint.get("listConnectorProviders", "/families/:familyId/connectors/providers", {
      params: { familyId: FamilyId },
      success: Schema.Array(ConnectorProviderDto),
      error: [...ApplicationErrors, AgentFailure],
    }),
    HttpApiEndpoint.post("startConnectorOAuth", "/families/:familyId/connectors/oauth", {
      params: { familyId: FamilyId },
      payload: Schema.Struct({
        service: Schema.NonEmptyString,
        requestedScopes: Schema.NonEmptyArray(Schema.NonEmptyString),
      }),
      success: ConnectorAuthorizationDto,
      error: [...ApplicationErrors, AgentFailure],
    }),
    HttpApiEndpoint.post(
      "reconcileConnector",
      "/families/:familyId/connectors/:connectionId/reconcile",
      {
        params: { familyId: FamilyId, connectionId: Schema.String },
        success: ConnectorDto,
        error: [...ApplicationErrors, AgentFailure],
      },
    ),
    HttpApiEndpoint.delete(
      "disconnectConnector",
      "/families/:familyId/connectors/:connectionId",
      {
        params: { familyId: FamilyId, connectionId: Schema.String },
        success: HttpApiSchema.NoContent,
        error: [...ApplicationErrors, AgentFailure],
      },
    ),
    HttpApiEndpoint.get("listConnectorApprovals", "/families/:familyId/connector-approvals", {
      params: { familyId: FamilyId },
      success: Schema.Array(ConnectorApprovalDto),
      error: [...ApplicationErrors, AgentFailure],
    }),
    HttpApiEndpoint.post(
      "decideConnectorApproval",
      "/families/:familyId/connector-approvals/:approvalId",
      {
        params: { familyId: FamilyId, approvalId: Schema.String },
        payload: Schema.Struct({
          decision: Schema.Literals(["approved", "rejected"]),
        }),
        success: ConnectorApprovalDto,
        error: [...ApplicationErrors, AgentFailure],
      },
    ),
    HttpApiEndpoint.delete("revokeWhatsappIdentity", "/families/:familyId/whatsapp/identities/:identityId", {
      params: { familyId: FamilyId, identityId: Schema.String },
      success: HttpApiSchema.NoContent,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post(
      "createWhatsappBindingClaim",
      "/families/:familyId/conversations/:conversationId/whatsapp-binding-claims",
      {
        params: { familyId: FamilyId, conversationId: ConversationId },
        success: WhatsappClaimDto,
        error: ApplicationErrors,
      },
    ),
    HttpApiEndpoint.get(
      "listWhatsappBindings",
      "/families/:familyId/conversations/:conversationId/whatsapp-bindings",
      {
        params: { familyId: FamilyId, conversationId: ConversationId },
        success: Schema.Array(WhatsappBindingDto),
        error: ApplicationErrors,
      },
    ),
    HttpApiEndpoint.delete(
      "removeWhatsappBinding",
      "/families/:familyId/conversations/:conversationId/whatsapp-bindings/:bindingId",
      {
        params: {
          familyId: FamilyId,
          conversationId: ConversationId,
          bindingId: Schema.String,
        },
        success: HttpApiSchema.NoContent,
        error: ApplicationErrors,
      },
    ),
    HttpApiEndpoint.get("listConversations", "/families/:familyId/conversations", {
      params: { familyId: FamilyId },
      success: Schema.Array(ConversationDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listChannels", "/families/:familyId/channels", {
      params: { familyId: FamilyId },
      success: Schema.Array(ChannelDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("createChannel", "/families/:familyId/channels", {
      params: { familyId: FamilyId },
      payload: Schema.Struct({
        name: Schema.NonEmptyString,
        purpose: Schema.String,
      }),
      success: ChannelDto,
      error: [...ApplicationErrors],
    }),
    HttpApiEndpoint.put(
      "setChannelMemberAccess",
      "/families/:familyId/channels/:channelId/members/:memberId",
      {
        params: { familyId: FamilyId, channelId: ChannelId, memberId: FamilyMemberId },
        payload: Schema.Struct({ active: Schema.Boolean }),
        success: FamilyMemberSummaryDto,
        error: ApplicationErrors,
      },
    ),
    HttpApiEndpoint.get("getChannelMemory", "/families/:familyId/channels/:channelId/memory", {
      params: { familyId: FamilyId, channelId: ChannelId },
      success: ChannelMemoryDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.put("updateChannelMemory", "/families/:familyId/channels/:channelId/memory", {
      params: { familyId: FamilyId, channelId: ChannelId },
      payload: Schema.Struct({
        content: Schema.String,
        revision: Schema.String,
      }),
      success: ChannelMemoryDto,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listChannelFiles", "/families/:familyId/channels/:channelId/files", {
      params: { familyId: FamilyId, channelId: ChannelId },
      success: Schema.Array(ChannelFileDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post(
      "uploadConversationFile",
      "/families/:familyId/conversations/:conversationId/files",
      {
        params: { familyId: FamilyId, conversationId: ConversationId },
        payload: FileUpload,
        success: ChannelFileDto,
        error: ApplicationErrors,
      },
    ),
    HttpApiEndpoint.get("downloadFile", "/families/:familyId/files/:fileId", {
      params: { familyId: FamilyId, fileId: FileId },
      success: FileDownload,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("viewFile", "/families/:familyId/files/:fileId/view", {
      params: { familyId: FamilyId, fileId: FileId },
      success: FileDownload,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.delete("deleteFile", "/families/:familyId/files/:fileId", {
      params: { familyId: FamilyId, fileId: FileId },
      success: HttpApiSchema.NoContent,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post(
      "createConversation",
      "/families/:familyId/channels/:channelId/conversations",
      {
        params: { familyId: FamilyId, channelId: ChannelId },
        payload: Schema.Struct({ title: Schema.NullOr(Schema.NonEmptyString) }),
        success: ConversationDto,
        error: ApplicationErrors,
      },
    ),
    HttpApiEndpoint.delete("deleteConversation", "/families/:familyId/conversations/:id", {
      params: { familyId: FamilyId, id: ConversationId },
      success: HttpApiSchema.NoContent,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("listMessages", "/families/:familyId/conversations/:id/messages", {
      params: { familyId: FamilyId, id: ConversationId },
      success: Schema.Array(MessageDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.get("getActiveRun", "/families/:familyId/conversations/:id/active-run", {
      params: { familyId: FamilyId, id: ConversationId },
      success: Schema.NullOr(AgentRunDto),
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.delete("cancelActiveRun", "/families/:familyId/conversations/:id/active-run", {
      params: { familyId: FamilyId, id: ConversationId },
      success: HttpApiSchema.NoContent,
      error: ApplicationErrors,
    }),
    HttpApiEndpoint.post("sendMessage", "/families/:familyId/conversations/:id/messages", {
      params: { familyId: FamilyId, id: ConversationId },
      payload: SendMessagePayload,
      success: Schema.Struct({
        memberMessage: MessageDto,
        agentMessage: MessageDto,
        run: AgentRunDto,
      }),
      error: [...ApplicationErrors, AgentFailure],
    }),
  )
  .middleware(Authorization)
  .prefix("/api") {}

export class AdmissionApiGroup extends HttpApiGroup.make("admission").add(
  HttpApiEndpoint.post("validateInvitation", "/api/invitations/validate", {
    payload: InvitationInput,
    success: Schema.Struct({ valid: Schema.Literal(true) }),
    error: NotFound,
  }),
) {}

export class RontoApi extends HttpApi.make("ronto-api").add(RontoApiGroup, AdmissionApiGroup) {}
