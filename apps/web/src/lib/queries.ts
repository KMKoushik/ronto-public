import { queryOptions, skipToken } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { ChannelId, ConversationId, FamilyId } from '@ronto/api'

import { api } from './api'

const minute = 60_000

export const meQuery = () =>
  queryOptions({ queryKey: ['me'], queryFn: ({ signal }) => api.me(signal), staleTime: 5 * minute })

export const channelsQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'channels'], queryFn: ({ signal }) => api.listChannels(familyId, signal), staleTime: minute })

export const conversationsQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'conversations'], queryFn: ({ signal }) => api.listConversations(familyId, signal), staleTime: 30_000 })

export const familyMembersQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'members'], queryFn: ({ signal }) => api.listFamilyMembers(familyId, signal), staleTime: minute })

export const memberProfilesQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'member-profiles'], queryFn: ({ signal }) => api.listFamilyMemberProfiles(familyId, signal), staleTime: 5 * minute })

export const familyMemoryQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'memory'], queryFn: ({ signal }) => api.getFamilyMemory(familyId, signal), staleTime: 30_000 })

export const whatsappHealthQuery = (familyId: FamilyId) =>
  queryOptions({
    queryKey: ['families', familyId, 'whatsapp-health'],
    queryFn: ({ signal }) => api.getWhatsappHealth(familyId, signal),
    staleTime: 5_000,
    refetchInterval: 10_000,
  })

export const connectorsQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'connectors'], queryFn: ({ signal }) => api.listConnectors(familyId, signal), staleTime: 5_000 })

export const connectorProvidersQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'connector-providers'], queryFn: ({ signal }) => api.listConnectorProviders(familyId, signal), staleTime: 5 * minute })

export const connectorApprovalsQuery = (familyId: FamilyId) =>
  queryOptions({
    queryKey: ['families', familyId, 'connector-approvals'],
    queryFn: ({ signal }) => api.listConnectorApprovals(familyId, signal),
    staleTime: 0,
    refetchInterval: 5_000,
  })

export const whatsappIdentitiesQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'whatsapp-identities'], queryFn: ({ signal }) => api.listWhatsappIdentities(familyId, signal), staleTime: 5_000, refetchInterval: 5_000 })

export const whatsappDmFamiliesQuery = (familyId: FamilyId) =>
  queryOptions({ queryKey: ['families', familyId, 'whatsapp-dm-families'], queryFn: ({ signal }) => api.listWhatsappDmFamilies(familyId, signal), staleTime: 5_000, refetchInterval: 5_000 })

export const whatsappBindingsQuery = (familyId: FamilyId, conversationId: ConversationId | null, enabled: boolean) =>
  queryOptions({
    queryKey: ['families', familyId, 'whatsapp-bindings', conversationId],
    queryFn: conversationId === null || !enabled ? skipToken : ({ signal }) => api.listWhatsappBindings(familyId, conversationId, signal),
    staleTime: 5_000,
    refetchInterval: 5_000,
  })

export const channelMemoryQuery = (familyId: FamilyId, channelId: ChannelId | null) =>
  queryOptions({ queryKey: ['families', familyId, 'channel-memory', channelId], queryFn: channelId === null ? skipToken : ({ signal }) => api.getChannelMemory(familyId, channelId, signal), staleTime: 30_000 })

export const channelFilesQuery = (familyId: FamilyId, channelId: ChannelId | null) =>
  queryOptions({ queryKey: ['families', familyId, 'channel-files', channelId], queryFn: channelId === null ? skipToken : ({ signal }) => api.listChannelFiles(familyId, channelId, signal), staleTime: minute })

export const messagesQuery = (familyId: FamilyId, conversationId: ConversationId | null, running = false) =>
  queryOptions({ queryKey: ['families', familyId, 'messages', conversationId], queryFn: conversationId === null ? skipToken : ({ signal }) => api.listMessages(familyId, conversationId, signal), staleTime: 10_000, refetchInterval: running ? 1_000 : false })

export const activeRunQuery = (familyId: FamilyId, conversationId: ConversationId | null, queryClient?: QueryClient) =>
  queryOptions({
    queryKey: ['families', familyId, 'active-run', conversationId],
    queryFn: conversationId === null ? skipToken : async ({ signal }) => {
      const run = await api.getActiveRun(familyId, conversationId, signal)
      if (run === null && queryClient !== undefined)
        await queryClient.invalidateQueries({ queryKey: messagesQuery(familyId, conversationId).queryKey, exact: true })
      return run
    },
    staleTime: 0,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'running' || status === 'waiting_for_approval'
        ? 2_000
        : false
    },
  })
