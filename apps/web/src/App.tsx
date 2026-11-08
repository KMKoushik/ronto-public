import {
  ArrowRightIcon,
  ArrowDownTrayIcon,
  Bars3Icon,
  CheckIcon,
  ChevronDownIcon,
  ClipboardDocumentIcon,
  ChevronRightIcon,
  DocumentIcon,
  EyeIcon,
  BookOpenIcon,
  LockClosedIcon,
  SparklesIcon,
  CalendarDaysIcon,
  MapIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
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
import { Brand } from '@/components/brand'
import { WorkspaceSidebar } from '@/components/workspace-sidebar'
import { ChatComposer } from '@/components/chat-composer'
import { PlatformAdministration } from '@/components/platform-administration'
import { SettingsDialog } from '@/components/settings-dialog'
import { SchedulesDialog } from '@/components/schedules-dialog'
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
import { conversationTitle } from '@/lib/conversations'
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
    <main className="isolate grid min-h-dvh bg-canvas text-ink lg:grid-cols-2">
      <section className="flex min-w-0 flex-col justify-between gap-10 border-b border-line bg-panel p-6 sm:p-10 lg:gap-20 lg:border-r lg:border-b-0 lg:p-14">
        <Brand />
        <div className="flex max-w-lg flex-col gap-5 lg:py-12">
          <h1 className="max-w-[14ch] text-3xl font-medium tracking-tight text-balance sm:text-4xl lg:text-5xl">
            A little help for the life you share.
          </h1>
          <p className="max-w-[40ch] text-base/7 text-pretty text-muted">
            One quiet place for your family’s plans, everyday questions, and the details worth remembering.
          </p>
        </div>
        <p className="flex items-center gap-2 text-sm/6 text-muted max-lg:hidden"><LockClosedIcon aria-hidden="true" className="size-4 shrink-0" />Just your family and Ronto. Private by design.</p>
      </section>

      <section className="flex min-w-0 items-center justify-center px-6 py-10 sm:p-10 lg:py-16">
        <div className="flex w-full max-w-xs flex-col gap-7">
          <div className="flex flex-col gap-2">
            <h2 className="text-2xl font-semibold tracking-tight text-balance">
              {mode === 'sign-in' ? 'Welcome back' : 'Create your account'}
            </h2>
            <p className="text-base/7 text-pretty text-muted sm:text-sm/6">
              {mode === 'sign-in'
                ? hasInvite ? 'Sign in to join your family on Ronto.' : 'Sign in to pick up where your family left off.'
                 : 'Create an account to accept your invitation.'}
            </p>
          </div>

          {hasInvite && <p className="flex items-start gap-2 rounded-lg bg-soft p-3 text-base/7 text-muted sm:text-sm/6"><CheckIcon aria-hidden="true" className="h-lh w-4 shrink-0 fill-success" />Your invitation is ready. Sign in or create an account to accept it.</p>}
          <form className="flex flex-col gap-4" onSubmit={submit}>
            {mode === 'sign-up' && (
              <div className="flex flex-col gap-2">
                <label htmlFor="name" className="text-base font-medium sm:text-sm">
                  Name
                </label>
                <Input id="name" name="name" autoComplete="name" required />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <label htmlFor="email" className="text-base font-medium sm:text-sm">
                Email
              </label>
              <Input id="email" name="email" type="email" autoComplete="email" required />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="password" className="text-base font-medium sm:text-sm">
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
              <p role="alert" className="text-base/7 text-pretty text-danger sm:text-sm/6">
                {error}
              </p>
            )}
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? 'Please wait…' : mode === 'sign-in' ? 'Sign in' : 'Create account'}
              {!pending && <ArrowRightIcon aria-hidden="true" />}
            </Button>
          </form>

          {invitation && validated.isError && <p role="alert" className="text-base/7 text-danger sm:text-sm/6">This invitation is unavailable. You can still sign in to your existing account.</p>}
          {hasInvite || mode === 'sign-up' ? <p className="text-base/7 text-muted sm:text-sm/6">
            {mode === 'sign-in' ? 'New to Ronto?' : 'Already have an account?'}{' '}
            <button
              type="button"
              className="rounded-sm font-medium text-ink underline decoration-line-strong underline-offset-4 hover:decoration-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              onClick={() => {
                setMode(mode === 'sign-in' ? 'sign-up' : 'sign-in')
                setError(null)
              }}
            >
              {mode === 'sign-in' ? 'Create an account' : 'Sign in'}
            </button>
          </p> : <p className="text-base/7 text-muted sm:text-sm/6">New to Ronto? Ask your family for a private invitation.</p>}
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

  return <SettingsDialog title="Connected accounts" description="Give Ronto a hand with the services you use. These connections belong to you, not the whole family." onClose={onClose}>
    <section className="flex min-w-0 flex-col gap-4" aria-labelledby="your-accounts-title">
      <h3 id="your-accounts-title" className="text-sm font-medium">Your accounts</h3>
      <ul role="list" className="flex flex-col divide-y divide-line">
        {connectors.data?.map((connection) => <li key={connection.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
          <div className="flex min-w-0 flex-col gap-1 text-sm">
            <p className="font-medium">{connectorName(connection.service)}</p>
            <p className={cn('flex items-center gap-1.5', connection.status === 'active' ? 'text-success' : connection.status === 'failed' ? 'text-danger' : 'text-warning')}>
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-current" />
              {connection.status === 'active' ? 'Connected' : connection.status === 'pending' ? 'Waiting for consent' : connection.status === 'disconnecting' ? 'Disconnecting' : 'Setup failed'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {connection.status === 'pending' && <Button variant="outline" size="compact" disabled={pending} onClick={() => void checkConnection(connection)}>Check connection</Button>}
            <Button variant="ghost" size="compact" disabled={pending} onClick={() => void removeConnection(connection)}>Disconnect</Button>
          </div>
        </li>)}
      </ul>
      {connectors.isPending && <p role="status" className="text-sm/6 text-muted">Loading connected accounts…</p>}
      {connectors.data?.length === 0 && <div className="flex flex-col gap-1 rounded-lg bg-soft p-4"><p className="text-sm font-medium">No accounts connected</p><p className="text-base/7 text-muted sm:text-sm/6">Choose a provider below to get started. You can disconnect at any time.</p></div>}
    </section>
    <form className="flex flex-col gap-4 border-t border-line pt-5" onSubmit={connect}>
      <div className="flex flex-col gap-1"><h3 className="text-sm font-medium">Add an account</h3><p className="text-base/7 text-muted sm:text-sm/6">You’ll review and approve access directly with the provider.</p></div>
      <div className="flex flex-col gap-2">
        <label htmlFor="connector-provider" className="text-sm font-medium">Provider</label>
        <div className="relative">
          <select id="connector-provider" name="provider" className="h-9 w-full appearance-none rounded-lg border border-line-strong bg-panel pl-3 pr-9 text-base text-ink outline-none focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-focus disabled:opacity-50 sm:text-sm pointer-coarse:min-h-11" value={selectedService} disabled={pending || providers.isPending} onChange={(event) => selectProvider(event.target.value)}><option value="">Choose a provider</option>{providers.data?.map(({ service }) => <option key={service} value={service}>{connectorName(service)}</option>)}</select>
          <ChevronDownIcon aria-hidden="true" className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 fill-muted" />
        </div>
      </div>
      <Button type="submit" variant="primary" className="self-start" disabled={pending || !provider || provider.scopes.length === 0}>{start.isPending ? 'Opening provider…' : 'Continue to provider'}<ArrowRightIcon aria-hidden="true" /></Button>
    </form>
    {notice && <p role="status" className="rounded-lg bg-soft p-3 text-sm/6 text-muted">{notice}</p>}
    {(error ?? queryError) && <p role="alert" className="text-sm/6 text-danger">{error ?? queryError}</p>}
  </SettingsDialog>
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
    <SettingsDialog title="Manage family" description="Make room for your people, and choose which channels each member can access." onClose={onClose} className="max-w-3xl">
      <section className="flex flex-col gap-4" aria-labelledby="invite-family-title">
        <div className="flex flex-col gap-1"><h3 id="invite-family-title" className="text-sm font-medium">Invite someone</h3><p className="text-base/7 text-muted sm:text-sm/6">Send a private link to join this family. Primary members can also manage people and channel access.</p></div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={pending} onClick={() => void createInvite('member')}><UserGroupIcon aria-hidden="true" />Create member link</Button>
          <Button variant="ghost" disabled={pending} onClick={() => void createInvite('primary')}>Create primary link</Button>
        </div>
        {inviteLink && <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-soft p-4">
          <div className="flex flex-col gap-1"><label htmlFor="family-invite-link" className="text-sm font-medium">{inviteLink.role === 'primary' ? 'Primary' : 'Member'} invitation</label><p className="text-sm text-muted">Expires {inviteLink.expiresAt}. Share this link privately.</p></div>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row"><Input id="family-invite-link" name="familyInviteLink" value={inviteLink.url} readOnly onFocus={(event) => event.currentTarget.select()} /><Button variant="secondary" onClick={() => void copyInvite()}><ClipboardDocumentIcon aria-hidden="true" />Copy link</Button></div>
        </div>}
      </section>
      {notice && <p role="status" className="text-sm/6 text-muted">{notice}</p>}
      {(error ?? (membersQuery.error instanceof Error ? membersQuery.error.message : null)) && <p role="alert" className="text-sm/6 text-danger">{error ?? (membersQuery.error instanceof Error ? membersQuery.error.message : 'Unable to load family members.')}</p>}
      <section className="flex flex-col gap-5 border-t border-line pt-5" aria-labelledby="family-members-title">
        <div className="flex items-center justify-between gap-3"><h3 id="family-members-title" className="text-sm font-medium">Family members</h3>{membersQuery.data && <p className="text-sm text-muted tabular-nums">{members.length} {members.length === 1 ? 'person' : 'people'}</p>}</div>
        <ul role="list" className="flex min-w-0 flex-col divide-y divide-line">{members.map((member) => {
          const primary = member.role === 'primary'
          return <li key={member.id} className="flex min-w-0 flex-col gap-4 py-5 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col gap-1 text-sm"><p className="break-words font-medium">{member.name}</p><p className="break-words text-muted">{member.email}</p></div>
              <p className="shrink-0 rounded-md bg-soft px-2 py-1 text-sm text-muted capitalize">{member.role}</p>
            </div>
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className="pb-2 text-sm font-medium">Channel access</legend>
              <div className="grid gap-x-6 sm:grid-cols-2">{channels.map((channel) => {
                const checked = channel.isDefault || member.channelIds.includes(channel.id)
                return primary ? <div key={channel.id} className="flex min-h-9 items-center gap-2.5 text-sm text-muted pointer-coarse:min-h-11"><CheckIcon aria-hidden="true" className="size-4 shrink-0 fill-faint" /><span className="min-w-0 break-words">{channel.name}</span>{channel.isDefault && <span className="shrink-0 text-faint">Always included</span>}</div> : <label key={channel.id} className="flex min-h-9 cursor-pointer items-center gap-2.5 text-sm text-muted pointer-coarse:min-h-11"><input name={`channel-access-${member.id}`} type="checkbox" className="size-4 shrink-0 rounded accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-default" checked={checked} disabled={channel.isDefault || pending} onChange={(event) => void setAccess(channel.id, member, event.target.checked)} /><span className="min-w-0 break-words">{channel.name}</span>{channel.isDefault && <span className="shrink-0 text-faint">Always included</span>}</label>
              })}</div>
            </fieldset>
          </li>
        })}</ul>
        {membersQuery.isPending && <p role="status" className="text-sm/6 text-muted">Loading family members…</p>}
      </section>
    </SettingsDialog>
  )
}

function WhatsappNumberStep({ status, numberLinked, whatsappAvailable }: {
  status: WhatsappHealth['status'] | undefined
  numberLinked: boolean
  whatsappAvailable: boolean
}) {
  return (
    <li className="whatsapp-step">
      <section aria-labelledby="whatsapp-step-number">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-sm tabular-nums', numberLinked ? 'border-success/30 text-success' : 'border-line-strong text-muted')} aria-hidden="true">
            {numberLinked ? <CheckIcon className="size-4" /> : '1'}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="whatsapp-step-number" className="text-sm font-medium">Connect Ronto’s number</h3>
              {numberLinked && <p className="text-sm text-success">Complete</p>}
            </div>
            <p className="text-base/7 text-muted sm:text-sm/6">Ronto uses a dedicated number, not a family member’s personal account.</p>

            {status === 'disabled' ? (
              <div className="flex items-start gap-2 rounded-lg bg-soft p-3 text-sm/6 text-muted">
                <LockClosedIcon aria-hidden="true" className="h-lh w-4 shrink-0 fill-faint" />
                WhatsApp is switched off on the Ronto server. It must be enabled before setup can continue.
              </div>
            ) : numberLinked ? (
              <p className={cn('text-sm/6', whatsappAvailable ? 'text-success' : 'text-warning')}>
                {whatsappAvailable ? 'Ronto is connected and ready to receive messages.' : 'The number is linked. Wait for Ronto to finish reconnecting.'}
              </p>
            ) : (
              <div className="flex items-start gap-2 rounded-lg bg-soft p-3 text-sm/6 text-muted">
                <LockClosedIcon aria-hidden="true" className="h-lh w-4 shrink-0 fill-faint" />
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
    <li className="whatsapp-step">
      <section aria-labelledby="whatsapp-step-identity">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-sm tabular-nums', identityLinked ? 'border-success/30 text-success' : 'border-line-strong text-muted')} aria-hidden="true">
            {identityLinked ? <CheckIcon className="size-4" /> : '2'}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="whatsapp-step-identity" className="text-sm font-medium">Link your WhatsApp</h3>
              {identityLinked && <p className="text-sm text-success">Complete</p>}
            </div>
            <p className="text-base/7 text-muted sm:text-sm/6">Let Ronto recognize your messages. Each family member links their own number.</p>

            {loading ? <p role="status" className="text-sm/6 text-muted">Checking linked identities…</p> : <ul role="list" className="flex flex-col divide-y divide-line">{identities?.map((identity) => <li key={identity.id} className="flex min-h-9 items-center justify-between gap-3 py-1 text-sm"><div className="flex min-w-0 items-center gap-2"><CheckIcon aria-hidden="true" className="size-4 shrink-0 fill-success" /><span className="truncate">{identity.displayName ?? identity.externalUserId}</span></div><Button variant="ghost" size="compact" disabled={pending} onClick={() => void onRevoke(identity.id)}>Unlink</Button></li>)}</ul>}

            {whatsappAvailable ? <div className="flex flex-col gap-3"><Button variant={identityLinked ? 'outline' : 'primary'} className="self-start" disabled={pending} onClick={() => void onCreateCode()}>{identityLinked ? 'Link another number' : 'Create link command'}</Button>{identityCommand && <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-soft p-3"><label htmlFor="whatsapp-identity-command" className="text-sm/6 font-medium">Send this command privately to Ronto within 15 minutes.</label><Input id="whatsapp-identity-command" name="identityCommand" className="font-mono" value={identityCommand} readOnly onFocus={(event) => event.currentTarget.select()} /><Button variant="secondary" size="compact" className="self-start" onClick={() => void onCopy(identityCommand)}><ClipboardDocumentIcon aria-hidden="true" />Copy command</Button><p className="text-sm/6 text-muted">This screen updates automatically after Ronto confirms the command.</p></div>}</div> : !identityLinked && <div className="flex items-start gap-2 rounded-lg bg-soft p-3 text-sm/6 text-muted"><LockClosedIcon aria-hidden="true" className="h-lh w-4 shrink-0 fill-faint" />{numberLinked ? 'Wait for Ronto to reconnect before linking your identity.' : 'Complete step 1 before linking your identity.'}</div>}
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
    <li className="whatsapp-step">
      <section aria-labelledby="whatsapp-step-dm-family">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-sm tabular-nums', activeHere ? 'border-success/30 text-success' : 'border-line-strong text-muted')} aria-hidden="true">{activeHere ? <CheckIcon className="size-4" /> : '3'}</span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"><h3 id="whatsapp-step-dm-family" className="text-sm font-medium">Choose a family for direct messages</h3>{activeHere && <p className="text-sm text-success">Active here</p>}</div>
            <p className="text-base/7 text-muted sm:text-sm/6">Private WhatsApp messages use one family at a time. Group chats keep their own family session.</p>
            {loading ? <p role="status" className="text-sm/6 text-muted">Checking the active family…</p> : identityLinked ? <div className="flex flex-col gap-3"><p className="text-sm text-muted">Current family: <span className="font-medium text-ink">{selected?.familyName ?? 'Not selected'}</span></p>{!activeHere && <Button variant="primary" className="self-start whitespace-normal text-left" disabled={pending || current === undefined} onClick={() => void onSelect()}>Use {current?.familyName ?? 'this family'} for DMs</Button>}<p className="text-sm/6 text-muted">In WhatsApp, use <code className="rounded bg-soft px-1 font-mono">/ronto families</code> or <code className="rounded bg-soft px-1 font-mono">/ronto family &lt;code&gt;</code> to switch families.</p></div> : <div className="flex items-start gap-2 rounded-lg bg-soft p-3 text-sm/6 text-muted"><LockClosedIcon aria-hidden="true" className="h-lh w-4 shrink-0 fill-faint" />Link your WhatsApp identity first.</div>}
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
    <li className="whatsapp-step">
      <section aria-labelledby="whatsapp-step-chat">
        <div className="flex items-start gap-3">
          <span className={cn('grid size-6 shrink-0 place-items-center rounded-full border text-sm tabular-nums', chatLinked ? 'border-success/30 text-success' : 'border-line-strong text-muted')} aria-hidden="true">
            {chatLinked ? <CheckIcon className="size-4" /> : '4'}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
              <h3 id="whatsapp-step-chat" className="text-sm font-medium">Bring Ronto into a group</h3>
              {chatLinked ? <p className="text-sm text-success">Complete</p> : !isPrimary && <p className="text-sm text-muted">Primary members only</p>}
            </div>
            <p className="text-base/7 text-muted sm:text-sm/6">Create the group, add Ronto, then mention Ronto. The channel is created and linked automatically.</p>
            <p className="rounded-lg bg-soft p-3 text-sm/6 text-muted">Everyone in a connected group can invoke Ronto with this session’s context, files, and channel tools. Connect only groups whose current and future participants you trust.</p>

            {isPrimary && loading && conversationId !== null ? <p role="status" className="text-sm/6 text-muted">Checking connected chats…</p> : <ul role="list" className="flex flex-col divide-y divide-line">{bindings?.map((binding) => <li key={binding.id} className="flex min-h-9 items-center justify-between gap-3 py-2 text-sm"><div className="flex min-w-0 flex-col gap-1"><p className="font-medium">Connected WhatsApp chat</p><p className="truncate font-mono text-muted">{binding.externalChannelId}</p></div><Button variant="ghost" size="compact" disabled={pending} onClick={() => void onRemove(binding.id)}>Remove</Button></li>)}</ul>}

            {!isPrimary ? <div className="flex items-start gap-2 text-sm/6 text-muted"><LockClosedIcon aria-hidden="true" className="h-lh w-4 shrink-0 fill-faint" />A linked primary family member must mention Ronto to create the channel.</div> : conversationId === null ? null : whatsappAvailable && identityLinked ? <div className="flex flex-col gap-3"><Button variant="outline" className="self-start whitespace-normal text-left" disabled={pending} onClick={() => void onCreateCode()}>Link this existing session instead</Button>{bindingCommand && <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-soft p-3"><label htmlFor="whatsapp-binding-command" className="text-sm/6 font-medium">Post this command in the WhatsApp chat within 15 minutes.</label><Input id="whatsapp-binding-command" name="bindingCommand" className="font-mono" value={bindingCommand} readOnly onFocus={(event) => event.currentTarget.select()} /><Button variant="secondary" size="compact" className="self-start" onClick={() => void onCopy(bindingCommand)}><ClipboardDocumentIcon aria-hidden="true" />Copy command</Button><p className="text-sm/6 text-muted">Everyone in that chat will use the selected Ronto session.</p></div>}</div> : !chatLinked && <div className="flex items-start gap-2 text-sm/6 text-muted"><LockClosedIcon aria-hidden="true" className="h-lh w-4 shrink-0 fill-faint" />{!identityLinked ? 'Complete step 2 before using Ronto in a group.' : 'Wait for Ronto to reconnect before using it in a group.'}</div>}
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
  const statusColor = status === 'connected' ? 'bg-success'
    : status === 'disabled' || status === 'logged_out' ? 'bg-danger'
    : 'bg-warning'

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
    <SettingsDialog title="WhatsApp" description="Keep the conversation going from WhatsApp. Complete these steps in order to connect your number and chats." onClose={onClose}>
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p role="status" className="flex items-center gap-2 text-muted"><span className={cn('size-1.5 shrink-0 rounded-full', statusColor)} aria-hidden="true" />{statusLabel}</p>
          <p className="text-muted tabular-nums">{completedSteps} of {totalSteps} complete</p>
        </div>
        <progress aria-label="WhatsApp setup progress" className="h-1.5 w-full overflow-hidden rounded-full accent-primary" value={completedSteps} max={totalSteps} />
      </div>
          <ol role="list" aria-label="WhatsApp setup steps" className="flex flex-col">
            <WhatsappNumberStep status={status} numberLinked={numberLinked} whatsappAvailable={whatsappAvailable} />
            <WhatsappIdentityStep identities={identities.data} loading={identities.isPending} identityLinked={identityLinked} numberLinked={numberLinked} whatsappAvailable={whatsappAvailable} pending={pending} identityCommand={identityCommand} onCreateCode={createIdentityCode} onCopy={copy} onRevoke={unlinkIdentity} />
            <WhatsappDmFamilyStep familyId={familyId} families={dmFamilies.data} loading={dmFamilies.isPending} identityLinked={identityLinked} pending={pending} onSelect={chooseDmFamily} />
            <WhatsappChatStep conversationId={conversationId} isPrimary={isPrimary} bindings={bindings.data} loading={bindings.isPending} chatLinked={chatLinked} identityLinked={identityLinked} whatsappAvailable={whatsappAvailable} pending={pending} bindingCommand={bindingCommand} onCreateCode={createBindingCode} onCopy={copy} onRemove={disconnectChat} />
          </ol>

      {notice && <p role="status" className="rounded-lg bg-soft p-3 text-sm/6 text-muted">{notice}</p>}
      {dialogError && <p role="alert" className="text-sm/6 text-danger">{dialogError}</p>}
    </SettingsDialog>
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
    <main className="isolate flex min-h-dvh flex-col bg-canvas px-6 py-6 text-ink sm:px-10 sm:py-10">
      <header className="mx-auto w-full max-w-5xl"><Brand /></header>
      <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 py-12 sm:py-20">
        <div className="flex flex-col gap-3">
          <h1 className="max-w-[20ch] text-3xl font-medium tracking-tight text-balance">
            Make a little space for your family.
          </h1>
          <p className="text-base/7 text-pretty text-muted sm:text-sm/6">
            Start with a name for your private workspace. You’ll be its primary member, {user.name}.
          </p>
        </div>
        <form className="flex flex-col gap-5" onSubmit={submit}>
          <div className="flex flex-col gap-2">
            <label htmlFor="familyName" className="text-sm font-medium">
              Family name
            </label>
            <Input
              id="familyName"
              name="familyName"
              placeholder="Your family name"
              aria-describedby="family-name-help"
              required
            />
            <p id="family-name-help" className="text-sm/6 text-muted">Pick a name everyone will recognize.</p>
          </div>
          {onboarding.error && <p role="alert" className="text-base/7 text-danger sm:text-sm/6">{onboarding.error instanceof Error ? onboarding.error.message : 'Unable to create your family space.'}</p>}
          <Button type="submit" variant="primary" disabled={onboarding.isPending}>
            {onboarding.isPending ? 'Creating your space…' : 'Create family space'}
            {!onboarding.isPending && <ArrowRightIcon aria-hidden="true" />}
          </Button>
        </form>
        <p className="flex items-start gap-2 border-t border-line pt-5 text-sm/6 text-muted"><LockClosedIcon aria-hidden="true" className="h-lh w-4 shrink-0" />Only the people you invite can join your family.</p>
      </section>
    </main>
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

function toolLabel(name: string, running = false) {
  switch (name) {
    case 'bash': return running ? 'Running a command' : 'Ran a command'
    case 'edit': return running ? 'Editing a file' : 'Edited a file'
    case 'glob':
    case 'grep': return running ? 'Searching files' : 'Searched files'
    case 'ls': return running ? 'Listing files' : 'Listed files'
    case 'read': return running ? 'Reading a file' : 'Read a file'
    case 'write': return running ? 'Writing a file' : 'Wrote a file'
    default: return `${running ? 'Using' : 'Used'} ${name}`
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
              <span>{toolLabel(block.name, block.running)}{block.running && '…'}</span>
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
    <details className="work-disclosure group/work">
      <summary className="flex min-h-11 list-none items-center gap-1.5 rounded-lg text-xs text-cat-overlay-1 outline-none hover:text-cat-subtext-0 focus-visible:outline-2 focus-visible:outline-cat-lavender [&::-webkit-details-marker]:hidden">
        <span className="tabular-nums">{formatDuration(work.durationMs)}</span>
        <ChevronRightIcon className="size-4 fill-current transition-transform duration-150 group-open/work:rotate-90 motion-reduce:transition-none" />
      </summary>
      <WorkDisclosureContent activity={activity} />
    </details>
  )
}

function PendingWorkDisclosure({ activity }: { activity: ReadonlyArray<WorkActivity> }) {
  const latest = activity.at(-1)
  if (activity.length === 0) return (
    <div className="flex min-h-11 items-center gap-2 text-xs text-cat-subtext-0" role="status">
      <span className="size-3 animate-spin rounded-full border-2 border-cat-surface-2 border-t-cat-mauve motion-reduce:animate-pulse" aria-hidden="true" />
      <span>Working</span>
    </div>
  )
  return (
    <details className="work-disclosure group/work">
      <summary className="flex min-h-11 list-none items-center gap-1.5 rounded-lg text-xs text-cat-subtext-0 outline-none hover:text-cat-text focus-visible:outline-2 focus-visible:outline-cat-lavender [&::-webkit-details-marker]:hidden">
        <span className="working-dot" aria-hidden="true" />
        <span role="status">{latest?.type === 'tool' ? toolLabel(latest.name, latest.running) : 'Thinking'}…</span>
        <ChevronRightIcon className="size-4 fill-current transition-transform duration-150 group-open/work:rotate-90 motion-reduce:transition-none" />
      </summary>
      <WorkDisclosureContent activity={activity} />
    </details>
  )
}

function FileLink({ familyId, file }: { familyId: FamilyId; file: ChannelFile }) {
  return (
    <div className="flex min-h-11 items-stretch rounded-xl bg-panel text-base text-ink ring-1 ring-line sm:text-sm">
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
    <section className="flex max-w-xl flex-col gap-4 rounded-xl border border-line-strong bg-panel p-5" aria-label="Connector approval">
      <div className="flex flex-col gap-1">
        <h3 className="text-base font-semibold text-ink sm:text-sm">{block.title}</h3>
        <p className="whitespace-pre-wrap text-base/7 text-muted sm:text-sm/6">{block.description}</p>
      </div>
      {status === 'pending' ? (
        <div className="flex gap-2">
          <Button type="button" variant="secondary" disabled={decide.isPending} onClick={() => decide.mutate('approved')}>
            Approve
          </Button>
          <Button type="button" variant="ghost" disabled={decide.isPending} onClick={() => decide.mutate('rejected')}>
            Cancel
          </Button>
        </div>
      ) : (
        <p className="text-sm font-medium text-muted">{status === 'succeeded' ? 'Completed' : status === 'rejected' ? 'Cancelled' : status === 'expired' ? 'Expired' : status === 'failed' ? 'Failed' : status === 'outcome_unknown' ? 'Outcome unknown — Ronto will not retry automatically' : 'Approved'}</p>
      )}
      {error && <p role="alert" className="text-base text-danger sm:text-sm">{error}</p>}
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

function CopyMessage({ text }: { text: string }) {
  const [status, setStatus] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try { await navigator.clipboard.writeText(text); setStatus('copied') }
    catch { setStatus('failed') }
  }
  useEffect(() => {
    if (status === 'idle') return
    const timeout = window.setTimeout(() => setStatus('idle'), 2000)
    return () => window.clearTimeout(timeout)
  }, [status])
  return <>
    <Button type="button" variant="ghost" size="icon" className="copy-message" aria-label={status === 'copied' ? 'Response copied' : 'Copy response'} title={status === 'copied' ? 'Copied' : 'Copy response'} onClick={() => void copy()}>{status === 'copied' ? <CheckIcon className="size-4 shrink-0 fill-current" /> : <ClipboardDocumentIcon className="size-4 shrink-0 fill-current" />}</Button>
    <span role="status" className="sr-only">{status === 'copied' ? 'Response copied.' : status === 'failed' ? 'Clipboard unavailable. Select the response to copy it.' : ''}</span>
  </>
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
    <li>
      <article className="chat-message message-agent">
        <WorkDisclosure message={message} />
        {text && <RenderMarkdown>{text}</RenderMarkdown>}
        {approvals.map((approval) => <ApprovalCard key={approval.approvalId} familyId={familyId} block={approval} />)}
        {attachments.length > 0 && <div className="flex w-full flex-col gap-2">{attachments.map((file) => <FileLink key={file.id} familyId={familyId} file={file} />)}</div>}
        <div className="message-footer"><p className="message-meta">Ronto <span aria-hidden="true">·</span> <time dateTime={DateTime.formatIso(message.createdAt)}>{time}</time></p>{text && <CopyMessage text={text} />}</div>
      </article>
    </li>
  )

  const member = members.find(({ id }) => id === message.senderMemberId)
  const identity = message.senderType === 'external'
    ? speakerIdentity(message.externalSenderId, message.externalSenderName)
    : speakerIdentity(member?.id, member?.name)
  const scheduled = message.senderType === 'external' && message.externalSenderId?.startsWith('schedule:') === true
  if (scheduled) return <li>
    <article className="chat-message scheduled-message">
      <div className="message-meta"><CalendarDaysIcon className="size-4 shrink-0 fill-current" /><p>Scheduled task</p><time dateTime={DateTime.formatIso(message.createdAt)}>{time}</time></div>
      <details className="scheduled-prompt"><summary><ChevronRightIcon className="size-4 shrink-0 fill-current" /><span>View task instructions</span></summary><div className="member-bubble">{text}</div></details>
    </article>
  </li>
  if (fromCurrentMember) return (
    <li>
      <article className="chat-message message-self">
        {text && <div className="member-bubble">{text}</div>}
        {attachments.length > 0 && <div className="flex w-full flex-col gap-2">{attachments.map((file) => <FileLink key={file.id} familyId={familyId} file={file} />)}</div>}
        <p className="message-meta">You <span aria-hidden="true">·</span> <time dateTime={DateTime.formatIso(message.createdAt)}>{time}</time></p>
      </article>
    </li>
  )

  return (
    <li>
      <article className="chat-message message-other">
        <p className="message-meta">
          <span className={cn('font-semibold', identity.color)}>{identity.name}</span>
          {message.senderType === 'external' && <span className="message-source">WhatsApp guest</span>}
          <time dateTime={DateTime.formatIso(message.createdAt)}>{time}</time>
        </p>
        {text && <div className="member-bubble">{text}</div>}
        {attachments.length > 0 && <div className="flex w-full flex-col gap-2">{attachments.map((file) => <FileLink key={file.id} familyId={familyId} file={file} />)}</div>}
      </article>
    </li>
  )
}

function EmptyConversation({ onSuggest }: { onSuggest: (prompt: string) => void }) {
  return (
    <div className="empty-conversation">
      <SparklesIcon className="size-4 shrink-0 fill-accent" aria-hidden="true" />
      <div className="empty-conversation-heading">
        <h2>A little help with everyday life.</h2>
        <p>Big plans, small questions, and everything your family has going on.</p>
      </div>
      <div className="conversation-suggestions" aria-label="Conversation starters">
        <button type="button" onClick={() => onSuggest('Help us plan something fun for this weekend.')}><MapIcon className="size-4 shrink-0 fill-current" />Plan a weekend</button>
        <button type="button" onClick={() => onSuggest('Help me set up a reminder for the family.')}><CalendarDaysIcon className="size-4 shrink-0 fill-current" />Set a reminder</button>
        <button type="button" onClick={() => onSuggest('I have a family detail I’d like you to remember: ')}><BookOpenIcon className="size-4 shrink-0 fill-current" />Remember a detail</button>
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

  return <form className="flex min-w-0 flex-col gap-5" onSubmit={(event) => {
    event.preventDefault()
    updateMemory.mutate({ scope, content: scope === 'family' ? familyText : channelText, revision: scope === 'family' ? familyMemory.revision : channelMemory.revision })
  }} onKeyDown={(event) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && !updateMemory.isPending) {
      event.preventDefault()
      event.currentTarget.requestSubmit()
    }
  }}>
    <div className="flex self-start rounded-lg bg-soft p-1" role="tablist" aria-label="Memory scope" onKeyDown={(event) => {
      if (updateMemory.isPending || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'family' : event.key === 'End' ? 'channel' : scope === 'family' ? 'channel' : 'family'
      setScope(next)
      event.currentTarget.querySelector<HTMLButtonElement>(`#memory-${next}-tab`)?.focus()
    }}>
      <button id="memory-family-tab" type="button" role="tab" aria-controls="memory-scope-panel" aria-selected={scope === 'family'} tabIndex={scope === 'family' ? 0 : -1} disabled={updateMemory.isPending} className={cn('h-7 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 pointer-coarse:min-h-11', scope === 'family' ? 'bg-panel text-ink inset-ring inset-ring-line' : 'text-muted hover:text-ink')} onClick={() => setScope('family')}>Family</button>
      <button id="memory-channel-tab" type="button" role="tab" aria-controls="memory-scope-panel" aria-selected={scope === 'channel'} tabIndex={scope === 'channel' ? 0 : -1} disabled={updateMemory.isPending} className={cn('h-7 rounded-md px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-50 pointer-coarse:min-h-11', scope === 'channel' ? 'bg-panel text-ink inset-ring inset-ring-line' : 'text-muted hover:text-ink')} onClick={() => setScope('channel')}>Channel</button>
    </div>
    <div id="memory-scope-panel" role="tabpanel" aria-labelledby={`memory-${scope}-tab`} className="flex min-w-0 flex-col gap-3">
      <p id="memory-scope-description" className="text-base/7 text-muted sm:text-sm/6">{scope === 'family' ? 'The details Ronto remembers across every family channel.' : `Details Ronto only uses in ${channelName}.`}</p>
      <Textarea name={`${scope}Memory`} aria-label={`${scope === 'family' ? 'Family' : 'Channel'} memory Markdown`} aria-describedby="memory-scope-description memory-format-help" value={scope === 'family' ? familyText : channelText} onChange={(event) => scope === 'family' ? setFamilyText(event.target.value) : setChannelText(event.target.value)} className="h-[36dvh] min-h-40 max-h-[55dvh] resize-y bg-canvas font-mono text-base/7 sm:text-sm/6" disabled={updateMemory.isPending} />
      <p id="memory-format-help" className="text-sm/6 text-muted">Write naturally, or use Markdown to keep things organized.</p>
    </div>
    {error && <p role="alert" className="text-sm/6 text-danger">{error}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
      <Button variant="ghost" size="compact" onClick={() => scope === 'family' ? setFamilyText('') : setChannelText('')} disabled={updateMemory.isPending}>Clear all</Button>
      <div className="flex gap-2"><Button variant="secondary" onClick={onClose} disabled={updateMemory.isPending}>Cancel</Button><Button type="submit" variant="primary" disabled={updateMemory.isPending}>{updateMemory.isPending ? 'Saving…' : 'Save memory'}</Button></div>
    </div>
  </form>
}

function MemoryDialog({ familyId, channel, onClose }: { familyId: FamilyId; channel: ChannelDto; onClose: () => void }) {
  const familyMemory = useQuery(familyMemoryQuery(familyId))
  const channelMemory = useQuery(channelMemoryQuery(familyId, channel.id))
  const error = familyMemory.error ?? channelMemory.error
  return (
    <SettingsDialog title="Memory" description="A shared understanding, kept in your words. Review or edit the details Ronto carries between conversations." onClose={onClose}>
      {familyMemory.isPending || channelMemory.isPending ? <p role="status" className="py-8 text-sm/6 text-muted">Loading memory…</p> : error ? <p role="alert" className="text-sm/6 text-danger">{error instanceof Error ? error.message : 'Unable to load memory.'}</p> : familyMemory.data && channelMemory.data ? <MemoryEditor key={`${familyMemory.data.revision}:${channelMemory.data.revision}`} familyId={familyId} channelId={channel.id} channelName={channel.name} familyMemory={familyMemory.data} channelMemory={channelMemory.data} onClose={onClose} /> : null}
    </SettingsDialog>
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
  const loading = channelsResult.isPending || conversationsResult.isPending || membersResult.isPending || (selectedId !== null && messagesResult.isPending)
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
    <header className="chat-header">
      <Button ref={menuButtonRef} type="button" variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" onClick={onOpenMenu}>
        <span className="pointer-fine:hidden absolute top-1/2 left-1/2 size-[max(100%,3rem)] -translate-1/2" aria-hidden="true" />
        <Bars3Icon className="size-4 shrink-0 fill-current" />
      </Button>
      <div className="chat-breadcrumb">
        <p className="breadcrumb-channel" title={selectedChannel?.purpose}>{selectedChannel?.name ?? 'Ronto'}</p>
        <ChevronRightIcon className="size-4 shrink-0" aria-hidden="true" />
        <h1>{selectedConversation ? conversationTitle(selectedConversation) : 'Your family space'}</h1>
      </div>
      {selectedChannel && <Button ref={memoryButtonRef} type="button" variant="ghost" size="compact" className="memory-button" aria-label="Open memory" title="Family & channel memory" onClick={onOpenMemory}><BookOpenIcon className="size-4 shrink-0 fill-current" /><span>Memory</span></Button>}
    </header>
  )
}

function ChatTimeline({ familyId, viewportRef, onContentRef, onScroll, onTouchStart, onWheel, loading, selectedId, messages, channelFiles, members, currentMemberId, showStreamDraft, pendingText, pendingFiles, showPendingAgent, pendingActivity, pendingResponse, onSuggest, onCreate }: {
  onSuggest: (prompt: string) => void
  onCreate: (() => Promise<void>) | undefined
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
    <div ref={viewportRef} className="timeline-viewport" onScroll={onScroll} onTouchStart={onTouchStart} onWheel={onWheel}>
      <div ref={onContentRef} className="timeline-content">
        {loading ? (
          <div className="timeline-loading" role="status" aria-label="Loading conversation"><div className="skeleton-line" /><div className="skeleton-line" /><div className="skeleton-line" /></div>
        ) : selectedId === null ? (
          <div className="empty-conversation"><SparklesIcon className="size-4 shrink-0 fill-accent" aria-hidden="true" /><div className="empty-conversation-heading"><h2>A fresh space for your family.</h2><p>Start a chat to ask a question, make a plan, or share what’s on your mind.</p></div><Button variant="primary" disabled={onCreate === undefined} onClick={() => { void onCreate?.().catch(() => undefined) }}>Start a chat</Button></div>
        ) : messages.length === 0 && pendingText === null && pendingFiles.length === 0 ? (
          <EmptyConversation onSuggest={onSuggest} />
        ) : (
          <ul className="message-list" role="list">
            {messages.map((message) => <Message key={message.id} familyId={familyId} message={message} files={channelFiles} members={members} currentMemberId={currentMemberId} />)}
            {((showStreamDraft && (pendingText !== null || pendingFiles.length > 0)) || showPendingAgent) && (
              <li className="flex flex-col gap-6">
                {showStreamDraft && (pendingText !== null || pendingFiles.length > 0) && <div className="flex justify-end">
                  <div className="flex max-w-[min(42rem,88%)] flex-col items-end gap-2">
                    {pendingText && <div className="member-bubble">{pendingText}</div>}
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
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [memoryOpen, setMemoryOpen] = useState(false)
  const [familyOpen, setFamilyOpen] = useState(false)
  const [whatsappOpen, setWhatsappOpen] = useState(false)
  const [connectorsOpen, setConnectorsOpen] = useState(false)
  const [schedulesOpen, setSchedulesOpen] = useState(false)
  const timelineViewport = useRef<HTMLDivElement>(null)
  const [timelineContent, setTimelineContent] = useState<HTMLDivElement | null>(null)
  const shouldAutoScroll = useRef(true)
  const autoScrollAnimating = useRef(false)
  const bottomChaseFrame = useRef<number | null>(null)
  const bottomChaseLastTop = useRef(0)
  const fileInput = useRef<HTMLInputElement>(null)
  const composerTextarea = useRef<HTMLTextAreaElement>(null)
  const menuButton = useRef<HTMLButtonElement>(null)
  const memoryButton = useRef<HTMLButtonElement>(null)
  const settingsButton = useRef<HTMLButtonElement>(null)
  const schedulesButton = useRef<HTMLButtonElement>(null)
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
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
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
    <main className="ronto-workspace isolate flex h-dvh overflow-hidden bg-canvas antialiased">
      <WorkspaceSidebar
        channels={channels}
        conversations={channelConversations}
        selectedChannelId={selectedChannelId}
        selectedId={selectedId}
        workingConversationId={selectedIsWorking || (sending && showStreamDraft) ? selectedId : null}
        me={me}
        familyId={familyId}
        onSelectFamily={(id) => { void navigate({ search: { family: id } }) }}
        onOpenPlatform={() => { void navigate({ search: { platform: true } }) }}
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
        onManageSchedules={() => { setMobileOpen(false); setSchedulesOpen(true) }}
        settingsButtonRef={settingsButton}
        schedulesButtonRef={schedulesButton}
      />

      <section className="chat-workspace" inert={mobileOpen || undefined}>
        <ChatHeader selectedChannel={selectedChannel} selectedConversation={selected} menuButtonRef={menuButton} memoryButtonRef={memoryButton} onOpenMenu={() => setMobileOpen(true)} onOpenMemory={() => setMemoryOpen(true)} />

        <ChatTimeline
          onSuggest={(prompt) => { setDraft(prompt); composerTextarea.current?.focus() }}
          onCreate={selectedChannelId === null ? undefined : createConversation}
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

        <ChatComposer selectedId={selectedId} sending={sending} selectedIsWorking={selectedIsWorking} selectedFiles={selectedFiles} fileInputRef={fileInput} textareaRef={composerTextarea} draft={draft} onDraftChange={setDraft} errorMessage={error ?? queryError} onSubmit={send} onComposerKeyDown={handleComposerKeyDown} onFilesSelected={setSelectedFiles} onRemoveFile={(index) => setSelectedFiles((current) => current.filter((_, at) => at !== index))} onStopResponse={stopResponse} />
      </section>
      {memoryOpen && selectedChannel && <MemoryDialog familyId={familyId} channel={selectedChannel} onClose={() => { setMemoryOpen(false); requestAnimationFrame(() => memoryButton.current?.focus()) }} />}
      {familyOpen && <FamilyDialog familyId={familyId} channels={channels} onClose={() => { setFamilyOpen(false); requestAnimationFrame(() => settingsButton.current?.focus()) }} />}
      {whatsappOpen && <WhatsappDialog familyId={familyId} conversationId={selectedId} isPrimary={membership.member.role === 'primary'} onClose={() => { setWhatsappOpen(false); requestAnimationFrame(() => settingsButton.current?.focus()) }} />}
      {connectorsOpen && <ConnectorsDialog familyId={familyId} onClose={() => { setConnectorsOpen(false); requestAnimationFrame(() => settingsButton.current?.focus()) }} />}
      {schedulesOpen && <SchedulesDialog familyId={familyId} onClose={() => {
        setSchedulesOpen(false)
        requestAnimationFrame(() => { (window.matchMedia('(min-width: 1024px)').matches ? schedulesButton : menuButton).current?.focus() })
      }} />}
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
    <main className="isolate flex min-h-dvh flex-col bg-canvas px-6 py-6 text-ink sm:px-10 sm:py-10">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4"><Brand /><Button variant="ghost" size="compact" onClick={() => void onSignOut()}>Sign out</Button></header>
      <section className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-7 py-12 sm:py-20">
        <div className="flex flex-col gap-3">
          <h1 className="text-3xl font-medium tracking-tight text-balance">A familiar place to begin.</h1>
          <p className="text-base/7 text-muted sm:text-sm/6">
            {unavailable ? 'That family is unavailable to this account. Choose one you belong to.' : 'Choose the family you want to open.'}
          </p>
        </div>
        <ul role="list" aria-label="Your families" className="flex flex-col gap-2">
          {me.memberships.map(({ family, member }) => (
            <li key={family.id}>
              <button type="button" className="flex min-h-18 w-full items-center justify-between gap-4 rounded-xl border border-line-strong bg-panel p-4 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" onClick={() => onSelect(family.id)}>
                <div className="flex min-w-0 flex-col gap-1"><p className="break-words text-base font-medium">{family.name}</p><p className="text-sm text-muted">{member.role === 'primary' ? 'Primary member' : 'Family member'}</p></div>
                <ArrowRightIcon aria-hidden="true" className="size-4 shrink-0 fill-muted" />
              </button>
            </li>
          ))}
        </ul>
        <p className="break-words text-sm/6 text-muted">Signed in as {me.user.email}.</p>
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
