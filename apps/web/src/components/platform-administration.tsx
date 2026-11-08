import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'effect'
import { ArrowLeftIcon, ClipboardIcon, PlusIcon, ShieldCheckIcon } from '@heroicons/react/16/solid'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

function formatBytes(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toLocaleString(undefined, { maximumFractionDigits: 1 })} GiB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toLocaleString(undefined, { maximumFractionDigits: 1 })} MiB`
  if (bytes >= 1024) return `${(bytes / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`
  return `${bytes.toLocaleString()} bytes`
}

function WhatsappTransport() {
  const health = useQuery({
    queryKey: ['platform', 'whatsapp', 'health'],
    queryFn: ({ signal }) => api.getPlatformWhatsappHealth(signal),
    refetchInterval: 5_000,
  })
  const pair = useMutation({ mutationFn: api.requestWhatsappPairingCode })
  const status = health.data?.status
  const error = health.error ?? pair.error
  const canPair = status === 'pairing' || status === 'logged_out'
  return <section aria-labelledby="whatsapp-heading" className="flex min-w-0 flex-col gap-5 border-b border-line pb-8">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 id="whatsapp-heading" className="text-base font-semibold text-balance">WhatsApp connection</h2>
      <p role="status" className="flex items-center gap-2 rounded-md bg-soft px-2.5 py-1 text-sm text-muted">
        <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${status === 'connected' ? 'bg-success' : status === 'logged_out' ? 'bg-warning' : 'bg-faint'}`} />
        <span className="capitalize">{status?.replaceAll('_', ' ') ?? 'Checking connection'}</span>
      </p>
    </div>
    <p className="max-w-[70ch] text-base/7 text-pretty text-muted sm:text-sm/6">Connect Ronto’s dedicated number for every family. This shared connection does not grant access to family chats or linked identities.</p>
    {status === 'disabled' && <p className="rounded-lg bg-soft px-4 py-3 text-base/7 text-muted sm:text-sm/6">Enable WhatsApp on the server before pairing a number.</p>}
    {canPair && <form className="flex max-w-lg flex-col gap-3" onSubmit={(event) => {
      event.preventDefault()
      const phoneNumber = String(new FormData(event.currentTarget).get('phoneNumber') ?? '')
      pair.reset()
      pair.mutate(phoneNumber)
    }}>
      <div className="flex flex-col gap-2">
        <label htmlFor="platform-whatsapp-number" className="text-sm font-medium">Dedicated WhatsApp number</label>
        <Input id="platform-whatsapp-number" name="phoneNumber" type="tel" autoComplete="tel" inputMode="tel" aria-describedby="platform-whatsapp-help" placeholder="61412345678" required disabled={pair.isPending} />
        <p id="platform-whatsapp-help" className="text-sm/6 text-muted">Include the country code, without spaces or a plus sign.</p>
      </div>
      <Button type="submit" className="self-start" disabled={pair.isPending}>{pair.isPending ? 'Getting code…' : 'Get pairing code'}</Button>
      {pair.data && <div className="flex flex-col gap-3 rounded-lg bg-soft p-4" role="status"><p className="text-base/7 text-muted sm:text-sm/6">On the dedicated phone, open Linked devices, choose Link with phone number, then enter:</p><Input name="pairingCode" aria-label="WhatsApp pairing code" className="font-mono tracking-widest" readOnly value={pair.data.code} onFocus={(event) => event.currentTarget.select()} /></div>}
    </form>}
    {error && <p role="alert" className="text-sm/6 text-danger">{error.message}</p>}
  </section>
}

export function PlatformAdministration({ onClose, onSignOut }: {
  onClose: () => void
  onSignOut: () => Promise<void>
}) {
  const queryClient = useQueryClient()
  const invitations = useQuery({ queryKey: ['platform', 'invitations'], queryFn: ({ signal }) => api.listPlatformInvitations(signal) })
  const families = useQuery({ queryKey: ['platform', 'families'], queryFn: ({ signal }) => api.listPlatformFamilies(signal) })
  const [link, setLink] = useState('')
  const [notice, setNotice] = useState('')
  const create = useMutation({
    mutationFn: api.createPlatformInvitation,
    onSuccess: async ({ token }) => {
      const url = new URL('/', window.location.origin)
      url.searchParams.set('platformInvite', token)
      setLink(url.href)
      setNotice('Copy this private link now. It cannot be retrieved later.')
      await queryClient.invalidateQueries({ queryKey: ['platform', 'invitations'] })
    },
  })
  const revoke = useMutation({
    mutationFn: api.revokePlatformInvitation,
    onSuccess: async () => {
      setLink('')
      setNotice('Invitation revoked.')
      await queryClient.invalidateQueries({ queryKey: ['platform', 'invitations'] })
    },
  })
  const error = invitations.error ?? families.error ?? create.error ?? revoke.error
  return (
    <main className="isolate min-h-dvh bg-canvas py-6 text-ink antialiased sm:py-10">
      <div className="mx-auto flex max-w-4xl flex-col gap-8 px-5 sm:px-8">
        <header className="flex flex-col gap-7">
          <div className="flex items-center justify-between gap-3">
            <Button variant="ghost" size="compact" className="-ml-2.5" onClick={onClose}><ArrowLeftIcon aria-hidden="true" />Back to families</Button>
            <Button variant="ghost" size="compact" onClick={() => void onSignOut()}>Sign out</Button>
          </div>
          <div className="flex flex-col gap-3">
            <p className="flex items-center gap-2 text-sm font-medium text-muted"><ShieldCheckIcon aria-hidden="true" className="size-4 shrink-0" />Platform workspace</p>
            <h1 className="text-2xl font-semibold tracking-tight text-balance">Administration</h1>
            <p className="max-w-[70ch] text-base/7 text-pretty text-muted sm:text-sm/6">Manage family admission and shared connections. Family messages, files, memory, and connected accounts remain private.</p>
          </div>
        </header>
        <div className="flex min-w-0 flex-col gap-8 rounded-2xl border border-line bg-panel p-5 sm:p-7">
          <WhatsappTransport />
          <section aria-labelledby="families-heading" className="flex min-w-0 flex-col gap-5 border-b border-line pb-8">
            <div className="flex items-center justify-between gap-3">
              <h2 id="families-heading" className="text-base font-semibold text-balance">Family operations</h2>
              {families.data && <p className="text-sm text-muted tabular-nums">{families.data.length} {families.data.length === 1 ? 'family' : 'families'}</p>}
            </div>
            <p className="max-w-[70ch] text-base/7 text-pretty text-muted sm:text-sm/6">Operational metadata only. Storage includes workspace files, memory, managed files, and installed tools, without revealing names or content.</p>
            {families.isPending ? <p role="status" className="py-6 text-sm text-muted">Loading family metadata…</p> : <ul role="list" className="flex flex-col divide-y divide-line">{families.data?.map((family) => <li key={family.id} className="@container flex min-w-0 flex-col gap-4 py-5 first:pt-0 last:pb-0">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h3 className="min-w-0 text-base font-medium text-balance">{family.name}</h3>
                <p className={`flex items-center gap-2 text-sm ${family.sandboxStatus === 'unhealthy' ? 'text-danger' : 'text-muted'}`}><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${family.sandboxStatus === 'unhealthy' ? 'bg-danger' : family.sandboxStatus === 'ready' ? 'bg-success' : 'bg-faint'}`} /><span className="capitalize">{family.sandboxStatus}</span></p>
              </div>
              <dl className="grid min-w-0 gap-x-6 gap-y-4 text-base/7 @lg:grid-cols-2 sm:text-sm/6 [&_dt]:font-medium [&_dt]:text-ink [&_dd]:text-muted">
                <div><dt>Creator</dt><dd className="break-words">{family.creatorName ?? 'Not recorded'}</dd></div>
                <div><dt>Members</dt><dd className="tabular-nums">{family.memberCount}</dd></div>
                <div><dt>Managed files</dt><dd className="tabular-nums" title={`${family.managedFileBytes.toLocaleString()} bytes`}>{formatBytes(family.managedFileBytes)}</dd></div>
                <div><dt>Durable storage</dt><dd className="tabular-nums" title={`${family.durableStorageBytes.toLocaleString()} / ${family.limits.storageBytes.toLocaleString()} bytes`}>{formatBytes(family.durableStorageBytes)} of {formatBytes(family.limits.storageBytes)}</dd></div>
                <div><dt>Created</dt><dd className="break-words"><time dateTime={DateTime.formatIso(family.createdAt)}>{DateTime.toDate(family.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>
                <div><dt>Updated</dt><dd className="break-words"><time dateTime={DateTime.formatIso(family.updatedAt)}>{DateTime.toDate(family.updatedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></dd></div>
                <div className="@lg:col-span-2"><dt>Sandbox limits</dt><dd className="text-pretty tabular-nums">{family.limits.cpus} CPUs · {(family.limits.memoryBytes / 1024 ** 3).toLocaleString()} GiB memory · {family.limits.pids} processes · {family.limits.commandSeconds / 60} min command · {family.limits.temporaryBytes / 1024 ** 2} MiB temp · {family.limits.outputBytes / 1024 ** 2} MiB output</dd></div>
              </dl>
            </li>)}</ul>}
            {families.data?.length === 0 && <p className="rounded-lg bg-soft px-4 py-6 text-base/7 text-muted sm:text-sm/6">No families yet. Create a private invitation below to welcome the first one.</p>}
          </section>
          <section aria-labelledby="invitations-heading" className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="invitations-heading" className="text-base font-semibold text-balance">Family invitations</h2>
              <Button variant="primary" className="pl-2.5 pr-3" disabled={create.isPending || revoke.isPending} onClick={() => create.mutate()}><PlusIcon aria-hidden="true" />{create.isPending ? 'Creating…' : 'Create invitation'}</Button>
            </div>
            <p className="max-w-[70ch] text-base/7 text-pretty text-muted sm:text-sm/6">Each private link lets one person create one family and expires after seven days. Share it only with the intended recipient.</p>
            {link && <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-soft p-4"><label htmlFor="platform-invite-link" className="text-sm font-medium">Private invitation link</label><Input id="platform-invite-link" name="invitationLink" readOnly value={link} onFocus={(event) => event.currentTarget.select()} /><Button variant="secondary" size="compact" className="self-start pl-1.5 pr-2.5" onClick={() => {
              void navigator.clipboard.writeText(link).then(() => setNotice('Invitation copied.'), () => setNotice('Select the link above and copy it manually.'))
            }}><ClipboardIcon aria-hidden="true" />Copy link</Button></div>}
            <p role="status" className="min-h-5 text-sm/5 text-muted empty:hidden">{notice}</p>
            {error && <p role="alert" className="rounded-lg bg-danger/5 px-4 py-3 text-sm/6 text-danger">{error instanceof Error ? error.message : 'Unable to manage invitations.'}</p>}
            {invitations.isPending ? <p role="status" className="py-6 text-sm text-muted">Loading invitations…</p> : <ul role="list" className="flex flex-col divide-y divide-line">
            {invitations.data?.map((invite) => {
              const expired = DateTime.toEpochMillis(invite.expiresAt) <= Date.now()
              const status = invite.claimedAt ? 'Claimed' : invite.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Available'
              return <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 py-4 first:pt-0 last:pb-0">
                <div className="flex min-w-0 flex-col gap-1 text-sm">
                  <p className={`font-medium ${status === 'Available' ? 'text-success' : 'text-muted'}`}>{status}</p>
                  <p className="break-words text-muted">Expires <time dateTime={DateTime.formatIso(invite.expiresAt)}>{DateTime.toDate(invite.expiresAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}</time></p>
                </div>
                {status === 'Available' && <Button variant="ghost" size="compact" disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id)}>Revoke invitation</Button>}
              </li>
            })}
            </ul>}
            {invitations.data?.length === 0 && <p className="rounded-lg bg-soft px-4 py-6 text-base/7 text-muted sm:text-sm/6">No invitations yet. New invitations will appear here.</p>}
          </section>
        </div>
        <p className="flex items-start gap-2 text-sm/6 text-muted"><ShieldCheckIcon aria-hidden="true" className="h-lh w-4 shrink-0" />Platform access never grants access to family content.</p>
      </div>
    </main>
  )
}
