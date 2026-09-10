import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'effect'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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
  return <section className="flex flex-col gap-4 rounded-xl bg-cat-mantle p-5">
    <h2 className="text-lg font-semibold">Shared WhatsApp transport</h2>
    <p className="text-sm/6 text-cat-subtext-0">Only the platform administrator can pair Ronto's dedicated number. This connection serves every family; it does not grant access to their chats or linked identities.</p>
    <p role="status" className="text-sm">Connection: {status?.replaceAll('_', ' ') ?? 'checking'}</p>
    {status === 'disabled' && <p className="text-sm text-cat-subtext-0">WhatsApp must be enabled on the server before pairing.</p>}
    {canPair && <form className="flex flex-col gap-3" onSubmit={(event) => {
      event.preventDefault()
      const phoneNumber = String(new FormData(event.currentTarget).get('phoneNumber') ?? '')
      pair.reset()
      pair.mutate(phoneNumber)
    }}>
      <label htmlFor="platform-whatsapp-number" className="text-sm">Dedicated WhatsApp number</label>
      <Input id="platform-whatsapp-number" name="phoneNumber" type="tel" autoComplete="tel" placeholder="Country code and number, e.g. 61412345678" required disabled={pair.isPending} />
      <Button type="submit" className="min-h-11 self-start" disabled={pair.isPending}>Get pairing code</Button>
      {pair.data && <div className="flex flex-col gap-2" role="status"><p className="text-sm/6 text-cat-subtext-0">On the dedicated phone, open Linked devices, choose Link with phone number, then enter:</p><Input aria-label="WhatsApp pairing code" readOnly value={pair.data.code} onFocus={(event) => event.currentTarget.select()} /></div>}
    </form>}
    {error && <p role="alert" className="text-sm text-cat-red">{error.message}</p>}
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
    <main className="min-h-dvh bg-cat-crust p-6 text-cat-text sm:p-10">
      <section className="mx-auto flex max-w-3xl flex-col gap-6">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Platform administration</h1>
          <div className="flex gap-2"><Button type="button" variant="secondary" onClick={onClose}>Back to families</Button><Button type="button" variant="ghost" onClick={() => void onSignOut()}>Sign out</Button></div>
        </header>
        <p className="text-sm/6 text-cat-subtext-0">Platform authority manages admission, not family content. It grants no access to family messages, files, memory, or connected accounts.</p>
        <WhatsappTransport />
        <section className="flex flex-col gap-4 rounded-xl bg-cat-mantle p-5">
          <h2 className="text-lg font-semibold">Family operations</h2>
          <p className="text-sm/6 text-cat-subtext-0">Operational metadata only. Durable usage includes workspace files, memory, managed files, and user-installed tools without revealing names or content.</p>
          {families.isPending ? <p>Loading family metadata…</p> : <ul className="flex flex-col gap-4">{families.data?.map((family) => <li key={family.id} className="flex flex-col gap-2 border-t border-cat-surface-0 pt-3">
            <h3 className="font-medium">{family.name}</h3>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm text-cat-subtext-0">
              <dt>Creator</dt><dd>{family.creatorName ?? 'Not recorded'}</dd>
              <dt>Members</dt><dd className="tabular-nums">{family.memberCount}</dd>
               <dt>Managed files</dt><dd className="tabular-nums">{family.managedFileBytes.toLocaleString()} bytes</dd>
               <dt>Total durable usage</dt><dd className="tabular-nums">{family.durableStorageBytes.toLocaleString()} / {family.limits.storageBytes.toLocaleString()} bytes</dd>
              <dt>Created</dt><dd className="break-all">{DateTime.formatIso(family.createdAt)}</dd>
              <dt>Updated</dt><dd className="break-all">{DateTime.formatIso(family.updatedAt)}</dd>
               <dt>Sandbox</dt><dd className={family.sandboxStatus === 'unhealthy' ? 'text-cat-red' : undefined}>{family.sandboxStatus}</dd>
               <dt>Fixed limits</dt><dd>{family.limits.cpus} CPUs · {(family.limits.memoryBytes / 1024 ** 3).toLocaleString()} GiB memory · {family.limits.pids} processes · {family.limits.commandSeconds / 60} min command · {family.limits.temporaryBytes / 1024 ** 2} MiB temp · {family.limits.outputBytes / 1024 ** 2} MiB output</dd>
            </dl>
          </li>)}</ul>}
        </section>
        <section className="flex flex-col gap-4 rounded-xl bg-cat-mantle p-5">
          <h2 className="text-lg font-semibold">Family creation invitations</h2>
          <p className="text-sm/6 text-cat-subtext-0">Each link expires after seven days and grants one person permission to create one family. Share it privately.</p>
          <Button type="button" className="self-start" disabled={create.isPending || revoke.isPending} onClick={() => create.mutate()}>Create invitation</Button>
          {link && <div className="flex flex-col gap-2"><label htmlFor="platform-invite-link" className="text-sm">Private invitation link</label><Input id="platform-invite-link" readOnly value={link} onFocus={(event) => event.currentTarget.select()} /><Button type="button" variant="secondary" className="self-start" onClick={() => {
            void navigator.clipboard.writeText(link).then(() => setNotice('Invitation copied.'), () => setNotice('Select the link above and copy it manually.'))
          }}>Copy link</Button></div>}
          <p role="status" className="min-h-6 text-sm text-cat-subtext-0">{notice}</p>
          {error && <p role="alert" className="text-sm text-cat-red">{error instanceof Error ? error.message : 'Unable to manage invitations.'}</p>}
          {invitations.isPending ? <p>Loading invitations…</p> : <ul className="flex flex-col gap-3">
            {invitations.data?.map((invite) => {
              const expired = DateTime.toEpochMillis(invite.expiresAt) <= Date.now()
              const status = invite.claimedAt ? 'Claimed' : invite.revokedAt ? 'Revoked' : expired ? 'Expired' : 'Available'
              return <li key={invite.id} className="flex flex-wrap items-center justify-between gap-3 border-t border-cat-surface-0 pt-3">
                <div className="flex flex-col gap-1"><span className="text-sm font-medium">{status}</span><span className="text-xs text-cat-subtext-0">Expires {DateTime.formatIso(invite.expiresAt)}</span></div>
                {status === 'Available' && <Button type="button" variant="secondary" disabled={revoke.isPending} onClick={() => revoke.mutate(invite.id)}>Revoke invitation</Button>}
              </li>
            })}
          </ul>}
        </section>
      </section>
    </main>
  )
}
