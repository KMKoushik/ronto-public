import {
  ArrowRightIcon,
  ArrowDownTrayIcon,
  Bars3Icon,
  ChatBubbleLeftRightIcon,
  CheckIcon,
  ClipboardDocumentIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  DocumentIcon,
  EyeIcon,
  ArrowRightStartOnRectangleIcon,
  BookOpenIcon,
  PaperClipIcon,
  PaperAirplaneIcon,
  PlusIcon,
  LockClosedIcon,
  StopIcon,
  TrashIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/16/solid'
import type {
  ChannelDto,
  ChannelId,
  ChannelMemoryDto,
  ConversationDto,
  ConversationId,
  FamilyId,
  FamilyMemberProfileDto,
  MeDto,
  InvitationInput,
  MessageDto,
} from '@ronto/api'
import { DateTime } from 'effect'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Navigate } from '@tanstack/react-router'
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  type UIEvent,
  type WheelEvent,
  lazy,
  Suspense,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from 'react'

import { Button } from '@/components/ui/button'
import { PlatformAdministration } from '@/components/platform-administration'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { api, ApiError, TurnCancelledError } from '@/lib/api'
import type { ChannelFile, TurnEvent } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import {
  activeRunQuery,
  channelFilesQuery,
  channelMemoryQuery,
  channelsQuery,
  connectorProvidersQuery,
  connectorApprovalsQuery,
  connectorsQuery,
  conversationsQuery,
  familyMemoryQuery,
  familyMembersQuery,
  meQuery,
  memberProfilesQuery,
  messagesQuery,
  whatsappBindingsQuery,
  whatsappHealthQuery,
  whatsappDmFamiliesQuery,
  whatsappIdentitiesQuery,
} from '@/lib/queries'
import { cn } from '@/lib/utils'
import { useAppNavigate, useAppSearch } from '@/routes'

type AuthMode = 'sign-in' | 'sign-up'
type MemoryScope = 'family' | 'channel'
const MarkdownContent = lazy(() => import('@/components/markdown-content'))

type WorkActivity =
  | {
      readonly type: 'thinking'
      readonly thinking: string
      readonly redacted?: boolean
    }
  | {
      readonly type: 'tool'
      readonly toolCallId: string
      readonly name: string
      readonly argumentsJson: string
      readonly resultJson: string
      readonly isError: boolean
      readonly running?: boolean
    }

function Brand({ inverse = false }: { inverse?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <div className={cn(
        'grid size-7 shrink-0 place-items-center rounded-full text-sm font-semibold',
        inverse ? 'bg-cat-text text-cat-crust' : 'bg-cat-mauve text-cat-crust',
      )}>
        R
      </div>
      <p className="text-base font-semibold tracking-tight text-cat-text">Ronto</p>
    </div>
  )
}

function AuthScreen({ onAuthenticated, invitation }: { onAuthenticated: () => Promise<void>; invitation: typeof InvitationInput.Type | undefined }) {
  const validated = useQuery({
    queryKey: ['invitation-valid', invitation],
    queryFn: ({ signal }) => invitation ? api.validateInvitation(invitation, signal) : Promise.reject(new Error('Invitation missing')),
    enabled: invitation !== undefined,
    retry: false,
    staleTime: 0,
  })
  const hasInvite = invitation !== undefined && validated.isSuccess
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (mode === 'sign-up' && !hasInvite) {
      setError('A valid invitation is required.')
      return
    }
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')
    const name = String(form.get('name') ?? '')
    setPending(true)
    setError(null)

    const result =
      mode === 'sign-up' && hasInvite
        ? await authClient.signUp.email({ email, password, name }, { headers: {
          'x-ronto-invitation-kind': invitation.kind,
          'x-ronto-invitation-token': invitation.token,
        } })
        : await authClient.signIn.email({ email, password })

    if (result.error) {
      setError(result.error.message ?? 'Unable to continue. Please try again.')
      setPending(false)
      return
    }
    await onAuthenticated()
  }

  return (
    <main className="isolate grid min-h-dvh bg-cat-base lg:grid-cols-[9fr_11fr]">
      <section className="flex min-w-0 flex-col justify-between gap-16 bg-cat-crust p-6 text-cat-text sm:p-10 lg:p-14">
        <Brand inverse />
        <div className="flex max-w-[36rem] flex-col gap-5">
          <p className="font-mono text-sm tracking-wide text-cat-peach">PRIVATE FAMILY SPACE</p>
          <h1 className="text-balance text-4xl font-medium tracking-tight sm:text-5xl lg:text-6xl">
            Keep the family thread together.
          </h1>
          <p className="max-w-[48ch] text-pretty text-base/7 text-cat-subtext-0 sm:text-sm/6">
            Ronto is one quiet place for plans, questions, and the details everyone
            needs to remember.
          </p>
        </div>
        <p className="text-base text-cat-subtext-0 sm:text-sm">Private by design. Just your family and Ronto.</p>
      </section>

      <section className="flex min-w-0 items-center justify-center p-6 sm:p-10">
        <div className="flex w-full max-w-xs flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="text-balance text-2xl font-semibold tracking-tight text-cat-text">
              {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="text-pretty text-base/7 text-cat-subtext-0 sm:text-sm/6">
              {mode === 'sign-in'
                ? hasInvite ? 'Sign in to join your family on Ronto.' : 'Sign in to pick up where your family left off.'
                 : 'Create an account to accept your invitation.'}
            </p>
          </div>

          <form className="flex flex-col gap-5" onSubmit={submit}>
            {mode === 'sign-up' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="name" className="text-base font-medium text-cat-subtext-1 sm:text-sm">
                  Name
                </label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-base font-medium text-cat-subtext-1 sm:text-sm">
                Email
              </label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-base font-medium text-cat-subtext-1 sm:text-sm">
                Password
              </label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={mode === 'sign-in' ? 'current-password' : 'new-password'}
                minLength={8}
                required
              />
            </div>
            {error && (
              <p role="alert" className="text-pretty text-base/7 text-cat-red sm:text-sm/6">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Please wait' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
              {!pending && <ArrowRightIcon className="size-4 shrink-0 fill-current" />}
            </Button>
          </form>

          {invitation && validated.isError && <p role="alert" className="text-sm text-cat-red">This invitation is unavailable. You can still sign in to your existing account.</p>}
          {hasInvite || mode === 'sign-up' ? <p className="text-base/7 text-cat-subtext-0 sm:text-sm/6">
            {mode === 'sign-in' ? 'New to Ronto?' : 'Already have an account?'}{' '}
            <button
              type="button"
              className="font-medium text-cat-text underline decoration-cat-overlay-0 underline-offset-4 hover:decoration-cat-mauve focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-lavender"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                setError(null)
              }}
            >
              {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
            </button>
          </p> : <p className="text-sm/6 text-cat-subtext-0">An invitation is required to create an account.</p>}
        </div>
      </section>
    </main>
  )
}

type FamilyMember = Awaited<ReturnType<typeof api.listFamilyMembers>>[number]
type WhatsappHealth = Awaited<ReturnType<typeof api.getWhatsappHealth>>
type WhatsappIdentity = Awaited<ReturnType<typeof api.listWhatsappIdentities>>[number]
type WhatsappDmFamily = Awaited<ReturnType<typeof api.listWhatsappDmFamilies>>[number]
type WhatsappBinding = Awaited<ReturnType<typeof api.listWhatsappBindings>>[number]
type Connector = Awaited<ReturnType<typeof api.listConnectors>>[number]

function connectorName(service: string) {
  return service
    .split(/[-_]/)
    .map((part) => part.length === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

function ConnectorsDialog({ familyId, onClose }: { familyId: FamilyId; onClose: () => void }) {
  const queryClient = useQueryClient()
  const connectors = useQuery(connectorsQuery(familyId))
  const providers = useQuery(connectorProvidersQuery(familyId))
  const [selectedService, setSelectedService] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const start = useMutation({ mutationFn: ({ service, scopes }: { service: string; scopes: ReadonlyArray<string> }) => api.startConnectorOAuth(familyId, service, scopes) })
  const reconcile = useMutation({ mutationFn: (connectionId: string) => api.reconcileConnector(familyId, connectionId) })
  const disconnect = useMutation({ mutationFn: (connectionId: string) => api.disconnectConnector(familyId, connectionId) })
  const pending = start.isPending || reconcile.isPending || disconnect.isPending
  const provider = providers.data?.find(({ service }) => service === selectedService)

  function selectProvider(service: string) {
    setSelectedService(service)
    setError(null)
    setNotice(null)
  }

  async function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!provider || provider.scopes.length === 0) return
    setError(null); setNotice(null)
    const consentWindow = window.open('', '_blank', 'popup,width=640,height=760')
    if (consentWindow === null) {
      setError('Your browser blocked the consent window. Allow pop-ups, then try again.')
      return
    }
    try {
      const authorization = await start.mutateAsync({ service: provider.service, scopes: provider.scopes })
      await queryClient.invalidateQueries({ queryKey: connectorsQuery(familyId).queryKey })
      consentWindow.location.replace(authorization.authorizationUrl)
      setNotice('Complete provider consent in the new window, then choose Check connection.')
    } catch (cause) {
      consentWindow?.close()
      setError(cause instanceof Error ? cause.message : 'Unable to start provider consent.')
    }
  }

  async function checkConnection(connection: Connector) {
    setError(null); setNotice(null)
    try {
      const updated = await reconcile.mutateAsync(connection.id)
      await queryClient.invalidateQueries({ queryKey: connectorsQuery(familyId).queryKey })
      setNotice(updated.status === 'active' ? `${connectorName(updated.service)} is connected.` : 'Consent has not completed yet.')
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to check the connection.') }
  }

  async function removeConnection(connection: Connector) {
    if (!window.confirm(`Disconnect ${connectorName(connection.service)}? Ronto will immediately lose access.`)) return
    setError(null); setNotice(null)
    try {
      await disconnect.mutateAsync(connection.id)
      await queryClient.invalidateQueries({ queryKey: connectorsQuery(familyId).queryKey })
      setNotice(`${connectorName(connection.service)} was disconnected.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to disconnect the account.') }
  }

  const queryError = [connectors.error, providers.error]
    .map((cause) => cause instanceof Error ? cause.message : null)
    .find((message) => message !== null)

  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-cat-crust/70 p-0 sm:items-center sm:p-6" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
    <section role="dialog" aria-modal="true" aria-labelledby="connectors-title" className="flex max-h-[95dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-cat-mantle ring-1 ring-cat-surface-1 sm:max-h-[88dvh] sm:rounded-2xl">
      <header className="flex items-start justify-between gap-4 border-b border-cat-surface-0 p-5 sm:p-6"><div><h2 id="connectors-title" className="text-xl font-semibold text-cat-text">Connected accounts</h2><p className="mt-1 text-sm/6 text-cat-subtext-0">Connect an account for your use only. Ronto never shares it with other family members.</p></div><Button autoFocus type="button" variant="ghost" size="icon" aria-label="Close connected accounts" onClick={onClose}><XMarkIcon className="size-4" /></Button></header>
      <div className="overflow-y-auto p-5 sm:p-6">
        <div className="flex flex-col gap-3">{connectors.data?.map((connection) => <div key={connection.id} className="rounded-xl bg-cat-base p-4 ring-1 ring-cat-surface-1"><div className="flex items-center justify-between gap-3"><div><p className="font-medium text-cat-text">{connectorName(connection.service)}</p><p className={cn('mt-1 text-xs font-medium', connection.status === 'active' ? 'text-cat-green' : connection.status === 'failed' ? 'text-cat-red' : 'text-cat-yellow')}>{connection.status === 'active' ? 'Connected' : connection.status === 'pending' ? 'Waiting for consent' : connection.status === 'disconnecting' ? 'Disconnecting' : 'Setup failed'}</p></div><div className="flex gap-2">{connection.status === 'pending' && <Button type="button" variant="outline" size="compact" disabled={pending} onClick={() => void checkConnection(connection)}>Check connection</Button>}<Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => void removeConnection(connection)}>Disconnect</Button></div></div></div>)}{connectors.isPending && <p className="text-sm text-cat-subtext-0">Loading connected accounts...</p>}{connectors.data?.length === 0 && <p className="text-sm text-cat-subtext-0">No accounts connected yet.</p>}</div>
        <form className="mt-6 flex flex-col gap-4 border-t border-cat-surface-0 pt-6" onSubmit={connect}>
          <div><label htmlFor="connector-provider" className="text-sm font-medium text-cat-subtext-1">Provider</label><select id="connector-provider" className="mt-2 min-h-11 w-full rounded-md bg-cat-base px-3 text-cat-text ring-1 ring-cat-surface-1 focus-visible:outline-2 focus-visible:outline-cat-lavender" value={selectedService} disabled={pending || providers.isPending} onChange={(event) => selectProvider(event.target.value)}><option value="">Choose a provider</option>{providers.data?.map(({ service }) => <option key={service} value={service}>{connectorName(service)}</option>)}</select></div>
          <Button type="submit" variant="primary" className="min-h-11 self-start" disabled={pending || !provider || provider.scopes.length === 0}>Continue to provider consent</Button>
        </form>
        {notice && <p role="status" className="mt-4 text-sm text-cat-peach">{notice}</p>}
        {(error ?? queryError) && <p role="alert" className="mt-4 text-sm text-cat-red">{error ?? queryError}</p>}
      </div>
    </section>
  </div>
}

function FamilyDialog({ familyId, channels, onClose }: { familyId: FamilyId; channels: ReadonlyArray<ChannelDto>; onClose: () => void }) {
  const queryClient = useQueryClient()
  const membersQuery = useQuery(familyMembersQuery(familyId))
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [inviteLink, setInviteLink] = useState<{
    url: string
    role: 'member' | 'primary'
    expiresAt: string
  } | null>(null)
  const createInviteMutation = useMutation({ mutationFn: (role: 'member' | 'primary') => api.createFamilyInvite(familyId, role) })
  const accessMutation = useMutation({
    mutationFn: ({ channelId, member, active }: { channelId: ChannelId; member: FamilyMember; active: boolean }) =>
      api.setChannelMemberAccess(familyId, channelId, member.id, active),
    onSuccess: (updated) => queryClient.setQueryData<ReadonlyArray<FamilyMember>>(
      familyMembersQuery(familyId).queryKey,
      (current = []) => current.map((candidate) => candidate.id === updated.id ? updated : candidate),
    ),
  })
  const pending = createInviteMutation.isPending || accessMutation.isPending
  const members = membersQuery.data ?? []

  async function createInvite(role: 'member' | 'primary') {
    setError(null); setNotice(null)
    try {
      const invite = await createInviteMutation.mutateAsync(role)
      const url = new URL('/', window.location.origin)
      url.searchParams.set('invite', invite.token)
      setInviteLink({
        url: url.toString(),
        role,
        expiresAt: DateTime.toDate(invite.expiresAt).toLocaleDateString(),
      })
      setNotice(`${role === 'primary' ? 'Primary' : 'Member'} link created.`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create invite link.') }
  }

  async function copyInvite() {
    if (!inviteLink) return
    try {
      await navigator.clipboard.writeText(inviteLink.url)
      setNotice('Invite link copied.')
      setError(null)
    } catch {
      setNotice(null)
      setError('Clipboard access failed. Select and copy the visible link instead.')
    }
  }

  async function setAccess(channelId: ChannelId, member: FamilyMember, active: boolean) {
    setError(null)
    try {
      await accessMutation.mutateAsync({ channelId, member, active })
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to update channel access.') }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-cat-crust/70 p-0 sm:items-center sm:p-6" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="family-title" className="flex max-h-[92dvh] w-full max-w-3xl flex-col gap-5 overflow-y-auto bg-cat-mantle p-5 ring-1 ring-cat-surface-1 sm:max-h-[85dvh] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="family-title" className="text-xl font-semibold text-cat-text">Manage family</h2><p className="text-sm text-cat-subtext-0">Invite people and choose which channels members can access.</p></div><Button autoFocus type="button" variant="ghost" size="icon" aria-label="Close family management" onClick={onClose}><XMarkIcon className="size-4" /></Button></div>
        <div className="flex flex-wrap gap-2"><Button className="min-h-11" type="button" variant="secondary" disabled={pending} onClick={() => void createInvite('member')}><UserGroupIcon className="size-4" /> Create member link</Button><Button className="min-h-11" type="button" variant="secondary" disabled={pending} onClick={() => void createInvite('primary')}><UserGroupIcon className="size-4" /> Create primary link</Button></div>
        {inviteLink && <div className="flex flex-col gap-2 rounded-xl bg-cat-surface-0 p-4 ring-1 ring-cat-surface-1"><label htmlFor="family-invite-link" className="text-sm font-medium text-cat-subtext-1">{inviteLink.role === 'primary' ? 'Primary' : 'Member'} invite, expires {inviteLink.expiresAt}</label><div className="flex flex-col gap-2 sm:flex-row"><Input id="family-invite-link" value={inviteLink.url} readOnly onFocus={(event) => event.currentTarget.select()} /><Button className="min-h-11 shrink-0" type="button" variant="outline" onClick={() => void copyInvite()}><ClipboardDocumentIcon className="size-4" /> Copy link</Button></div></div>}
        {notice && <p role="status" className="text-sm text-cat-peach">{notice}</p>}
        {(error ?? (membersQuery.error instanceof Error ? membersQuery.error.message : null)) && <p role="alert" className="text-sm text-cat-red">{error ?? (membersQuery.error instanceof Error ? membersQuery.error.message : 'Unable to load family members.')}</p>}
        <div className="flex flex-col gap-3">{members.map((member) => { const primary = member.role === 'primary'; return <div key={member.id} className="rounded-xl bg-cat-surface-0 p-4 ring-1 ring-cat-surface-1"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate font-medium text-cat-text">{member.name}</p><p className="truncate text-sm text-cat-subtext-0">{member.email}</p></div><span className="shrink-0 text-xs uppercase tracking-wide text-cat-peach">{member.role}</span></div><div className="mt-3 flex flex-col gap-2"><p className="text-sm font-medium text-cat-subtext-1">Channel access</p>{channels.map((channel) => { const checked = channel.isDefault || member.channelIds.includes(channel.id); return primary ? <div key={channel.id} className="flex min-h-11 items-center gap-3 text-sm text-cat-subtext-0"><span className="size-1.5 rounded-full bg-cat-peach" />{channel.name}{channel.isDefault && <span className="text-xs text-cat-overlay-1">Always included</span>}</div> : <label key={channel.id} className="flex min-h-11 items-center gap-3 text-sm text-cat-subtext-0"><input type="checkbox" className="size-4 accent-cat-mauve" checked={checked} disabled={channel.isDefault || pending} onChange={(event) => void setAccess(channel.id, member, event.target.checked)} /><span>{channel.name}{channel.isDefault && <span className="ml-2 text-xs text-cat-overlay-1">Always included</span>}</span></label> })}</div></div> })}{membersQuery.isPending && <p className="text-sm text-cat-subtext-0">Loading family members...</p>}</div>
      </section>
    </div>
  )
}

function WhatsappNumberStep({ status, numberLinked, whatsappAvailable }: {
  status: WhatsappHealth['status'] | undefined
  numberLinked: boolean
  whatsappAvailable: boolean
}) {
  return (
    <li className={cn('rounded-2xl bg-cat-base p-4 ring-1 sm:p-5', numberLinked ? 'ring-cat-green/40' : 'ring-cat-surface-1')}>
      <section aria-labelledby="whatsapp-step-number">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold', numberLinked ? 'bg-cat-green text-cat-crust' : 'bg-cat-surface-1 text-cat-text')} aria-hidden="true">
            {numberLinked ? <CheckIcon className="size-4" /> : '1'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="whatsapp-step-number" className="font-semibold text-cat-text">Connect Ronto's number</h3>
              {numberLinked && <span className="text-xs font-medium text-cat-green">Complete</span>}
            </div>
            <p className="mt-1 text-sm/6 text-cat-subtext-0">Use a dedicated WhatsApp number for Ronto, not a family member's personal account.</p>

            {status === 'disabled' ? (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-cat-surface-0 p-3 text-sm/6 text-cat-subtext-0">
                <LockClosedIcon className="mt-1 size-4 shrink-0 fill-cat-overlay-1" />
                WhatsApp is switched off on the Ronto server. It must be enabled before setup can continue.
              </div>
            ) : numberLinked ? (
              <p className={cn('mt-4 rounded-xl p-3 text-sm/6', whatsappAvailable ? 'bg-cat-green/10 text-cat-green' : 'bg-cat-yellow/10 text-cat-yellow')}>
                {whatsappAvailable ? 'Ronto is connected and ready to receive messages.' : 'The number is linked. Wait for Ronto to finish reconnecting.'}
              </p>
            ) : (
              <div className="mt-4 flex items-start gap-2 rounded-xl bg-cat-surface-0 p-3 text-sm/6 text-cat-subtext-0">
                <LockClosedIcon className="mt-1 size-4 shrink-0 fill-cat-overlay-1" />
                The platform administrator needs to connect Ronto's number in Platform administration first.
              </div>
            )}
          </div>
        </div>
      </section>
    </li>
  )
}

function WhatsappIdentityStep({ identities, loading, identityLinked, numberLinked, whatsappAvailable, pending, identityCommand, onCreateCode, onCopy, onRevoke }: {
  identities: ReadonlyArray<WhatsappIdentity> | undefined
  loading: boolean
  identityLinked: boolean
  numberLinked: boolean
  whatsappAvailable: boolean
  pending: boolean
  identityCommand: string | null
  onCreateCode: () => Promise<void>
  onCopy: (value: string) => Promise<void>
  onRevoke: (identityId: string) => Promise<void>
}) {
  return (
    <li className={cn('rounded-2xl bg-cat-base p-4 ring-1 sm:p-5', identityLinked ? 'ring-cat-green/40' : 'ring-cat-surface-1')}>
      <section aria-labelledby="whatsapp-step-identity">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold', identityLinked ? 'bg-cat-green text-cat-crust' : numberLinked ? 'bg-cat-mauve text-cat-crust' : 'bg-cat-surface-1 text-cat-overlay-1')} aria-hidden="true">
            {identityLinked ? <CheckIcon className="size-4" /> : '2'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="whatsapp-step-identity" className="font-semibold text-cat-text">Link your WhatsApp</h3>
              {identityLinked && <span className="text-xs font-medium text-cat-green">Complete</span>}
            </div>
            <p className="mt-1 text-sm/6 text-cat-subtext-0">This lets Ronto recognize your messages. Each family member completes this step once.</p>

            {loading ? <p className="mt-4 text-sm text-cat-subtext-0">Checking linked identities...</p> : <div className="mt-4 flex flex-col gap-2">{identities?.map((identity) => <div key={identity.id} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-cat-surface-0 px-3 ring-1 ring-cat-surface-1"><span className="flex min-w-0 items-center gap-2 text-sm text-cat-subtext-1"><CheckIcon className="size-4 shrink-0 fill-cat-green" /><span className="truncate">{identity.displayName ?? identity.externalUserId}</span></span><Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => void onRevoke(identity.id)}>Unlink</Button></div>)}</div>}

            {whatsappAvailable ? <div className="mt-4 flex flex-col gap-3"><Button type="button" variant={identityLinked ? 'outline' : 'primary'} className="min-h-11 self-start" disabled={pending} onClick={() => void onCreateCode()}>{identityLinked ? 'Link another number' : 'Create link command'}</Button>{identityCommand && <div className="flex flex-col gap-2 rounded-xl bg-cat-surface-0 p-4 ring-1 ring-cat-surface-1"><label htmlFor="whatsapp-identity-command" className="text-sm/6 font-medium text-cat-subtext-1">Send this command in a private message to Ronto within 15 minutes</label><div className="flex flex-col gap-2 sm:flex-row"><Input id="whatsapp-identity-command" value={identityCommand} readOnly onFocus={(event) => event.currentTarget.select()} /><Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={() => void onCopy(identityCommand)}><ClipboardDocumentIcon className="size-4" /> Copy command</Button></div><p className="text-xs/5 text-cat-overlay-1">This screen updates automatically after Ronto confirms the command.</p></div>}</div> : !identityLinked && <div className="mt-4 flex items-start gap-2 rounded-xl bg-cat-surface-0 p-3 text-sm/6 text-cat-subtext-0"><LockClosedIcon className="mt-1 size-4 shrink-0 fill-cat-overlay-1" />{numberLinked ? 'Wait for Ronto to reconnect before linking your identity.' : 'Complete step 1 before linking your identity.'}</div>}
          </div>
        </div>
      </section>
    </li>
  )
}

function WhatsappDmFamilyStep({ familyId, families, loading, identityLinked, pending, onSelect }: {
  familyId: FamilyId
  families: ReadonlyArray<WhatsappDmFamily> | undefined
  loading: boolean
  identityLinked: boolean
  pending: boolean
  onSelect: () => Promise<void>
}) {
  const selected = families?.find((family) => family.selected)
  const current = families?.find((family) => family.familyId === familyId)
  const activeHere = selected?.familyId === familyId
  return (
    <li className={cn('rounded-2xl bg-cat-base p-4 ring-1 sm:p-5', activeHere ? 'ring-cat-green/40' : 'ring-cat-surface-1')}>
      <section aria-labelledby="whatsapp-step-dm-family">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold', activeHere ? 'bg-cat-green text-cat-crust' : identityLinked ? 'bg-cat-mauve text-cat-crust' : 'bg-cat-surface-1 text-cat-overlay-1')} aria-hidden="true">{activeHere ? <CheckIcon className="size-4" /> : '3'}</span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h3 id="whatsapp-step-dm-family" className="font-semibold text-cat-text">Choose the family for WhatsApp DMs</h3>{activeHere && <span className="text-xs font-medium text-cat-green">Active here</span>}</div>
            <p className="mt-1 text-sm/6 text-cat-subtext-0">Private WhatsApp messages use one family at a time. Group chats keep their own family session.</p>
            {loading ? <p className="mt-4 text-sm text-cat-subtext-0">Checking the active DM family...</p> : identityLinked ? <div className="mt-4 flex flex-col gap-3 rounded-xl bg-cat-surface-0 p-3 ring-1 ring-cat-surface-1"><p className="text-sm text-cat-subtext-1">Current DM family: <span className="font-medium text-cat-text">{selected?.familyName ?? 'Not selected'}</span></p>{!activeHere && <Button type="button" variant="primary" className="min-h-11 self-start" disabled={pending || current === undefined} onClick={() => void onSelect()}>Use {current?.familyName ?? 'this family'} for DMs</Button>}<p className="text-xs/5 text-cat-overlay-1">In WhatsApp, use <code>/ronto families</code> or <code>/ronto family &lt;code&gt;</code> to switch without opening the web app.</p></div> : <div className="mt-4 flex items-start gap-2 rounded-xl bg-cat-surface-0 p-3 text-sm/6 text-cat-subtext-0"><LockClosedIcon className="mt-1 size-4 shrink-0 fill-cat-overlay-1" />Link your WhatsApp identity first.</div>}
          </div>
        </div>
      </section>
    </li>
  )
}

function WhatsappChatStep({ conversationId, isPrimary, bindings, loading, chatLinked, identityLinked, whatsappAvailable, pending, bindingCommand, onCreateCode, onCopy, onRemove }: {
  conversationId: ConversationId | null
  isPrimary: boolean
  bindings: ReadonlyArray<WhatsappBinding> | undefined
  loading: boolean
  chatLinked: boolean
  identityLinked: boolean
  whatsappAvailable: boolean
  pending: boolean
  bindingCommand: string | null
  onCreateCode: () => Promise<void>
  onCopy: (value: string) => Promise<void>
  onRemove: (bindingId: string) => Promise<void>
}) {
  return (
    <li className={cn('rounded-2xl bg-cat-base p-4 ring-1 sm:p-5', chatLinked ? 'ring-cat-green/40' : 'ring-cat-surface-1')}>
      <section aria-labelledby="whatsapp-step-chat">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold', chatLinked ? 'bg-cat-green text-cat-crust' : whatsappAvailable && identityLinked && isPrimary ? 'bg-cat-mauve text-cat-crust' : 'bg-cat-surface-1 text-cat-overlay-1')} aria-hidden="true">
            {chatLinked ? <CheckIcon className="size-4" /> : '4'}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="whatsapp-step-chat" className="font-semibold text-cat-text">Use Ronto in a WhatsApp group</h3>
              {chatLinked ? <span className="text-xs font-medium text-cat-green">Complete</span> : !isPrimary && <span className="text-xs font-medium text-cat-overlay-1">Primary only</span>}
            </div>
            <p className="mt-1 text-sm/6 text-cat-subtext-0">Create the group, add Ronto, then mention Ronto. The channel is created and linked automatically.</p>
            <p className="mt-2 text-xs/5 text-cat-overlay-1">Everyone in a connected group can invoke Ronto with this session's context, files, and channel tools. Connect only groups whose current and future participants you trust.</p>

            {isPrimary && loading && conversationId !== null ? <p className="mt-4 text-sm text-cat-subtext-0">Checking connected chats...</p> : <div className="mt-4 flex flex-col gap-2">{bindings?.map((binding) => <div key={binding.id} className="flex min-h-11 items-center justify-between gap-3 rounded-xl bg-cat-surface-0 px-3 ring-1 ring-cat-surface-1"><span className="min-w-0"><span className="block text-sm font-medium text-cat-subtext-1">Connected WhatsApp chat</span><span className="block truncate font-mono text-xs text-cat-overlay-1">{binding.externalChannelId}</span></span><Button type="button" variant="ghost" size="compact" disabled={pending} onClick={() => void onRemove(binding.id)}>Remove</Button></div>)}</div>}

            {!isPrimary ? <div className="mt-4 flex items-start gap-2 rounded-xl bg-cat-surface-0 p-3 text-sm/6 text-cat-subtext-0"><LockClosedIcon className="mt-1 size-4 shrink-0 fill-cat-overlay-1" />A linked primary family member must mention Ronto to create the channel.</div> : conversationId === null ? null : whatsappAvailable && identityLinked ? <div className="mt-4 flex flex-col gap-3"><Button type="button" variant="outline" className="min-h-11 self-start" disabled={pending} onClick={() => void onCreateCode()}>Link this existing session instead</Button>{bindingCommand && <div className="flex flex-col gap-2 rounded-xl bg-cat-surface-0 p-4 ring-1 ring-cat-surface-1"><label htmlFor="whatsapp-binding-command" className="text-sm/6 font-medium text-cat-subtext-1">Post this command in the WhatsApp chat within 15 minutes</label><div className="flex flex-col gap-2 sm:flex-row"><Input id="whatsapp-binding-command" value={bindingCommand} readOnly onFocus={(event) => event.currentTarget.select()} /><Button type="button" variant="outline" className="min-h-11 shrink-0" onClick={() => void onCopy(bindingCommand)}><ClipboardDocumentIcon className="size-4" /> Copy command</Button></div><p className="text-xs/5 text-cat-overlay-1">Everyone in that chat will use the selected Ronto session.</p></div>}</div> : !chatLinked && <div className="mt-4 flex items-start gap-2 rounded-xl bg-cat-surface-0 p-3 text-sm/6 text-cat-subtext-0"><LockClosedIcon className="mt-1 size-4 shrink-0 fill-cat-overlay-1" />{!identityLinked ? 'Complete step 2 before using Ronto in a group.' : 'Wait for Ronto to reconnect before using it in a group.'}</div>}
          </div>
        </div>
      </section>
    </li>
  )
}

function WhatsappDialog({ familyId, conversationId, isPrimary, onClose }: {
  familyId: FamilyId
  conversationId: ConversationId | null
  isPrimary: boolean
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const health = useQuery(whatsappHealthQuery(familyId))
  const identities = useQuery(whatsappIdentitiesQuery(familyId))
  const dmFamilies = useQuery(whatsappDmFamiliesQuery(familyId))
  const bindings = useQuery(whatsappBindingsQuery(familyId, conversationId, isPrimary))
  const [identityCommand, setIdentityCommand] = useState<string | null>(null)
  const [bindingCommand, setBindingCommand] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const identityClaim = useMutation({ mutationFn: () => api.createWhatsappIdentityClaim(familyId) })
  const bindingClaim = useMutation({ mutationFn: (conversationId: ConversationId) => api.createWhatsappBindingClaim(familyId, conversationId) })
  const revokeIdentity = useMutation({ mutationFn: (identityId: string) => api.revokeWhatsappIdentity(familyId, identityId) })
  const selectDmFamily = useMutation({ mutationFn: () => api.selectWhatsappDmFamily(familyId) })
  const removeBinding = useMutation({
    mutationFn: ({ selected, id }: { selected: ConversationId; id: string }) => api.removeWhatsappBinding(familyId, selected, id),
  })
  const pending = identityClaim.isPending || bindingClaim.isPending || revokeIdentity.isPending || selectDmFamily.isPending || removeBinding.isPending
  const status = health.data?.status
  const numberLinked = status === 'connected' || status === 'connecting' || status === 'reconnecting'
  const whatsappAvailable = status === 'connected'
  const identityLinked = (identities.data?.length ?? 0) > 0
  const chatLinked = (bindings.data?.length ?? 0) > 0
  const dmActiveHere = dmFamilies.data?.some((family) => family.familyId === familyId && family.selected) ?? false
  const completedSteps = Number(numberLinked) + Number(identityLinked) + Number(dmActiveHere) + (isPrimary ? Number(chatLinked) : 0)
  const totalSteps = isPrimary ? 4 : 3
  const statusLabel = status === 'connected' ? 'Connected'
    : status === 'connecting' ? 'Connecting'
    : status === 'reconnecting' ? 'Reconnecting'
    : status === 'pairing' ? 'Ready to pair'
    : status === 'logged_out' ? 'Needs pairing'
    : status === 'disabled' ? 'Unavailable'
    : 'Checking'
  const statusColor = status === 'connected' ? 'bg-cat-green'
    : status === 'disabled' || status === 'logged_out' ? 'bg-cat-red'
    : 'bg-cat-yellow'

  async function copy(value: string) {
    try {
      await navigator.clipboard.writeText(value)
      setNotice('Copied to clipboard.')
      setError(null)
    } catch {
      setNotice(null)
      setError('Clipboard access failed. Select and copy the visible value instead.')
    }
  }

  async function createIdentityCode() {
    setError(null); setNotice(null)
    try {
      const claim = await identityClaim.mutateAsync()
      setIdentityCommand(`/ronto link ${claim.token}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create an identity code.') }
  }

  async function createBindingCode() {
    if (conversationId === null) return
    setError(null); setNotice(null)
    try {
      const claim = await bindingClaim.mutateAsync(conversationId)
      setBindingCommand(`/ronto bind ${claim.token}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create a binding code.') }
  }

  async function unlinkIdentity(identityId: string) {
    try {
      await revokeIdentity.mutateAsync(identityId)
      await queryClient.invalidateQueries({ queryKey: whatsappIdentitiesQuery(familyId).queryKey })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to unlink identity.')
    }
  }

  async function disconnectChat(bindingId: string) {
    if (conversationId === null) return
    try {
      await removeBinding.mutateAsync({ selected: conversationId, id: bindingId })
      await queryClient.invalidateQueries({ queryKey: whatsappBindingsQuery(familyId, conversationId, true).queryKey })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to remove binding.')
    }
  }

  async function chooseDmFamily() {
    try {
      await selectDmFamily.mutateAsync()
      await queryClient.invalidateQueries({ queryKey: ['families'] })
      setNotice('WhatsApp DMs now use this family.')
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to change the WhatsApp DM family.')
    }
  }

  const queryError = [health.error, identities.error, dmFamilies.error, bindings.error]
    .map((cause) => cause instanceof Error ? cause.message : null)
    .find((message) => message !== null)
  const dialogError = error ?? queryError

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-cat-crust/70 p-0 sm:items-center sm:p-6" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="whatsapp-title" aria-describedby="whatsapp-description" className="flex max-h-[95dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-cat-mantle ring-1 ring-cat-surface-1 sm:max-h-[88dvh] sm:rounded-2xl">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-cat-surface-0 p-5 sm:p-6">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-3">
              <h2 id="whatsapp-title" className="text-xl font-semibold tracking-tight text-cat-text">Set up WhatsApp</h2>
              <span className="inline-flex items-center gap-2 rounded-full bg-cat-surface-0 px-2.5 py-1 text-xs font-medium text-cat-subtext-1 ring-1 ring-cat-surface-1" role="status">
                <span className={cn('size-2 rounded-full', statusColor)} aria-hidden="true" />
                {statusLabel}
              </span>
            </div>
            <p id="whatsapp-description" className="max-w-[55ch] text-sm/6 text-cat-subtext-0">
              Complete these steps in order. Ronto only reads chats you connect to a session.
            </p>
          </div>
          <Button autoFocus type="button" variant="ghost" size="icon" className="shrink-0" aria-label="Close WhatsApp settings" onClick={onClose}><XMarkIcon className="size-4" /></Button>
        </header>

        <div className="overflow-y-auto p-5 sm:p-6">
          <div className="mb-5 flex items-center justify-between gap-4 text-sm">
            <p className="font-medium text-cat-subtext-1">Setup progress</p>
            <p className="tabular-nums text-cat-subtext-0">{completedSteps} of {totalSteps} complete</p>
          </div>

          <ol className="flex flex-col gap-4">
            <WhatsappNumberStep status={status} numberLinked={numberLinked} whatsappAvailable={whatsappAvailable} />
            <WhatsappIdentityStep identities={identities.data} loading={identities.isPending} identityLinked={identityLinked} numberLinked={numberLinked} whatsappAvailable={whatsappAvailable} pending={pending} identityCommand={identityCommand} onCreateCode={createIdentityCode} onCopy={copy} onRevoke={unlinkIdentity} />
            <WhatsappDmFamilyStep familyId={familyId} families={dmFamilies.data} loading={dmFamilies.isPending} identityLinked={identityLinked} pending={pending} onSelect={chooseDmFamily} />
            <WhatsappChatStep conversationId={conversationId} isPrimary={isPrimary} bindings={bindings.data} loading={bindings.isPending} chatLinked={chatLinked} identityLinked={identityLinked} whatsappAvailable={whatsappAvailable} pending={pending} bindingCommand={bindingCommand} onCreateCode={createBindingCode} onCopy={copy} onRemove={disconnectChat} />
          </ol>

          {notice && <p role="status" className="mt-4 text-sm text-cat-peach">{notice}</p>}
          {dialogError && <p role="alert" className="mt-4 text-sm text-cat-red">{dialogError}</p>}
        </div>
      </section>
    </div>
  )
}

function OnboardingScreen({ user, onComplete }: { user: MeDto['user']; onComplete: (me: MeDto) => void }) {
  const onboarding = useMutation({ mutationFn: api.onboard, onSuccess: onComplete })

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const familyName = String(new FormData(event.currentTarget).get('familyName') ?? '')
    onboarding.mutate(familyName)
  }

  return (
    <main className="isolate flex min-h-dvh items-center justify-center bg-cat-crust p-6">
      <section className="flex w-full max-w-lg flex-col gap-10 bg-cat-mantle p-7 ring-1 ring-cat-surface-1 sm:p-10">
        <Brand />
        <div className="flex flex-col gap-3">
          <p className="font-mono text-sm tracking-wide text-cat-peach">ONE LAST DETAIL</p>
          <h1 className="text-balance text-3xl font-semibold tracking-tight text-cat-text">
            What does your family call itself?
          </h1>
          <p className="max-w-[52ch] text-pretty text-base/7 text-cat-subtext-0 sm:text-sm/6">
            This names your private shared space. You are setting it up as the primary member, {user.name}.
          </p>
        </div>
        <form className="flex max-w-xs flex-col gap-5" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <label htmlFor="familyName" className="text-base font-medium text-cat-subtext-1 sm:text-sm">
              Family name
            </label>
            <Input
              id="familyName"
              name="familyName"
              placeholder="The Rao family"
              autoFocus
              required
            />
          </div>
          {onboarding.error && <p role="alert" className="text-base/7 text-cat-red sm:text-sm/6">{onboarding.error instanceof Error ? onboarding.error.message : 'Unable to create your family space.'}</p>}
          <Button type="submit" variant="primary" disabled={onboarding.isPending}>
            {onboarding.isPending ? 'Creating space' : 'Continue to Ronto'}
            {!onboarding.isPending && <ArrowRightIcon className="size-4 shrink-0 fill-current" />}
          </Button>
        </form>
      </section>
    </main>
  )
}

function conversationTitle(conversation: ConversationDto) {
  return conversation.title ?? 'Untitled conversation'
}

function Sidebar({ channels, conversations, selectedChannelId, selectedId, workingConversationId, userName, isPrimary, mobileOpen, onClose, onSelectChannel, onSelect, onDelete, onCreateChannel, onCreate, onSignOut, onManageFamily, onManageWhatsapp, onManageConnectors, manageButtonRef, whatsappButtonRef, connectorsButtonRef }: {
  channels: ReadonlyArray<ChannelDto>; conversations: ReadonlyArray<ConversationDto>; selectedChannelId: ChannelId | null; selectedId: ConversationId | null; userName: string; isPrimary: boolean; mobileOpen: boolean; onClose: () => void
  workingConversationId: ConversationId | null
  onSelectChannel: (id: ChannelId) => void; onSelect: (id: ConversationId) => void; onDelete: (id: ConversationId) => Promise<void>; onCreateChannel: (name: string, purpose: string) => Promise<void>; onCreate: () => Promise<void>; onSignOut: () => Promise<void>; onManageFamily: () => void; onManageWhatsapp: () => void; onManageConnectors: () => void; manageButtonRef: RefObject<HTMLButtonElement | null>; whatsappButtonRef: RefObject<HTMLButtonElement | null>; connectorsButtonRef: RefObject<HTMLButtonElement | null>
}) {
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [pending, setPending] = useState(false)
  const [deletingId, setDeletingId] = useState<ConversationId | null>(null)

  async function create() {
    setPending(true)
    try { await onCreate() } catch { /* The parent displays the request error. */ } finally { setPending(false) }
  }
  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setPending(true)
    try { await onCreateChannel(String(form.get('name') ?? ''), String(form.get('purpose') ?? '')); setCreatingChannel(false) } catch { /* The parent displays the request error. */ } finally { setPending(false) }
  }
  async function remove(conversation: ConversationDto) {
    if (!window.confirm(`Delete "${conversationTitle(conversation)}"? This cannot be undone.`)) return
    setDeletingId(conversation.id)
    try { await onDelete(conversation.id) } catch { /* The parent displays the request error. */ } finally { setDeletingId(null) }
  }

  return (
    <>
      {mobileOpen && (
        <button
          type="button"
           aria-label="Close navigation"
          className="fixed inset-0 z-30 cursor-default bg-cat-crust/70 lg:hidden"
          onClick={onClose}
        />
      )}
      <aside
        role={mobileOpen ? 'dialog' : undefined}
           aria-label={mobileOpen ? 'Channel and session navigation' : undefined}
        aria-modal={mobileOpen ? true : undefined}
        className={cn(
          'fixed inset-y-0 left-0 z-40 flex w-[min(21rem,88vw)] flex-col bg-cat-mantle ring-1 ring-cat-surface-1 lg:static lg:z-auto lg:w-80 lg:translate-x-0 lg:ring-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="flex h-16 shrink-0 items-center justify-between p-4 sm:px-5">
          <Brand />
          <Button autoFocus={mobileOpen} type="button" variant="ghost" size="icon" className="lg:hidden" aria-label="Close navigation" onClick={onClose}>
            <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
            <XMarkIcon className="size-4 shrink-0 fill-current" />
          </Button>
        </div>

        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <p className="text-base font-medium text-cat-subtext-0 sm:text-sm">Channels</p>
          <Button type="button" variant="ghost" size="compact" className="pr-2 pl-1.5" onClick={() => setCreatingChannel(true)}><PlusIcon className="size-4 shrink-0 fill-current" /> New</Button>
        </div>
        {creatingChannel && <form className="flex flex-col gap-2 px-4 pb-3 sm:px-5" onSubmit={createChannel}>
          <Input name="name" aria-label="Channel name" placeholder="Channel name" autoFocus required /><Input name="purpose" aria-label="Channel purpose (optional)" placeholder="Purpose (optional)" />
          <Button type="submit" size="compact" disabled={pending}>Create channel</Button>
        </form>}
        <nav className="max-h-[38%] overflow-y-auto px-2" aria-label="Channels"><ul className="flex flex-col gap-1" role="list">{channels.map((channel) => <li key={channel.id}><button type="button" aria-current={selectedChannelId === channel.id ? 'page' : undefined} className={cn('w-full rounded-lg px-3 py-2.5 text-left text-base text-cat-subtext-0 hover:bg-cat-surface-0 hover:text-cat-text focus-visible:outline-2 focus-visible:outline-cat-lavender sm:py-2 sm:text-sm', selectedChannelId === channel.id && 'bg-cat-surface-0 text-cat-text')} onClick={() => onSelectChannel(channel.id)}>{channel.name}</button></li>)}</ul></nav>
        <div className="flex items-center justify-between gap-3 px-4 py-3 sm:px-5">
          <p className="text-base font-medium text-cat-subtext-0 sm:text-sm">Sessions</p>
          <Button type="button" variant="ghost" size="compact" className="pr-2 pl-1.5" onClick={() => void create()} disabled={selectedChannelId === null || pending}>
            <PlusIcon className="size-4 shrink-0 fill-current" />
            New
          </Button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto px-2" aria-label="Sessions">
          {conversations.length === 0 ? (
            <div className="flex flex-col gap-2 px-3 py-8">
              <p className="text-base font-medium text-cat-subtext-1 sm:text-sm">No sessions yet</p>
              <p className="text-pretty text-base/7 text-cat-subtext-0 sm:text-sm/6">Create a session to begin.</p>
            </div>
          ) : (
            <ul className="flex flex-col gap-1" role="list">
              {conversations.map((conversation) => {
                const working = conversation.id === workingConversationId
                return <li key={conversation.id} className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-current={selectedId === conversation.id ? 'page' : undefined}
                    className={cn(
                      'min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left text-base text-cat-subtext-0 hover:bg-cat-surface-0 hover:text-cat-text focus-visible:outline-2 focus-visible:outline-cat-lavender sm:py-2 sm:text-sm',
                      selectedId === conversation.id && 'bg-cat-surface-0 text-cat-text',
                    )}
                    onClick={() => onSelect(conversation.id)}
                  >
                    <span className="line-clamp-1">{conversationTitle(conversation)}</span>
                  </button>
                  {working ? <span role="status" className="grid size-10 shrink-0 place-items-center" aria-label="Generating response">
                    <span className="size-4 animate-spin rounded-full border-2 border-cat-surface-2 border-t-cat-mauve motion-reduce:animate-pulse" aria-hidden="true" />
                  </span> : <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="shrink-0 text-cat-subtext-0 hover:text-cat-red"
                    aria-label={`Delete ${conversationTitle(conversation)}`}
                    disabled={deletingId !== null}
                    onClick={() => void remove(conversation)}
                  >
                    <TrashIcon className="size-4 shrink-0 fill-current" />
                  </Button>}
                </li>
              })}
            </ul>
          )}
        </nav>

         <div className="flex items-center gap-3 border-t border-cat-surface-0 p-4 sm:px-5">
          <div className="grid size-8 shrink-0 place-items-center rounded-full bg-cat-surface-0 text-sm font-medium text-cat-peach">
            {userName.slice(0, 1).toUpperCase()}
          </div>
            <p className="min-w-0 flex-1 truncate text-base font-medium text-cat-text sm:text-sm">{userName}</p>
            <Button ref={connectorsButtonRef} type="button" variant="ghost" size="icon" aria-label="Manage connected accounts" onClick={onManageConnectors}><WrenchScrewdriverIcon className="size-4 shrink-0 fill-current" /></Button>
            <Button ref={whatsappButtonRef} type="button" variant="ghost" size="icon" aria-label="Manage WhatsApp" onClick={onManageWhatsapp}><ChatBubbleLeftRightIcon className="size-4 shrink-0 fill-current" /></Button>
            {isPrimary && <Button ref={manageButtonRef} type="button" variant="ghost" size="icon" aria-label="Manage family" onClick={onManageFamily}><UserGroupIcon className="size-4 shrink-0 fill-current" /></Button>}
          <Button type="button" variant="ghost" size="icon" aria-label="Sign out" onClick={onSignOut}>
            <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
            <ArrowRightStartOnRectangleIcon className="size-4 shrink-0 fill-current" />
          </Button>
        </div>
      </aside>
    </>
  )
}

function messageText(message: MessageDto) {
  return message.content.blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n')
}

function RenderMarkdown({ children, className = 'agent-markdown', streaming = false }: { children: string; className?: string; streaming?: boolean }) {
  return (
    <Suspense fallback={<div className={cn(className, 'whitespace-pre-wrap')}>{children}</div>}>
      <MarkdownContent className={className} streaming={streaming}>{children}</MarkdownContent>
    </Suspense>
  )
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) return 'Worked for <1s'
  const seconds = Math.round(durationMs / 1000)
  if (seconds < 60) return `Worked for ${seconds}s`
  const minutes = Math.floor(seconds / 60)
  return `Worked for ${minutes}m ${seconds % 60}s`
}

function toolLabel(name: string) {
  switch (name) {
    case 'bash': return 'Ran a command'
    case 'edit': return 'Edited a file'
    case 'glob':
    case 'grep': return 'Searched files'
    case 'ls': return 'Listed files'
    case 'read': return 'Read a file'
    case 'write': return 'Wrote a file'
    default: return `Used ${name}`
  }
}

function WorkDisclosureContent({ activity }: { activity: ReadonlyArray<WorkActivity> }) {
  if (activity.length === 0)
    return (
      <div className="flex min-h-11 items-center gap-2 text-xs text-cat-overlay-1">
        <span className="size-1.5 animate-pulse rounded-full bg-cat-mauve" />
        Thinking…
      </div>
    )

  return (
    <div className="flex flex-col gap-4 pb-3 pt-1 text-xs/5 text-cat-subtext-0">
      {activity.map((block, index) => {
        if (block.type === 'thinking') {
          if (block.redacted)
            return <p key={`thinking-${index}`} className="italic text-cat-overlay-1">Reasoning was redacted by the model provider.</p>
          return block.thinking.length === 0 ? (
            <p key={`thinking-${index}`} className="flex items-center gap-2 text-cat-overlay-1">
              <span className="size-1.5 animate-pulse rounded-full bg-cat-mauve" /> Thinking…
            </p>
          ) : (
            <RenderMarkdown key={`thinking-${index}`} className="agent-work-markdown">{block.thinking}</RenderMarkdown>
          )
        }
        return (
          <details key={`${block.toolCallId}-${index}`} className="group/tool">
            <summary className="flex min-h-11 list-none items-center gap-2 rounded-lg outline-none hover:text-cat-text focus-visible:outline-2 focus-visible:outline-cat-lavender [&::-webkit-details-marker]:hidden">
              <WrenchScrewdriverIcon className={cn('size-4 shrink-0', block.isError ? 'fill-cat-red' : block.running ? 'animate-pulse fill-cat-mauve' : 'fill-cat-overlay-1')} />
              <span>{toolLabel(block.name)}{block.running && '…'}</span>
              <ChevronRightIcon className="ml-auto size-4 fill-current transition-transform duration-150 group-open/tool:rotate-90 motion-reduce:transition-none" />
            </summary>
            <div className="ml-6 grid gap-3 border-l border-cat-surface-1 py-2 pl-4">
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-cat-overlay-1">Input</p>
                <pre className="overflow-x-auto whitespace-pre-wrap break-words rounded-lg bg-cat-mantle p-3 text-xs/5 text-cat-subtext-1">{block.argumentsJson || '(No input)'}</pre>
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-cat-overlay-1">{block.running ? 'Status' : block.isError ? 'Error' : 'Result'}</p>
                <pre className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-cat-mantle p-3 text-xs/5 text-cat-subtext-1">{block.running ? 'Running…' : block.resultJson || '(No result)'}</pre>
              </div>
            </div>
          </details>
        )
      })}
    </div>
  )
}

function WorkDisclosure({ message }: { message: MessageDto }) {
  const work = message.content.blocks.find((block) => block.type === 'work')
  const activity = message.content.blocks.filter(
    (block): block is Extract<MessageDto['content']['blocks'][number], { type: 'thinking' | 'tool' }> =>
      block.type === 'thinking' || block.type === 'tool',
  )
  if (!work) return null
  if (activity.length === 0) return (
    <div className="flex min-h-11 items-center text-xs text-cat-overlay-1">
      <span className="tabular-nums">{formatDuration(work.durationMs)}</span>
    </div>
  )
  return (
    <details className="group/work">
      <summary className="flex min-h-11 list-none items-center gap-1.5 rounded-lg text-xs text-cat-overlay-1 outline-none hover:text-cat-subtext-0 focus-visible:outline-2 focus-visible:outline-cat-lavender [&::-webkit-details-marker]:hidden">
        <span className="tabular-nums">{formatDuration(work.durationMs)}</span>
        <ChevronRightIcon className="size-4 fill-current transition-transform duration-150 group-open/work:rotate-90 motion-reduce:transition-none" />
      </summary>
      <WorkDisclosureContent activity={activity} />
    </details>
  )
}

function PendingWorkDisclosure({ activity }: { activity: ReadonlyArray<WorkActivity> }) {
  if (activity.length === 0) return (
    <div className="flex min-h-11 items-center gap-2 text-xs text-cat-subtext-0" role="status">
      <span className="size-3 animate-spin rounded-full border-2 border-cat-surface-2 border-t-cat-mauve motion-reduce:animate-pulse" aria-hidden="true" />
      <span>Working</span>
    </div>
  )
  return (
    <details className="group/work" open={activity.length > 0}>
      <summary className="flex min-h-11 list-none items-center gap-1.5 rounded-lg text-xs text-cat-subtext-0 outline-none hover:text-cat-text focus-visible:outline-2 focus-visible:outline-cat-lavender [&::-webkit-details-marker]:hidden">
        <span>Activity</span>
        <ChevronRightIcon className="size-4 fill-current transition-transform duration-150 group-open/work:rotate-90 motion-reduce:transition-none" />
      </summary>
      <WorkDisclosureContent activity={activity} />
    </details>
  )
}

function FileLink({ familyId, file }: { familyId: FamilyId; file: ChannelFile }) {
  return (
    <div className="flex min-h-11 items-stretch rounded-xl bg-cat-mantle text-xs text-cat-text ring-1 ring-cat-surface-1">
      <a
        href={`/api/families/${familyId}/files/${file.id}/view`}
        target="_blank"
        rel="noreferrer"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-l-xl px-3 py-2 hover:bg-cat-surface-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-cat-lavender"
        aria-label={`View ${file.name}`}
      >
        <DocumentIcon className="size-4 shrink-0 fill-cat-peach" />
        <span className="min-w-0 flex-1 truncate">{file.name}</span>
        <EyeIcon className="size-4 shrink-0 fill-cat-overlay-1" aria-hidden="true" />
      </a>
      <a
        href={`/api/families/${familyId}/files/${file.id}`}
        download
        className="grid min-w-11 place-items-center rounded-r-xl border-l border-cat-surface-1 hover:bg-cat-surface-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-cat-lavender"
        aria-label={`Download ${file.name}`}
      >
        <ArrowDownTrayIcon className="size-4 fill-cat-overlay-1" />
      </a>
    </div>
  )
}

function ApprovalCard({ familyId, block }: {
  familyId: FamilyId
  block: Extract<MessageDto['content']['blocks'][number], { type: 'approval' }>
}) {
  const queryClient = useQueryClient()
  const approvals = useQuery(connectorApprovalsQuery(familyId))
  const persistedStatus = approvals.data?.find(({ id }) => id === block.approvalId)?.status
  const [localStatus, setLocalStatus] = useState<'pending' | 'approved' | 'rejected' | 'expired' | 'succeeded' | 'failed' | 'outcome_unknown'>('pending')
  const status = persistedStatus ?? localStatus
  const [error, setError] = useState<string | null>(null)
  const decide = useMutation({
    mutationFn: (decision: 'approved' | 'rejected') => api.decideConnectorApproval(familyId, block.approvalId, decision),
    onSuccess: async (approval) => {
      setLocalStatus(approval.status)
      await queryClient.invalidateQueries({ queryKey: connectorApprovalsQuery(familyId).queryKey })
    },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Unable to update this approval.'),
  })
  return (
    <section className="flex max-w-xl flex-col gap-3 rounded-xl border border-cat-surface-1 bg-cat-mantle p-4" aria-label="Connector approval">
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold text-cat-text">{block.title}</h3>
        <p className="whitespace-pre-wrap text-xs/5 text-cat-subtext-0">{block.description}</p>
      </div>
      {status === 'pending' ? (
        <div className="flex gap-2">
          <Button type="button" variant="primary" className="min-h-11" disabled={decide.isPending} onClick={() => decide.mutate('approved')}>
            Approve
          </Button>
          <Button type="button" variant="ghost" className="min-h-11" disabled={decide.isPending} onClick={() => decide.mutate('rejected')}>
            Cancel
          </Button>
        </div>
      ) : (
        <p className="text-xs font-medium text-cat-subtext-0">{status === 'succeeded' ? 'Completed' : status === 'rejected' ? 'Cancelled' : status === 'expired' ? 'Expired' : status === 'failed' ? 'Failed' : status === 'outcome_unknown' ? 'Outcome unknown — Ronto will not retry automatically' : 'Approved'}</p>
      )}
      {error && <p role="alert" className="text-xs text-cat-red">{error}</p>}
    </section>
  )
}

const memberNameColors = [
  'text-cat-blue',
  'text-cat-peach',
  'text-cat-green',
  'text-cat-pink',
  'text-cat-teal',
  'text-cat-yellow',
] as const

function speakerIdentity(id: string | null | undefined, label: string | null | undefined) {
  const name = label?.trim() || id?.trim() || 'Family member'
  let colorIndex = 0
  for (const character of id ?? name)
    colorIndex = (colorIndex + character.charCodeAt(0)) % memberNameColors.length
  return { name, color: memberNameColors[colorIndex] }
}

function Message({
  familyId,
  message,
  files,
  members,
  currentMemberId,
}: {
  familyId: FamilyId
  message: MessageDto
  files: ReadonlyArray<ChannelFile>
  members: ReadonlyArray<FamilyMemberProfileDto>
  currentMemberId: string | undefined
}) {
  const fromMember = message.senderType === 'member' || message.senderType === 'external'
  const fromCurrentMember = fromMember && message.senderMemberId === currentMemberId
  const text = messageText(message)
  const attachments = message.content.blocks
    .filter((block) => block.type === 'file')
    .map((block) => files.find((file) => file.id === block.fileId))
    .filter((file): file is ChannelFile => file !== undefined)
  const approvals = message.content.blocks.filter(
    (block): block is Extract<MessageDto['content']['blocks'][number], { type: 'approval' }> => block.type === 'approval',
  )
  const time = DateTime.toDate(message.createdAt).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  })
  if (!fromMember) return (
    <li className="flex justify-start">
      <article className="flex w-full flex-col gap-2">
        <WorkDisclosure message={message} />
        {text && <RenderMarkdown>{text}</RenderMarkdown>}
        {approvals.map((approval) => <ApprovalCard key={approval.approvalId} familyId={familyId} block={approval} />)}
        {attachments.length > 0 && <div className="flex w-full flex-col gap-2">{attachments.map((file) => <FileLink key={file.id} familyId={familyId} file={file} />)}</div>}
        <p className="tabular-nums text-xs text-cat-overlay-1">Ronto · {time}</p>
      </article>
    </li>
  )

  const member = members.find(({ id }) => id === message.senderMemberId)
  const identity = message.senderType === 'external'
    ? speakerIdentity(message.externalSenderId, message.externalSenderName)
    : speakerIdentity(member?.id, member?.name)
  if (fromCurrentMember) return (
    <li className="flex justify-end">
      <article className="flex max-w-[min(42rem,88%)] flex-col items-end gap-2">
        {text && <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-cat-mauve px-4 py-3 text-sm/6 text-cat-crust sm:text-xs/5">{text}</div>}
        {attachments.length > 0 && <div className="flex w-full flex-col gap-2">{attachments.map((file) => <FileLink key={file.id} familyId={familyId} file={file} />)}</div>}
        <p className="tabular-nums text-xs text-cat-overlay-1">You · {time}</p>
      </article>
    </li>
  )

  return (
    <li className="flex items-start">
      <article className="flex max-w-[min(42rem,82%)] flex-col items-start gap-1.5">
        <p className="flex items-baseline gap-2 text-xs">
          <span className={cn('font-semibold', identity.color)}>{identity.name}</span>
          {message.senderType === 'external' && <span className="rounded-full bg-cat-surface-1 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cat-overlay-1">WhatsApp guest</span>}
          <span className="tabular-nums text-xs text-cat-overlay-1">{time}</span>
        </p>
        {text && <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md bg-cat-surface-0 px-4 py-3 text-sm/6 text-cat-text ring-1 ring-cat-surface-1 sm:text-xs/5">{text}</div>}
        {attachments.length > 0 && <div className="flex w-full flex-col gap-2">{attachments.map((file) => <FileLink key={file.id} familyId={familyId} file={file} />)}</div>}
      </article>
    </li>
  )
}

function EmptyConversation() {
  return (
    <div className="m-auto flex max-w-md flex-col items-center gap-4 px-6 text-center">
      <ChatBubbleLeftRightIcon className="size-4 shrink-0 fill-cat-overlay-1" />
      <div className="flex flex-col gap-2">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-cat-text">Start with what is on your mind</h2>
        <p className="text-pretty text-base/7 text-cat-subtext-0 sm:text-sm/6">Ask a question, make a plan, or leave a detail here for the family.</p>
      </div>
    </div>
  )
}

function MemoryEditor({ familyId, channelId, channelName, familyMemory, channelMemory, onClose }: {
  familyId: FamilyId
  channelId: ChannelId
  channelName: string
  familyMemory: Awaited<ReturnType<typeof api.getFamilyMemory>>
  channelMemory: ChannelMemoryDto
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const [scope, setScope] = useState<MemoryScope>('family')
  const [familyText, setFamilyText] = useState(familyMemory.content)
  const [channelText, setChannelText] = useState(channelMemory.content)
  const updateMemory = useMutation({
    mutationFn: async (input: { scope: MemoryScope; content: string; revision: string }): Promise<{ content: string; revision: string }> => input.scope === 'family'
      ? api.updateFamilyMemory(familyId, input.content, input.revision)
      : api.updateChannelMemory(familyId, channelId, input.content, input.revision),
    onSuccess: (memory, input) => {
      if (input.scope === 'family') queryClient.setQueryData(familyMemoryQuery(familyId).queryKey, { ...familyMemory, ...memory })
      else queryClient.setQueryData(channelMemoryQuery(familyId, channelId).queryKey, { ...channelMemory, ...memory })
      onClose()
    },
  })
  const error = updateMemory.error instanceof ApiError && updateMemory.error.status === 409
    ? 'Memory changed elsewhere. Reload it before saving.'
    : updateMemory.error instanceof Error ? updateMemory.error.message : null

  return <>
    <div className="flex gap-1 rounded-xl bg-cat-base p-1" role="tablist" aria-label="Memory scope">
      <button type="button" role="tab" aria-selected={scope === 'family'} disabled={updateMemory.isPending} className={cn('min-h-11 flex-1 rounded-lg px-3 text-sm font-medium', scope === 'family' ? 'bg-cat-surface-0 text-cat-text' : 'text-cat-subtext-0 hover:text-cat-text')} onClick={() => setScope('family')}>Family</button>
      <button type="button" role="tab" aria-selected={scope === 'channel'} disabled={updateMemory.isPending} className={cn('min-h-11 flex-1 rounded-lg px-3 text-sm font-medium', scope === 'channel' ? 'bg-cat-surface-0 text-cat-text' : 'text-cat-subtext-0 hover:text-cat-text')} onClick={() => setScope('channel')}>Channel</button>
    </div>
    <p className="text-sm text-cat-subtext-0">{scope === 'family' ? 'Shared across every family channel.' : `Only used in ${channelName}.`}</p>
    <Textarea aria-label={`${scope === 'family' ? 'Family' : 'Channel'} memory Markdown`} value={scope === 'family' ? familyText : channelText} onChange={(event) => scope === 'family' ? setFamilyText(event.target.value) : setChannelText(event.target.value)} className="min-h-64 flex-1 resize-y font-mono text-sm" disabled={updateMemory.isPending} />
    {error && <p role="alert" className="text-sm text-cat-red">{error}</p>}
    <div className="flex flex-wrap justify-end gap-2"><Button type="button" variant="ghost" onClick={() => scope === 'family' ? setFamilyText('') : setChannelText('')} disabled={updateMemory.isPending}>Clear all</Button><Button type="button" variant="secondary" onClick={onClose} disabled={updateMemory.isPending}>Cancel</Button><Button type="button" variant="primary" onClick={() => updateMemory.mutate({ scope, content: scope === 'family' ? familyText : channelText, revision: scope === 'family' ? familyMemory.revision : channelMemory.revision })} disabled={updateMemory.isPending}>Save memory</Button></div>
  </>
}

function MemoryDialog({ familyId, channel, onClose }: { familyId: FamilyId; channel: ChannelDto; onClose: () => void }) {
  const familyMemory = useQuery(familyMemoryQuery(familyId))
  const channelMemory = useQuery(channelMemoryQuery(familyId, channel.id))
  const error = familyMemory.error ?? channelMemory.error
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-cat-crust/70 p-0 sm:items-center sm:p-6" onKeyDown={(event) => { if (event.key === 'Escape') onClose() }}>
      <section role="dialog" aria-modal="true" aria-labelledby="memory-title" className="flex max-h-[90dvh] w-full max-w-2xl flex-col gap-4 bg-cat-mantle p-5 ring-1 ring-cat-surface-1 sm:max-h-[80dvh] sm:p-6">
        <div className="flex items-start justify-between gap-4"><div><h2 id="memory-title" className="text-xl font-semibold text-cat-text">Memory</h2><p className="text-sm text-cat-subtext-0">Canonical Markdown Ronto remembers across conversations.</p></div><Button autoFocus type="button" variant="ghost" size="icon" aria-label="Close memory" onClick={onClose}><XMarkIcon className="size-4" /></Button></div>
        {familyMemory.isPending || channelMemory.isPending ? <p className="text-sm text-cat-subtext-0">Loading memory...</p> : error ? <p role="alert" className="text-sm text-cat-red">{error instanceof Error ? error.message : 'Unable to load memory.'}</p> : familyMemory.data && channelMemory.data ? <MemoryEditor key={`${familyMemory.data.revision}:${channelMemory.data.revision}`} familyId={familyId} channelId={channel.id} channelName={channel.name} familyMemory={familyMemory.data} channelMemory={channelMemory.data} onClose={onClose} /> : null}
      </section>
    </div>
  )
}

function useChatData(familyId: FamilyId, requestedChannelId: ChannelId | undefined, requestedConversationId: ConversationId | undefined) {
  const queryClient = useQueryClient()
  const channelsResult = useQuery(channelsQuery(familyId))
  const conversationsResult = useQuery(conversationsQuery(familyId))
  const membersResult = useQuery(memberProfilesQuery(familyId))
  const channels = channelsResult.data ?? []
  const conversations = conversationsResult.data ?? []
  const members = membersResult.data ?? []
  const requestedConversation = conversations.find(({ id }) => id === requestedConversationId)
  const selectedChannel = channels.find(({ id }) => id === (requestedConversation?.channelId ?? requestedChannelId))
    ?? channels.find((channel) => channel.isDefault)
    ?? channels[0]
  const selected = requestedConversation
    ?? conversations.find((conversation) => conversation.channelId === selectedChannel?.id)
  const selectedChannelId = selectedChannel?.id ?? null
  const selectedId = selected?.id ?? null
  const activeRunResult = useQuery(activeRunQuery(familyId, selectedId, queryClient))
  const selectedIsWorking = activeRunResult.data !== null && activeRunResult.data !== undefined
  const messagesResult = useQuery(messagesQuery(familyId, selectedId, selectedIsWorking))
  const channelFilesResult = useQuery(channelFilesQuery(familyId, selectedChannelId))
  const messages = messagesResult.data ?? []
  const channelFiles = channelFilesResult.data ?? []
  const loading = channelsResult.isPending || conversationsResult.isPending || membersResult.isPending || messagesResult.isPending
  const queryError = [
    channelsResult.error,
    conversationsResult.error,
    membersResult.error,
    messagesResult.error,
    channelFilesResult.error,
  ].map((cause) => cause instanceof Error ? cause.message : null).find((message) => message !== null)

  return {
    channelsResult,
    conversationsResult,
    channels,
    conversations,
    members,
    selectedChannel,
    selected,
    selectedChannelId,
    selectedId,
    selectedIsWorking,
    messages,
    channelFiles,
    loading,
    queryError,
  }
}

function ChatHeader({ selectedChannel, selectedConversation, menuButtonRef, memoryButtonRef, onOpenMenu, onOpenMemory }: {
  selectedChannel: ChannelDto | undefined
  selectedConversation: ConversationDto | undefined
  menuButtonRef: RefObject<HTMLButtonElement | null>
  memoryButtonRef: RefObject<HTMLButtonElement | null>
  onOpenMenu: () => void
  onOpenMemory: () => void
}) {
  return (
    <header className="flex h-16 shrink-0 items-center gap-3 border-b border-cat-surface-0 bg-cat-base px-3 sm:px-5">
      <Button ref={menuButtonRef} type="button" variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={onOpenMenu}>
        <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
        <Bars3Icon className="size-4 shrink-0 fill-current" />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-cat-text sm:text-sm">
          {selectedChannel?.name ?? 'Ronto'}
        </h1>
        {selectedChannel && <p className="truncate text-sm text-cat-subtext-0">{selectedChannel.purpose || 'Private family space'}{selectedConversation && ` · ${conversationTitle(selectedConversation)}`}</p>}
      </div>
      {selectedChannel && <Button ref={memoryButtonRef} type="button" variant="ghost" size="compact" onClick={onOpenMemory}><BookOpenIcon className="size-4" /> Memory</Button>}
    </header>
  )
}

function ChatTimeline({ familyId, viewportRef, onContentRef, onScroll, onTouchStart, onWheel, loading, selectedId, messages, channelFiles, members, currentMemberId, showStreamDraft, pendingText, pendingFiles, showPendingAgent, pendingActivity, pendingResponse }: {
  familyId: FamilyId
  viewportRef: RefObject<HTMLDivElement | null>
  onContentRef: (element: HTMLDivElement | null) => void
  onScroll: (event: UIEvent<HTMLDivElement>) => void
  onTouchStart: () => void
  onWheel: (event: WheelEvent<HTMLDivElement>) => void
  loading: boolean
  selectedId: ConversationId | null
  messages: ReadonlyArray<MessageDto>
  channelFiles: ReadonlyArray<ChannelFile>
  members: ReadonlyArray<FamilyMemberProfileDto>
  currentMemberId: MeDto['memberships'][number]['member']['id'] | undefined
  showStreamDraft: boolean
  pendingText: string | null
  pendingFiles: ReadonlyArray<ChannelFile>
  showPendingAgent: boolean
  pendingActivity: ReadonlyArray<WorkActivity>
  pendingResponse: string
}) {
  return (
    <div ref={viewportRef} className="min-h-0 flex-1 overflow-y-auto [overflow-anchor:none]" onScroll={onScroll} onTouchStart={onTouchStart} onWheel={onWheel}>
      <div ref={onContentRef} className="mx-auto flex min-h-full w-full max-w-4xl flex-col px-4 py-8 sm:px-8 sm:py-10">
        {loading ? (
          <div className="m-auto flex items-center gap-2 text-base text-cat-subtext-0 sm:text-sm">
            <span className="size-2 animate-pulse rounded-full bg-cat-mauve" />
            Loading
          </div>
        ) : selectedId === null ? (
          <div className="m-auto text-center text-base text-cat-subtext-0">Create a session in this channel to begin.</div>
        ) : messages.length === 0 && pendingText === null && pendingFiles.length === 0 ? (
          <EmptyConversation />
        ) : (
          <ul className="flex flex-col gap-6" role="list">
            {messages.map((message) => <Message key={message.id} familyId={familyId} message={message} files={channelFiles} members={members} currentMemberId={currentMemberId} />)}
            {((showStreamDraft && (pendingText !== null || pendingFiles.length > 0)) || showPendingAgent) && (
              <li className="flex flex-col gap-6">
                {showStreamDraft && (pendingText !== null || pendingFiles.length > 0) && <div className="flex justify-end">
                  <div className="flex max-w-[min(42rem,88%)] flex-col items-end gap-2">
                    {pendingText && <div className="whitespace-pre-wrap rounded-2xl rounded-br-md bg-cat-mauve px-4 py-3 text-sm/6 text-cat-crust sm:text-xs/5">{pendingText}</div>}
                    {pendingFiles.map((file) => <FileLink key={file.id} familyId={familyId} file={file} />)}
                  </div>
                </div>}
                {showPendingAgent && <div className="flex w-full flex-col gap-2" aria-label={pendingResponse.length === 0 ? 'Ronto is working' : 'Ronto is responding'}>
                  <PendingWorkDisclosure activity={pendingActivity} />
                  {pendingResponse.length > 0 && <RenderMarkdown streaming>{pendingResponse}</RenderMarkdown>}
                </div>}
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

function ChatComposer({ selectedId, sending, selectedIsWorking, selectedFiles, fileInputRef, errorMessage, onSubmit, onComposerKeyDown, onFilesSelected, onRemoveFile, onStopResponse }: {
  selectedId: ConversationId | null
  sending: boolean
  selectedIsWorking: boolean
  selectedFiles: ReadonlyArray<File>
  fileInputRef: RefObject<HTMLInputElement | null>
  errorMessage: string | null | undefined
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFilesSelected: (files: ReadonlyArray<File>) => void
  onRemoveFile: (index: number) => void
  onStopResponse: () => Promise<void>
}) {
  return (
    <footer className="shrink-0 border-t border-cat-surface-0 bg-cat-base p-3 sm:p-5">
      <form className="mx-auto flex max-w-4xl flex-col gap-2" onSubmit={onSubmit}>
        {selectedFiles.length > 0 && (
          <div className="flex flex-wrap gap-2" aria-label="Selected attachments">
            {selectedFiles.map((file, index) => (
              <div key={`${file.name}-${file.lastModified}`} className="flex min-h-11 max-w-full items-center gap-2 rounded-xl bg-cat-surface-0 px-3 text-sm text-cat-text ring-1 ring-cat-surface-1">
                <DocumentIcon className="size-4 shrink-0 fill-cat-peach" />
                <span className="truncate">{file.name}</span>
                <button type="button" aria-label={`Remove ${file.name}`} className="grid size-8 shrink-0 place-items-center rounded-lg text-cat-subtext-0 hover:bg-cat-surface-1 hover:text-cat-text focus-visible:outline-2 focus-visible:outline-cat-lavender" onClick={() => onRemoveFile(index)}>
                  <XMarkIcon className="size-4" />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="sr-only"
            tabIndex={-1}
            onChange={(event) => {
              onFilesSelected(Array.from(event.target.files ?? []))
              event.target.value = ''
            }}
          />
          <Button type="button" variant="ghost" size="icon" aria-label="Attach files" disabled={selectedId === null || sending || selectedIsWorking} onClick={() => fileInputRef.current?.click()}>
            <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
            <PaperClipIcon className="size-4 shrink-0 fill-current" />
          </Button>
          <Textarea name="message" aria-label="Message Ronto" placeholder={selectedId === null ? 'Create a session to begin' : 'Message Ronto'} rows={1} disabled={selectedId === null || sending || selectedIsWorking} onKeyDown={onComposerKeyDown} />
          <Button type={selectedIsWorking ? 'button' : 'submit'} variant="primary" size="icon" aria-label={selectedIsWorking ? 'Stop response' : 'Send message'} disabled={selectedId === null} onClick={selectedIsWorking ? () => void onStopResponse() : undefined}>
            <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
            {selectedIsWorking ? <StopIcon className="size-4 shrink-0 fill-current" /> : <PaperAirplaneIcon className="size-4 shrink-0 fill-current" />}
          </Button>
        </div>
      </form>
      {errorMessage && (
        <div className="mx-auto flex max-w-4xl items-start gap-2 pt-2 text-cat-red">
          <ChevronLeftIcon className="size-4 h-lh shrink-0 rotate-180 fill-current" />
          <p role="alert" className="text-base/7 sm:text-sm/6">{errorMessage}</p>
        </div>
      )}
    </footer>
  )
}

function ChatShell({ me, membership, onSessionExpired }: { me: MeDto; membership: MeDto['memberships'][number]; onSessionExpired: () => Promise<void> }) {
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  const search = useAppSearch()
  const familyId = membership.family.id
  const createChannelMutation = useMutation({ mutationFn: ({ name, purpose }: { name: string; purpose: string }) => api.createChannel(familyId, name, purpose) })
  const createConversationMutation = useMutation({ mutationFn: (channelId: ChannelId) => api.createConversation(familyId, channelId, null) })
  const deleteConversationMutation = useMutation({ mutationFn: (conversationId: ConversationId) => api.deleteConversation(familyId, conversationId) })
  const cancelRunMutation = useMutation({ mutationFn: (conversationId: ConversationId) => api.cancelActiveRun(familyId, conversationId) })
  const {
    channelsResult,
    conversationsResult,
    channels,
    conversations,
    members,
    selectedChannel,
    selected,
    selectedChannelId,
    selectedId,
    selectedIsWorking,
    messages,
    channelFiles,
    loading,
    queryError,
  } = useChatData(familyId, search.channel, search.conversation)
  const [sending, setSending] = useState(false)
  const [streamConversationId, setStreamConversationId] = useState<ConversationId | null>(null)
  const [pendingText, setPendingText] = useState<string | null>(null)
  const [pendingResponse, setPendingResponse] = useState('')
  const [pendingActivity, setPendingActivity] = useState<ReadonlyArray<WorkActivity>>([])
  const [pendingMemberMessageId, setPendingMemberMessageId] = useState<MessageDto['id'] | null>(null)
  const [pendingFiles, setPendingFiles] = useState<ReadonlyArray<ChannelFile>>([])
  const [selectedFiles, setSelectedFiles] = useState<ReadonlyArray<File>>([])
  const [error, setError] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [familyOpen, setFamilyOpen] = useState(false)
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [connectorsOpen, setConnectorsOpen] = useState(false)
  const timelineViewport = useRef<HTMLDivElement>(null)
  const [timelineContent, setTimelineContent] = useState<HTMLDivElement | null>(null)
  const shouldAutoScroll = useRef(true)
  const autoScrollAnimating = useRef(false)
  const bottomChaseFrame = useRef<number | null>(null)
  const bottomChaseLastTop = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const memoryButton = useRef<HTMLButtonElement>(null)
  const familyButton = useRef<HTMLButtonElement>(null)
  const whatsappButton = useRef<HTMLButtonElement>(null)
  const connectorsButton = useRef<HTMLButtonElement>(null)
  const activeTurn = useRef<AbortController | null>(null)

  function cancelBottomChase() {
    if (bottomChaseFrame.current !== null)
      cancelAnimationFrame(bottomChaseFrame.current)
    bottomChaseFrame.current = null
    autoScrollAnimating.current = false
  }

  function kickBottomChase() {
    const viewport = timelineViewport.current
    if (
      viewport === null ||
      !shouldAutoScroll.current ||
      bottomChaseFrame.current !== null
    ) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      viewport.scrollTop = viewport.scrollHeight
      return
    }
    autoScrollAnimating.current = true
    bottomChaseLastTop.current = viewport.scrollTop
    const step = () => {
      const maximum = viewport.scrollHeight - viewport.clientHeight
      const gap = maximum - viewport.scrollTop
      if (!shouldAutoScroll.current || gap <= 0.5) {
        cancelBottomChase()
        return
      }
      if (viewport.scrollTop < bottomChaseLastTop.current - 1) {
        shouldAutoScroll.current = false
        cancelBottomChase()
        return
      }
      const next = Math.min(maximum, viewport.scrollTop + Math.max(1, gap * 0.12))
      viewport.scrollTop = next
      bottomChaseLastTop.current = next
      bottomChaseFrame.current = requestAnimationFrame(step)
    }
    bottomChaseFrame.current = requestAnimationFrame(step)
  }

  const handleReconnectedEvent = useEffectEvent((conversationId: ConversationId, event: TurnEvent) => {
    if (event.type === 'started') {
      queryClient.setQueryData(activeRunQuery(familyId, conversationId).queryKey, event.run)
      queryClient.setQueryData<ReadonlyArray<MessageDto>>(
        messagesQuery(familyId, conversationId).queryKey,
        (current = []) => current.some(({ id }) => id === event.memberMessage.id) ? current : [...current, event.memberMessage],
      )
      setPendingMemberMessageId(event.memberMessage.id)
    }
    if (event.type === 'title')
      queryClient.setQueryData<ReadonlyArray<ConversationDto>>(conversationsQuery(familyId).queryKey, (current = []) => current.map((conversation) =>
        conversation.id === conversationId
          ? { ...conversation, title: event.title }
          : conversation,
      ))
    if (event.type === 'text') {
      setPendingResponse(event.text)
    }
    if (event.type === 'thinking-start') {
      setPendingActivity((current) => [...current, { type: 'thinking', thinking: '' }])
    }
    if (event.type === 'thinking-delta')
      setPendingActivity((current) => {
        const last = current.at(-1)
        if (last?.type !== 'thinking') return [...current, { type: 'thinking', thinking: event.delta }]
        return [...current.slice(0, -1), { ...last, thinking: last.thinking + event.delta }]
      })
    if (event.type === 'tool-start')
      setPendingActivity((current) => [...current, {
        type: 'tool',
        toolCallId: event.toolCallId,
        name: event.name,
        argumentsJson: event.argumentsJson,
        resultJson: '',
        isError: false,
        running: true,
      }])
    if (event.type === 'tool-end')
      setPendingActivity((current) => current.map((activity) =>
        activity.type === 'tool' && activity.toolCallId === event.toolCallId
          ? {
              type: 'tool',
              toolCallId: event.toolCallId,
              name: event.name,
              argumentsJson: event.argumentsJson,
              resultJson: event.resultJson,
              isError: event.isError,
              running: false,
            }
          : activity,
      ))
    if (event.type === 'completed') {
      setPendingResponse('')
      setPendingActivity([])
      setPendingMemberMessageId(null)
      void queryClient.cancelQueries({ queryKey: messagesQuery(familyId, conversationId).queryKey, exact: true })
      queryClient.setQueryData(activeRunQuery(familyId, conversationId).queryKey, null)
      queryClient.setQueryData<ReadonlyArray<MessageDto>>(
        messagesQuery(familyId, conversationId).queryKey,
        (current = []) => [...current.filter(({ id }) => id !== event.agentMessage.id), event.agentMessage]
          .sort((left, right) => left.sequence - right.sequence),
      )
      if (selectedChannelId !== null)
        void queryClient.invalidateQueries({ queryKey: channelFilesQuery(familyId, selectedChannelId).queryKey })
    }
    if (event.type === 'failed' || event.type === 'cancelled') {
      queryClient.setQueryData(activeRunQuery(familyId, conversationId).queryKey, null)
      setPendingResponse('')
      setPendingActivity([])
      setPendingMemberMessageId(null)
      if (event.type === 'failed') setError(event.message)
    }
  })

  useEffect(() => {
    if (selectedId === null || !selectedIsWorking || streamConversationId === selectedId) return
    const conversationId = selectedId
    const controller = new AbortController()
    setPendingResponse('')
    setPendingActivity([])
    setPendingMemberMessageId(null)
    void api.streamActiveTurn(
      familyId,
      conversationId,
      controller.signal,
      (event) => handleReconnectedEvent(conversationId, event),
    ).catch((cause: unknown) => {
      if (controller.signal.aborted) return
      if (!(cause instanceof ApiError && cause.status === 404))
        setError(cause instanceof Error ? cause.message : 'Unable to reconnect to the response.')
    })
    return () => {
      controller.abort()
      setPendingResponse('')
      setPendingActivity([])
      setPendingMemberMessageId(null)
    }
  }, [selectedId, selectedIsWorking, streamConversationId])

  useEffect(() => {
    const viewport = timelineViewport.current
    if (timelineContent === null || viewport === null) return
    const observer = new ResizeObserver(() => kickBottomChase())
    observer.observe(timelineContent)
    return () => {
      observer.disconnect()
      cancelBottomChase()
    }
  }, [timelineContent])

  useEffect(() => {
    shouldAutoScroll.current = true
    cancelBottomChase()
    const frame = requestAnimationFrame(() => {
      const viewport = timelineViewport.current
      if (viewport !== null) viewport.scrollTop = viewport.scrollHeight
    })
    return () => cancelAnimationFrame(frame)
  }, [selectedId])

  function closeMobileSidebar() {
    setMobileOpen(false)
    requestAnimationFrame(() => menuButton.current?.focus())
  }

  async function createConversation() {
    try {
      if (!selectedChannelId) throw new Error('Select a channel first.')
      const conversation = await createConversationMutation.mutateAsync(selectedChannelId)
      queryClient.setQueryData<ReadonlyArray<ConversationDto>>(conversationsQuery(familyId).queryKey, (current = []) => [conversation, ...current])
      await navigate({ search: { ...search, channel: selectedChannelId, conversation: conversation.id } })
      setMobileOpen(false)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to create the conversation.')
      throw cause
    }
  }

  async function deleteConversation(conversationId: ConversationId) {
    try {
      await deleteConversationMutation.mutateAsync(conversationId)
      const remaining = conversations.filter(({ id }) => id !== conversationId)
      queryClient.setQueryData(conversationsQuery(familyId).queryKey, remaining)
      queryClient.removeQueries({ queryKey: messagesQuery(familyId, conversationId).queryKey })
      queryClient.removeQueries({ queryKey: activeRunQuery(familyId, conversationId).queryKey })
      if (selectedId === conversationId) {
        const next = remaining.find(({ channelId }) => channelId === selectedChannelId)
        await navigate({ search: { ...search, channel: selectedChannelId ?? undefined, conversation: next?.id }, replace: true })
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to delete the conversation.')
      throw cause
    }
  }

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (selectedId === null || selectedChannelId === null || sending || selectedIsWorking) return
    const form = event.currentTarget
    const text = String(new FormData(form).get('message') ?? '').trim()
    if (text.length === 0 && selectedFiles.length === 0) return
    const files = selectedFiles
    shouldAutoScroll.current = true
    form.reset()
    setSending(true)
    setPendingText(text)
    setPendingResponse('')
    setPendingActivity([])
    setPendingMemberMessageId(null)
    setError(null)
    const conversationId = selectedId
    setStreamConversationId(conversationId)
    const controller = new AbortController()
    activeTurn.current = controller
    let uploaded: ReadonlyArray<ChannelFile> = []
    let turnStarted = false
    try {
      const uploadResults = await Promise.allSettled(
        files.map((file) =>
          api.uploadConversationFile(familyId, conversationId, file, controller.signal),
        ),
      )
      uploaded = uploadResults.flatMap((result) =>
        result.status === 'fulfilled' ? [result.value] : [],
      )
      const failedUpload = uploadResults.find(
        (result) => result.status === 'rejected',
      )
      if (failedUpload) {
        await Promise.allSettled(uploaded.map((file) => api.deleteFile(familyId, file.id)))
        uploaded = []
        throw failedUpload.reason
      }
      setPendingFiles(uploaded)
      queryClient.setQueryData<ReadonlyArray<ChannelFile>>(
        channelFilesQuery(familyId, selectedChannelId).queryKey,
        (current = []) => [...current, ...uploaded],
      )
      setSelectedFiles([])
      const turn = await api.sendMessage(
        familyId,
        conversationId,
        text,
        uploaded.map((file) => file.id),
        controller.signal,
        (event) => {
          if (event.type === 'started') {
            turnStarted = true
            queryClient.setQueryData(activeRunQuery(familyId, conversationId).queryKey, event.run)
            queryClient.setQueryData<ReadonlyArray<MessageDto>>(
              messagesQuery(familyId, conversationId).queryKey,
              (current = []) => current.some(({ id }) => id === event.memberMessage.id) ? current : [...current, event.memberMessage],
            )
            setPendingMemberMessageId(event.memberMessage.id)
            setPendingText(null)
            setPendingFiles([])
          }
          if (event.type === 'title')
            queryClient.setQueryData<ReadonlyArray<ConversationDto>>(conversationsQuery(familyId).queryKey, (current = []) => current.map((conversation) =>
              conversation.id === conversationId
                ? { ...conversation, title: event.title }
                : conversation,
            ))
          if (event.type === 'text') {
            setPendingResponse(event.text)
          }
          if (event.type === 'thinking-start') {
            setPendingActivity((current) => [...current, { type: 'thinking', thinking: '' }])
          }
          if (event.type === 'thinking-delta')
            setPendingActivity((current) => {
              const last = current.at(-1)
              if (last?.type !== 'thinking') return [...current, { type: 'thinking', thinking: event.delta }]
              return [...current.slice(0, -1), { ...last, thinking: last.thinking + event.delta }]
            })
          if (event.type === 'tool-start')
            setPendingActivity((current) => [...current, {
              type: 'tool',
              toolCallId: event.toolCallId,
              name: event.name,
              argumentsJson: event.argumentsJson,
              resultJson: '',
              isError: false,
              running: true,
            }])
          if (event.type === 'tool-end')
            setPendingActivity((current) => current.map((activity) =>
              activity.type === 'tool' && activity.toolCallId === event.toolCallId
                ? {
                    type: 'tool',
                    toolCallId: event.toolCallId,
                    name: event.name,
                    argumentsJson: event.argumentsJson,
                    resultJson: event.resultJson,
                    isError: event.isError,
                    running: false,
                  }
                : activity,
            ))
          if (event.type === 'completed') {
            setPendingResponse('')
            setPendingActivity([])
            setPendingMemberMessageId(null)
            void queryClient.cancelQueries({ queryKey: messagesQuery(familyId, conversationId).queryKey, exact: true })
            queryClient.setQueryData(activeRunQuery(familyId, conversationId).queryKey, null)
          }
        },
      )
      void queryClient.cancelQueries({ queryKey: messagesQuery(familyId, conversationId).queryKey, exact: true })
      queryClient.setQueryData<ReadonlyArray<MessageDto>>(messagesQuery(familyId, conversationId).queryKey, (current = []) => [
        ...current.filter(({ id }) => id !== turn.memberMessage.id && id !== turn.agentMessage.id),
        turn.memberMessage,
        turn.agentMessage,
      ].sort((left, right) => left.sequence - right.sequence))
      await queryClient.invalidateQueries({ queryKey: channelFilesQuery(familyId, selectedChannelId).queryKey })
    } catch (cause) {
      if (!turnStarted && uploaded.length > 0) {
        await Promise.allSettled(uploaded.map((file) => api.deleteFile(familyId, file.id)))
        queryClient.setQueryData<ReadonlyArray<ChannelFile>>(channelFilesQuery(familyId, selectedChannelId).queryKey, (current = []) =>
          current.filter(
            (file) => !uploaded.some((candidate) => candidate.id === file.id),
          ),
        )
      }
      if (!controller.signal.aborted && !(cause instanceof TurnCancelledError))
        setError(cause instanceof Error ? cause.message : 'Ronto could not answer that message.')
      if (cause instanceof ApiError && cause.status === 401) {
        await onSessionExpired()
        return
      }
      if (controller.signal.aborted) return
      const persisted = await api.listMessages(familyId, conversationId).catch(() => null)
      if (persisted) queryClient.setQueryData(messagesQuery(familyId, conversationId).queryKey, persisted)
      const activeRun = await api.getActiveRun(familyId, conversationId).catch(() => null)
      queryClient.setQueryData(activeRunQuery(familyId, conversationId).queryKey, activeRun)
    } finally {
      if (activeTurn.current === controller) activeTurn.current = null
      setPendingText(null)
      setPendingResponse('')
      setPendingActivity([])
      setPendingMemberMessageId(null)
      setPendingFiles([])
      setSending(false)
      setStreamConversationId(null)
    }
  }

  async function stopResponse() {
    if (selectedId === null || !selectedIsWorking) return
    const conversationId = selectedId
    try {
      await cancelRunMutation.mutateAsync(conversationId)
      if (streamConversationId === conversationId) activeTurn.current?.abort()
      queryClient.setQueryData(activeRunQuery(familyId, conversationId).queryKey, null)
      const persisted = await api.listMessages(familyId, conversationId)
      queryClient.setQueryData(messagesQuery(familyId, conversationId).queryKey, persisted)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to stop response.')
    }
  }

  function handleComposerKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  const channelConversations = conversations.filter((conversation) => conversation.channelId === selectedChannelId)
  const showStreamDraft = selectedId !== null && streamConversationId === selectedId
  const pendingReplyPersisted = pendingMemberMessageId !== null && messages.some((message) =>
    message.senderType === 'agent' && message.replyToMessageId === pendingMemberMessageId,
  )
  const showPendingAgent = !pendingReplyPersisted
    && ((sending && showStreamDraft) || selectedIsWorking || pendingResponse.length > 0)
  if (!channelsResult.isPending && !conversationsResult.isPending && selectedChannel !== undefined && (search.channel !== selectedChannel.id || search.conversation !== selected?.id))
    return <Navigate to="/" search={{ ...search, channel: selectedChannel.id, conversation: selected?.id }} replace />

  return (
    <main className="isolate flex h-dvh overflow-hidden bg-cat-base antialiased">
      <Sidebar
        channels={channels}
        conversations={channelConversations}
        selectedChannelId={selectedChannelId}
        selectedId={selectedId}
        workingConversationId={selectedIsWorking || (sending && showStreamDraft) ? selectedId : null}
        userName={me.user.name}
        isPrimary={membership.member.role === 'primary'}
        mobileOpen={mobileOpen}
        onClose={closeMobileSidebar}
        onSelectChannel={(id) => {
          const conversation = conversations.find((candidate) => candidate.channelId === id)
          void navigate({ search: { ...search, channel: id, conversation: conversation?.id } })
          setMobileOpen(false)
        }}
        onSelect={(id) => {
          const conversation = conversations.find((candidate) => candidate.id === id)
          if (conversation === undefined) return
          void navigate({ search: { ...search, channel: conversation.channelId, conversation: id } })
          setMobileOpen(false)
        }}
        onDelete={deleteConversation}
        onCreateChannel={async (name, purpose) => {
          try { const channel = await createChannelMutation.mutateAsync({ name, purpose }); queryClient.setQueryData<ReadonlyArray<ChannelDto>>(channelsQuery(familyId).queryKey, (current = []) => [...current, channel]); await navigate({ search: { ...search, channel: channel.id, conversation: undefined } }) }
          catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create the channel.'); throw cause }
        }}
        onCreate={createConversation}
        onSignOut={async () => { activeTurn.current?.abort(); await onSessionExpired() }}
        onManageFamily={() => setFamilyOpen(true)}
        onManageWhatsapp={() => setWhatsappOpen(true)}
        onManageConnectors={() => setConnectorsOpen(true)}
        manageButtonRef={familyButton}
        whatsappButtonRef={whatsappButton}
        connectorsButtonRef={connectorsButton}
      />

      <section className="flex min-w-0 flex-1 flex-col" inert={mobileOpen || undefined}>
        <div className="flex flex-wrap items-center gap-2 border-b border-cat-surface-0 px-4 py-2">
          <label htmlFor="active-family" className="text-sm text-cat-subtext-0">Family</label>
          <select id="active-family" className="min-h-11 min-w-0 max-w-full rounded-lg bg-cat-mantle px-3 text-base text-cat-text focus-visible:outline-2 focus-visible:outline-cat-lavender" value={familyId} onChange={(event) => {
            const next = me.memberships.find(({ family }) => family.id === event.target.value)
            if (next) void navigate({ search: { family: next.family.id } })
          }}>
            {me.memberships.map(({ family }) => <option key={family.id} value={family.id}>{family.name}</option>)}
          </select>
          {me.isPlatformAdministrator && <Button type="button" variant="ghost" onClick={() => void navigate({ search: { platform: true } })}>Platform administration</Button>}
        </div>
        <ChatHeader selectedChannel={selectedChannel} selectedConversation={selected} menuButtonRef={menuButton} memoryButtonRef={memoryButton} onOpenMenu={() => setMobileOpen(true)} onOpenMemory={() => setMemoryOpen(true)} />

        <ChatTimeline
          viewportRef={timelineViewport}
          onContentRef={setTimelineContent}
          onScroll={(event) => {
            if (autoScrollAnimating.current) return
            const viewport = event.currentTarget
            shouldAutoScroll.current = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight < 120
          }}
          onTouchStart={() => {
            shouldAutoScroll.current = false
            cancelBottomChase()
          }}
          onWheel={(event) => {
            if (event.deltaY < 0) {
              shouldAutoScroll.current = false
              cancelBottomChase()
            }
          }}
          loading={loading}
          selectedId={selectedId}
          messages={messages}
          channelFiles={channelFiles}
          members={members}
          familyId={familyId}
          currentMemberId={membership.member.id}
          showStreamDraft={showStreamDraft}
          pendingText={pendingText}
          pendingFiles={pendingFiles}
          showPendingAgent={showPendingAgent}
          pendingActivity={pendingActivity}
          pendingResponse={pendingResponse}
        />

        <ChatComposer selectedId={selectedId} sending={sending} selectedIsWorking={selectedIsWorking} selectedFiles={selectedFiles} fileInputRef={fileInput} errorMessage={error ?? queryError} onSubmit={send} onComposerKeyDown={handleComposerKeyDown} onFilesSelected={setSelectedFiles} onRemoveFile={(index) => setSelectedFiles((current) => current.filter((_, at) => at !== index))} onStopResponse={stopResponse} />
      </section>
      {memoryOpen && selectedChannel && <MemoryDialog familyId={familyId} channel={selectedChannel} onClose={() => { setMemoryOpen(false); requestAnimationFrame(() => memoryButton.current?.focus()) }} />}
      {familyOpen && <FamilyDialog familyId={familyId} channels={channels} onClose={() => { setFamilyOpen(false); requestAnimationFrame(() => familyButton.current?.focus()) }} />}
      {whatsappOpen && <WhatsappDialog familyId={familyId} conversationId={selectedId} isPrimary={membership.member.role === 'primary'} onClose={() => { setWhatsappOpen(false); requestAnimationFrame(() => whatsappButton.current?.focus()) }} />}
      {connectorsOpen && <ConnectorsDialog familyId={familyId} onClose={() => { setConnectorsOpen(false); requestAnimationFrame(() => connectorsButton.current?.focus()) }} />}
    </main>
  )
}

const rememberedFamilyKey = 'ronto.active-family'

function readRememberedFamily(): string | null {
  try {
    return window.localStorage.getItem(rememberedFamilyKey)
  } catch {
    return null
  }
}

function rememberFamily(familyId: FamilyId) {
  try {
    window.localStorage.setItem(rememberedFamilyKey, familyId)
  } catch {
    // The URL remains authoritative when local storage is unavailable.
  }
}

function FamilyChooser({ me, unavailable, onSelect, onSignOut }: {
  me: MeDto
  unavailable: boolean
  onSelect: (familyId: FamilyId) => void
  onSignOut: () => Promise<void>
}) {
  return (
    <main className="isolate flex min-h-dvh items-center justify-center bg-cat-crust p-6">
      <section className="flex w-full max-w-lg flex-col gap-5 bg-cat-mantle p-7 ring-1 ring-cat-surface-1 sm:p-10">
        <Brand />
        <div className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold text-cat-text">Choose a family</h1>
          <p className="text-base/7 text-cat-subtext-0 sm:text-sm/6">
            {unavailable ? 'That family is unavailable to this account. Choose one you belong to.' : 'Choose the family you want to open.'}
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {me.memberships.map(({ family }) => (
            <Button key={family.id} type="button" variant="outline" className="min-h-11 justify-start" onClick={() => onSelect(family.id)}>
              {family.name}
            </Button>
          ))}
        </div>
        <Button type="button" variant="secondary" onClick={() => void onSignOut()}>Sign out</Button>
      </section>
    </main>
  )
}

function selectMembership(me: MeDto | null, requested: FamilyId | undefined) {
  if (me === null) return undefined
  if (requested !== undefined) return me.memberships.find(({ family }) => family.id === requested)
  const remembered = readRememberedFamily()
  return me.memberships.find(({ family }) => family.id === remembered)
    ?? (me.memberships.length === 1 ? me.memberships[0] : undefined)
}

function App() {
  const session = authClient.useSession()
  const queryClient = useQueryClient()
  const navigate = useAppNavigate()
  const search = useAppSearch()
  const meResult = useQuery({ ...meQuery(), enabled: Boolean(session.data) })
  const me = meResult.data ?? null
  const activeMembership = selectMembership(me, search.family)
  const inviteToken = search.invite
  const invitation: typeof InvitationInput.Type | undefined = search.invite !== undefined && search.platformInvite !== undefined
    ? undefined
    : search.platformInvite !== undefined ? { kind: 'platform', token: search.platformInvite }
      : inviteToken !== undefined ? { kind: 'family', token: inviteToken } : undefined
  const inviteRedemption = useQuery({
    queryKey: ['invite-redemption', invitation, me?.user.id],
    queryFn: async () => {
      if (invitation === undefined) throw new Error('Invitation token missing.')
      const next = invitation.kind === 'platform'
        ? await api.redeemPlatformInvitation(invitation.token)
        : await api.redeemFamilyInvite(invitation.token)
      queryClient.setQueryData(meQuery().queryKey, next)
      await navigate({ search: { family: undefined }, replace: true })
      return next
    },
    enabled: me !== null && invitation !== undefined,
    retry: false,
    staleTime: Infinity,
  })

  function removeInvite() {
    void navigate({ search: { ...search, invite: undefined, platformInvite: undefined }, replace: true })
  }

  async function refreshSession() {
    queryClient.clear()
    await session.refetch().catch(() => undefined)
  }

  async function signOut() {
    await authClient.signOut().catch(() => undefined)
    queryClient.clear()
    await session.refetch().catch(() => undefined)
  }

  useEffect(() => {
    if (activeMembership === undefined || invitation !== undefined || search.platform) return
    rememberFamily(activeMembership.family.id)
    if (search.family === activeMembership.family.id) return
    void navigate({
      search: {
        ...search,
        family: activeMembership.family.id,
        channel: undefined,
        conversation: undefined,
      },
      replace: true,
    })
  }, [activeMembership, invitation, navigate, search])

  if (session.isPending || (session.data !== null && meResult.isPending)) {
    return (
      <main className="isolate grid min-h-dvh place-items-center bg-cat-mantle antialiased">
        <div className="flex items-center gap-3 text-base text-cat-subtext-0 sm:text-sm">
          <span className="size-2 animate-pulse rounded-full bg-cat-mauve" />
          Opening Ronto
        </div>
      </main>
    )
  }
  if (!session.data) return <AuthScreen onAuthenticated={refreshSession} invitation={invitation} />
  if (meResult.error || me === null) {
    return <main className="isolate flex min-h-dvh items-center justify-center bg-cat-crust p-6"><section className="flex w-full max-w-lg flex-col gap-5 bg-cat-mantle p-7 ring-1 ring-cat-surface-1"><Brand /><p role="alert" className="text-cat-red">{meResult.error instanceof Error ? meResult.error.message : 'Unable to open Ronto.'}</p><Button type="button" variant="secondary" onClick={() => void signOut()}>Sign out</Button></section></main>
  }
  if (inviteRedemption.isPending && invitation !== undefined) {
    return <main className="isolate grid min-h-dvh place-items-center bg-cat-mantle antialiased"><div className="flex items-center gap-3 text-base text-cat-subtext-0"><span className="size-2 animate-pulse rounded-full bg-cat-mauve" />Accepting your invitation</div></main>
  }
  if (inviteRedemption.error && invitation !== undefined) {
    return <main className="isolate flex min-h-dvh items-center justify-center bg-cat-crust p-6"><section className="flex w-full max-w-lg flex-col gap-5 bg-cat-mantle p-7 ring-1 ring-cat-surface-1 sm:p-10"><Brand /><div className="flex flex-col gap-2"><h1 className="text-2xl font-semibold text-cat-text">Invitation not accepted</h1><p role="alert" className="text-base/7 text-cat-red sm:text-sm/6">{inviteRedemption.error instanceof Error ? inviteRedemption.error.message : 'This invitation could not be accepted.'}</p><p className="text-base/7 text-cat-subtext-0 sm:text-sm/6">{me.memberships.length > 0 ? 'You can continue to your existing family or try another account.' : 'Sign out and try the link with another account, or ask for a new invitation.'}</p></div><div className="flex flex-wrap gap-2">{me.memberships.length > 0 && <Button type="button" variant="primary" onClick={removeInvite}>Continue to Ronto</Button>}<Button type="button" variant="secondary" onClick={() => void signOut()}>Sign out &amp; retry</Button></div></section></main>
  }
  if (search.platform && me.isPlatformAdministrator) return <PlatformAdministration onClose={() => void navigate({ search: {} })} onSignOut={signOut} />
  if (me.canCreateFamily) return <OnboardingScreen user={me.user} onComplete={(next) => queryClient.setQueryData(meQuery().queryKey, next)} />
  if (me.memberships.length === 0) return <main className="grid min-h-dvh place-items-center bg-cat-crust p-6"><section className="flex max-w-lg flex-col gap-5 text-cat-text"><Brand /><h1 className="text-2xl font-semibold">An invitation is required</h1><p>Ask a family primary for a membership invitation, or the platform administrator for permission to create a family.</p>{me.isPlatformAdministrator && <Button type="button" onClick={() => void navigate({ search: { platform: true } })}>Platform administration</Button>}<Button type="button" variant="secondary" onClick={() => void signOut()}>Sign out</Button></section></main>
  if (activeMembership === undefined || search.family !== activeMembership.family.id) {
    return <FamilyChooser me={me} unavailable={search.family !== undefined} onSelect={(familyId) => void navigate({ search: { ...search, family: familyId, channel: undefined, conversation: undefined } })} onSignOut={signOut} />
  }
  return <ChatShell key={activeMembership.family.id} me={me} membership={activeMembership} onSessionExpired={signOut} />
}

export default App
