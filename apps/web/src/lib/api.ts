import {
  AgentRunId,
  AgentRunStatus,
  ChannelId,
  ConversationId,
  ConversationStatus,
  FamilyId,
  FamilyMemberId,
  FamilyMemberRole,
  FileId,
  FileKind,
  MessageContent,
  MessageId,
  MessageSenderType,
  TurnStreamEvent,
  UserId,
  InvitationInput,
} from '@ronto/api'
import { Schema } from 'effect'

const ApiErrorBody = Schema.Struct({ message: Schema.String })
const Member = Schema.Struct({
  id: FamilyMemberId,
  familyId: FamilyId,
  userId: UserId,
  role: FamilyMemberRole,
  joinedAt: Schema.DateTimeUtcFromString,
})
const Family = Schema.Struct({
  id: FamilyId,
  name: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
})
const FamilyMembership = Schema.Struct({ family: Family, member: Member })
const Me = Schema.Struct({
  user: Schema.Struct({
    id: UserId,
    name: Schema.String,
    email: Schema.String,
  }),
  memberships: Schema.Array(FamilyMembership),
  isPlatformAdministrator: Schema.Boolean,
  canCreateFamily: Schema.Boolean,
})
const PlatformInvitation = Schema.Struct({
  id: Schema.String,
  createdByUserId: UserId,
  createdAt: Schema.DateTimeUtcFromString,
  expiresAt: Schema.DateTimeUtcFromString,
  revokedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  claimedByUserId: Schema.NullOr(UserId),
  claimedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
})
const PlatformFamily = Schema.Struct({
  id: FamilyId,
  name: Schema.String,
  creatorUserId: Schema.NullOr(UserId),
  creatorName: Schema.NullOr(Schema.String),
  memberCount: Schema.Int,
  managedFileBytes: Schema.Int,
  durableStorageBytes: Schema.Int,
  sandboxStatus: Schema.Literals(['unprovisioned', 'ready', 'unhealthy']),
  limits: Schema.Struct({
    cpus: Schema.Int,
    memoryBytes: Schema.Int,
    pids: Schema.Int,
    commandSeconds: Schema.Int,
    storageBytes: Schema.Int,
    temporaryBytes: Schema.Int,
    outputBytes: Schema.Int,
  }),
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
})
const FamilyMemberSummary = Schema.Struct({
  id: FamilyMemberId,
  role: FamilyMemberRole,
  name: Schema.String,
  email: Schema.String,
  channelIds: Schema.Array(ChannelId),
  joinedAt: Schema.DateTimeUtcFromString,
})
const FamilyMemberList = Schema.Array(FamilyMemberSummary)
const FamilyMemberProfile = Schema.Struct({
  id: FamilyMemberId,
  name: Schema.String,
})
const FamilyMemberProfileList = Schema.Array(FamilyMemberProfile)
const FamilyInvite = Schema.Struct({
  token: Schema.NonEmptyString,
  role: FamilyMemberRole,
  expiresAt: Schema.DateTimeUtcFromString,
})
const WhatsappHealth = Schema.Struct({
  status: Schema.Literals([
    'disabled',
    'pairing',
    'connecting',
    'connected',
    'reconnecting',
    'logged_out',
  ]),
})
const WhatsappPairingCode = Schema.Struct({ code: Schema.NonEmptyString })
const WhatsappClaim = Schema.Struct({
  token: Schema.NonEmptyString,
  expiresAt: Schema.DateTimeUtcFromString,
})
const WhatsappIdentity = Schema.Struct({
  id: Schema.String,
  externalUserId: Schema.NonEmptyString,
  displayName: Schema.NullOr(Schema.String),
})
const WhatsappIdentityList = Schema.Array(WhatsappIdentity)
const WhatsappDmFamily = Schema.Struct({
  familyId: FamilyId,
  familyName: Schema.NonEmptyString,
  code: Schema.NonEmptyString,
  selected: Schema.Boolean,
  conversationId: Schema.NullOr(ConversationId),
})
const WhatsappDmFamilyList = Schema.Array(WhatsappDmFamily)
const WhatsappBinding = Schema.Struct({
  id: Schema.String,
  conversationId: ConversationId,
  externalChannelId: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
})
const WhatsappBindingList = Schema.Array(WhatsappBinding)
const Connector = Schema.Struct({
  id: Schema.String,
  service: Schema.String,
  requestedScopes: Schema.Array(Schema.String),
  grantedScopes: Schema.Array(Schema.String),
  status: Schema.Literals(['pending', 'active', 'disconnecting', 'failed']),
})
const ConnectorList = Schema.Array(Connector)
const ConnectorProvider = Schema.Struct({
  service: Schema.String,
  scopes: Schema.Array(Schema.String),
})
const ConnectorProviderList = Schema.Array(ConnectorProvider)
const ConnectorAuthorization = Schema.Struct({
  connection: Connector,
  authorizationUrl: Schema.String,
})
const ConnectorApproval = Schema.Struct({
  id: Schema.String,
  conversationId: ConversationId,
  actionId: Schema.String,
  title: Schema.String,
  description: Schema.String,
  status: Schema.Literals(['pending', 'approved', 'rejected', 'expired', 'succeeded', 'failed', 'outcome_unknown']),
  expiresAt: Schema.DateTimeUtcFromString,
})
const ConnectorApprovalList = Schema.Array(ConnectorApproval)
const Channel = Schema.Struct({
  id: ChannelId,
  familyId: FamilyId,
  name: Schema.NonEmptyString,
  purpose: Schema.String,
  isDefault: Schema.Boolean,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
})
const Conversation = Schema.Struct({
  id: ConversationId,
  familyId: FamilyId,
  channelId: ChannelId,
  title: Schema.NullOr(Schema.String),
  status: ConversationStatus,
  createdByMemberId: Schema.NullOr(FamilyMemberId),
  participantCount: Schema.Int,
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
})
const Message = Schema.Struct({
  id: MessageId,
  conversationId: ConversationId,
  sequence: Schema.Int,
  senderType: MessageSenderType,
  senderMemberId: Schema.NullOr(FamilyMemberId),
  externalSenderId: Schema.NullOr(Schema.String),
  externalSenderName: Schema.NullOr(Schema.String),
  replyToMessageId: Schema.NullOr(MessageId),
  content: MessageContent,
  createdAt: Schema.DateTimeUtcFromString,
})
const AgentRun = Schema.Struct({
  id: AgentRunId,
  conversationId: ConversationId,
  triggerMessageId: MessageId,
  status: AgentRunStatus,
  modelProvider: Schema.NullOr(Schema.String),
  modelId: Schema.NullOr(Schema.String),
  createdAt: Schema.DateTimeUtcFromString,
  startedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
  completedAt: Schema.NullOr(Schema.DateTimeUtcFromString),
})
const ConversationList = Schema.Array(Conversation)
const ChannelList = Schema.Array(Channel)
const ChannelMemory = Schema.Struct({
  channelId: ChannelId,
  content: Schema.String,
  revision: Schema.String,
})
const FamilyMemory = Schema.Struct({
  familyId: FamilyId,
  content: Schema.String,
  revision: Schema.String,
})
const ChannelFileSchema = Schema.Struct({
  id: FileId,
  channelId: ChannelId,
  originatingConversationId: Schema.NullOr(ConversationId),
  originatingMessageId: Schema.NullOr(MessageId),
  originatingRunId: Schema.NullOr(AgentRunId),
  createdByMemberId: Schema.NullOr(FamilyMemberId),
  kind: FileKind,
  name: Schema.NonEmptyString,
  mediaType: Schema.NonEmptyString,
  byteSize: Schema.Int,
  checksum: Schema.NonEmptyString,
  createdAt: Schema.DateTimeUtcFromString,
})
export type ChannelFile = typeof ChannelFileSchema.Type
const ChannelFileList = Schema.Array(ChannelFileSchema)
const MessageList = Schema.Array(Message)
const MessageTurn = Schema.Struct({
  memberMessage: Message,
  agentMessage: Message,
  run: AgentRun,
})
const TurnEvent = Schema.toCodecJson(TurnStreamEvent)
export type TurnEvent = typeof TurnEvent.Type
interface TurnStreamState {
  memberMessage: typeof Message.Type | null
  completed: Extract<TurnEvent, { type: 'completed' }> | null
}

export class ApiError extends Error {
  readonly status: number

  constructor(
    status: number,
    message: string,
  ) {
    super(message)
    this.status = status
  }
}

export class TurnCancelledError extends Error {
  constructor() {
    super('Response cancelled')
  }
}

async function streamMessage(
  familyId: FamilyId,
  conversationId: ConversationId,
  text: string,
  fileIds: ReadonlyArray<FileId>,
  signal: AbortSignal,
  onEvent: (event: TurnEvent) => void,
): Promise<typeof MessageTurn.Type> {
  const response = await fetch(
    `/api/families/${familyId}/conversations/${conversationId}/messages/stream`,
    {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      signal,
      body: JSON.stringify({
        content: {
          version: 1,
          blocks: [
            ...(text.length === 0 ? [] : [{ type: 'text', text }]),
            ...fileIds.map((fileId) => ({ type: 'file', fileId })),
          ],
        },
        replyToMessageId: null,
      }),
    },
  )
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const decoded = await Schema.decodeUnknownPromise(ApiErrorBody)(body).catch(
      () => null,
    )
    throw new ApiError(response.status, decoded?.message ?? 'Unable to send message.')
  }
  const state = await consumeTurnStream(response, onEvent)
  if (state.memberMessage === null || state.completed === null)
    throw new Error('The response stream ended before completion.')
  return {
    memberMessage: state.memberMessage,
    agentMessage: state.completed.agentMessage,
    run: state.completed.run,
  }
}

async function consumeTurnStream(
  response: Response,
  onEvent: (event: TurnEvent) => void,
): Promise<TurnStreamState> {
  if (!response.body) throw new Error('The response stream is unavailable.')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''
  const state: TurnStreamState = { memberMessage: null, completed: null }

  const consume = async (line: string) => {
    if (line.trim().length === 0) return
    let input: unknown
    try {
      input = JSON.parse(line)
    } catch {
      throw new ApiError(502, 'Ronto returned an invalid response stream.')
    }
    const event = await Schema.decodeUnknownPromise(TurnEvent)(input).catch(() => {
      throw new ApiError(502, 'Ronto returned an invalid response stream.')
    })
    onEvent(event)
    if (event.type === 'started') state.memberMessage = event.memberMessage
    if (event.type === 'completed') state.completed = event
    if (event.type === 'failed') throw new ApiError(502, event.message)
    if (event.type === 'cancelled') throw new TurnCancelledError()
  }

  while (true) {
    const { done, value } = await reader.read()
    buffered += decoder.decode(value, { stream: !done })
    let newline = buffered.indexOf('\n')
    while (newline !== -1) {
      const line = buffered.slice(0, newline).replace(/\r$/, '')
      buffered = buffered.slice(newline + 1)
      await consume(line)
      newline = buffered.indexOf('\n')
    }
    if (done) break
  }
  if (buffered.trim().length !== 0)
    throw new Error('The response stream ended with an incomplete event.')
  return state
}

async function streamActiveTurn(
  familyId: FamilyId,
  conversationId: ConversationId,
  signal: AbortSignal,
  onEvent: (event: TurnEvent) => void,
): Promise<void> {
  const response = await fetch(
    `/api/families/${familyId}/conversations/${conversationId}/active-run/stream`,
    { credentials: 'include', signal },
  )
  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const decoded = await Schema.decodeUnknownPromise(ApiErrorBody)(body).catch(
      () => null,
    )
    throw new ApiError(response.status, decoded?.message ?? 'Unable to reconnect to the response.')
  }
  await consumeTurnStream(response, onEvent)
}

async function request<S extends Schema.ConstraintDecoder<unknown>>(
  path: string,
  schema: S,
  init?: RequestInit,
  signal?: AbortSignal,
): Promise<S['Type']> {
  const response = await fetch(path, {
    credentials: 'include',
    ...init,
    signal: signal ?? init?.signal,
    headers: {
      'content-type': 'application/json',
      ...init?.headers,
    },
  })
  const body: unknown = await response.json()
  if (!response.ok) {
    const decoded = await Schema.decodeUnknownPromise(ApiErrorBody)(body).catch(
      () => null,
    )
    throw new ApiError(response.status, decoded?.message ?? 'Something went wrong.')
  }
  return Schema.decodeUnknownPromise(schema)(body)
}

async function requestNoContent(path: string, method: 'DELETE'): Promise<void> {
  const response = await fetch(path, { method, credentials: 'include' })
  if (response.ok) return
  const body: unknown = await response.json().catch(() => null)
  const decoded = await Schema.decodeUnknownPromise(ApiErrorBody)(body).catch(
    () => null,
  )
  throw new ApiError(response.status, decoded?.message ?? 'Something went wrong.')
}

const familyPath = (familyId: FamilyId) => `/api/families/${familyId}`

export const api = {
  listPlatformFamilies: (signal?: AbortSignal) => request('/api/platform/families', Schema.Array(PlatformFamily), undefined, signal),
  validateInvitation: (invitation: typeof InvitationInput.Type, signal?: AbortSignal) =>
    request('/api/invitations/validate', Schema.Struct({ valid: Schema.Literal(true) }), { method: 'POST', body: JSON.stringify(invitation) }, signal),
  createPlatformInvitation: () => request('/api/platform/invitations', Schema.Struct({ token: Schema.String, invitation: PlatformInvitation }), { method: 'POST' }),
  listPlatformInvitations: (signal?: AbortSignal) => request('/api/platform/invitations', Schema.Array(PlatformInvitation), undefined, signal),
  revokePlatformInvitation: (id: string) => requestNoContent(`/api/platform/invitations/${id}`, 'DELETE'),
  redeemPlatformInvitation: (token: string) => request('/api/platform/invitations/redeem', Me, { method: 'POST', body: JSON.stringify({ token }) }),
  me: (signal?: AbortSignal) => request('/api/me', Me, undefined, signal),
  listFamilyMembers: (familyId: FamilyId, signal?: AbortSignal) => request(`${familyPath(familyId)}/members`, FamilyMemberList, undefined, signal),
  listFamilyMemberProfiles: (familyId: FamilyId, signal?: AbortSignal) => request(`${familyPath(familyId)}/member-profiles`, FamilyMemberProfileList, undefined, signal),
  createFamilyInvite: (familyId: FamilyId, role: FamilyMemberRole) =>
    request(`${familyPath(familyId)}/invites`, FamilyInvite, { method: 'POST', body: JSON.stringify({ role }) }),
  redeemFamilyInvite: (token: string) =>
    request('/api/family/invites/redeem', Me, { method: 'POST', body: JSON.stringify({ token }) }),
  getFamilyMemory: (familyId: FamilyId, signal?: AbortSignal) => request(`${familyPath(familyId)}/memory`, FamilyMemory, undefined, signal),
  updateFamilyMemory: (familyId: FamilyId, content: string, revision: string) =>
    request(`${familyPath(familyId)}/memory`, FamilyMemory, { method: 'PUT', body: JSON.stringify({ content, revision }) }),
  getWhatsappHealth: (familyId: FamilyId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/whatsapp/health`, WhatsappHealth, undefined, signal),
  listConnectors: (familyId: FamilyId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/connectors`, ConnectorList, undefined, signal),
  listConnectorProviders: (familyId: FamilyId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/connectors/providers`, ConnectorProviderList, undefined, signal),
  startConnectorOAuth: (familyId: FamilyId, service: string, requestedScopes: ReadonlyArray<string>) =>
    request(`${familyPath(familyId)}/connectors/oauth`, ConnectorAuthorization, { method: 'POST', body: JSON.stringify({ service, requestedScopes }) }),
  reconcileConnector: (familyId: FamilyId, connectionId: string) =>
    request(`${familyPath(familyId)}/connectors/${connectionId}/reconcile`, Connector, { method: 'POST' }),
  disconnectConnector: (familyId: FamilyId, connectionId: string) =>
    requestNoContent(`${familyPath(familyId)}/connectors/${connectionId}`, 'DELETE'),
  listConnectorApprovals: (familyId: FamilyId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/connector-approvals`, ConnectorApprovalList, undefined, signal),
  decideConnectorApproval: (familyId: FamilyId, approvalId: string, decision: 'approved' | 'rejected') =>
    request(`${familyPath(familyId)}/connector-approvals/${approvalId}`, ConnectorApproval, { method: 'POST', body: JSON.stringify({ decision }) }),
  getPlatformWhatsappHealth: (signal?: AbortSignal) =>
    request('/api/platform/whatsapp/health', WhatsappHealth, undefined, signal),
  requestWhatsappPairingCode: (phoneNumber: string) =>
    request('/api/platform/whatsapp/pairing-code', WhatsappPairingCode, { method: 'POST', body: JSON.stringify({ phoneNumber }) }),
  createWhatsappIdentityClaim: (familyId: FamilyId) =>
    request(`${familyPath(familyId)}/whatsapp/identity-claims`, WhatsappClaim, { method: 'POST' }),
  listWhatsappIdentities: (familyId: FamilyId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/whatsapp/identities`, WhatsappIdentityList, undefined, signal),
  listWhatsappDmFamilies: (familyId: FamilyId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/whatsapp/dm-families`, WhatsappDmFamilyList, undefined, signal),
  selectWhatsappDmFamily: (familyId: FamilyId) =>
    request(`${familyPath(familyId)}/whatsapp/dm-family`, WhatsappDmFamily, { method: 'PUT' }),
  revokeWhatsappIdentity: (familyId: FamilyId, identityId: string) =>
    requestNoContent(`${familyPath(familyId)}/whatsapp/identities/${identityId}`, 'DELETE'),
  createWhatsappBindingClaim: (familyId: FamilyId, conversationId: ConversationId) =>
    request(`${familyPath(familyId)}/conversations/${conversationId}/whatsapp-binding-claims`, WhatsappClaim, { method: 'POST' }),
  listWhatsappBindings: (familyId: FamilyId, conversationId: ConversationId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/conversations/${conversationId}/whatsapp-bindings`, WhatsappBindingList, undefined, signal),
  removeWhatsappBinding: (familyId: FamilyId, conversationId: ConversationId, bindingId: string) =>
    requestNoContent(`${familyPath(familyId)}/conversations/${conversationId}/whatsapp-bindings/${bindingId}`, 'DELETE'),
  onboard: (familyName: string) =>
    request('/api/onboarding', Me, { method: 'POST', body: JSON.stringify({ familyName }) }),
  listConversations: (familyId: FamilyId, signal?: AbortSignal) => request(`${familyPath(familyId)}/conversations`, ConversationList, undefined, signal),
  listChannels: (familyId: FamilyId, signal?: AbortSignal) => request(`${familyPath(familyId)}/channels`, ChannelList, undefined, signal),
  createChannel: (familyId: FamilyId, name: string, purpose: string) =>
    request(`${familyPath(familyId)}/channels`, Channel, { method: 'POST', body: JSON.stringify({ name, purpose }) }),
  setChannelMemberAccess: (familyId: FamilyId, channelId: ChannelId, memberId: FamilyMemberId, active: boolean) =>
    request(`${familyPath(familyId)}/channels/${channelId}/members/${memberId}`, FamilyMemberSummary, { method: 'PUT', body: JSON.stringify({ active }) }),
  getChannelMemory: (familyId: FamilyId, channelId: ChannelId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/channels/${channelId}/memory`, ChannelMemory, undefined, signal),
  updateChannelMemory: (familyId: FamilyId, channelId: ChannelId, content: string, revision: string) =>
    request(`${familyPath(familyId)}/channels/${channelId}/memory`, ChannelMemory, { method: 'PUT', body: JSON.stringify({ content, revision }) }),
  createConversation: (familyId: FamilyId, channelId: ChannelId, title: string | null) =>
    request(`${familyPath(familyId)}/channels/${channelId}/conversations`, Conversation, { method: 'POST', body: JSON.stringify({ title }) }),
  deleteConversation: (familyId: FamilyId, conversationId: ConversationId) =>
    requestNoContent(`${familyPath(familyId)}/conversations/${conversationId}`, 'DELETE'),
  listMessages: (familyId: FamilyId, conversationId: ConversationId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/conversations/${conversationId}/messages`, MessageList, undefined, signal),
  getActiveRun: (familyId: FamilyId, conversationId: ConversationId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/conversations/${conversationId}/active-run`, Schema.NullOr(AgentRun), undefined, signal),
  cancelActiveRun: (familyId: FamilyId, conversationId: ConversationId) =>
    requestNoContent(`${familyPath(familyId)}/conversations/${conversationId}/active-run`, 'DELETE'),
  listChannelFiles: (familyId: FamilyId, channelId: ChannelId, signal?: AbortSignal) =>
    request(`${familyPath(familyId)}/channels/${channelId}/files`, ChannelFileList, undefined, signal),
  uploadConversationFile: async (familyId: FamilyId, conversationId: ConversationId, file: File, signal?: AbortSignal) => {
    const payload = new FormData()
    payload.append('file', file)
    const response = await fetch(`${familyPath(familyId)}/conversations/${conversationId}/files`, { method: 'POST', credentials: 'include', body: payload, signal })
    const body: unknown = await response.json()
    if (!response.ok) {
      const decoded = await Schema.decodeUnknownPromise(ApiErrorBody)(body).catch(() => null)
      throw new ApiError(response.status, decoded?.message ?? 'Unable to upload file.')
    }
    return Schema.decodeUnknownPromise(ChannelFileSchema)(body)
  },
  deleteFile: (familyId: FamilyId, fileId: FileId) =>
    requestNoContent(`${familyPath(familyId)}/files/${fileId}`, 'DELETE'),
  sendMessage: (familyId: FamilyId, conversationId: ConversationId, text: string, fileIds: ReadonlyArray<FileId>, signal: AbortSignal, onEvent: (event: TurnEvent) => void) =>
    streamMessage(familyId, conversationId, text, fileIds, signal, onEvent),
  streamActiveTurn: (familyId: FamilyId, conversationId: ConversationId, signal: AbortSignal, onEvent: (event: TurnEvent) => void) =>
    streamActiveTurn(familyId, conversationId, signal, onEvent),
}
