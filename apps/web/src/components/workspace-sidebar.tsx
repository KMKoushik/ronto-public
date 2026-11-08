import {
  ArrowRightStartOnRectangleIcon,
  CalendarDaysIcon,
  ChatBubbleLeftRightIcon,
  ChevronDownIcon,
  EllipsisHorizontalIcon,
  HashtagIcon,
  MagnifyingGlassIcon,
  PencilSquareIcon,
  PlusIcon,
  ShieldCheckIcon,
  TrashIcon,
  UserGroupIcon,
  WrenchScrewdriverIcon,
  XMarkIcon,
} from '@heroicons/react/16/solid'
import type { ChannelDto, ChannelId, ConversationDto, ConversationId, FamilyId, MeDto } from '@ronto/api'
import { DateTime } from 'effect'
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent, type RefObject } from 'react'

import { Brand } from '@/components/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { conversationTitle } from '@/lib/conversations'
import { cn } from '@/lib/utils'

function conversationGroup(conversation: ConversationDto) {
  const date = DateTime.toDate(conversation.updatedAt)
  const today = new Date()
  if (date.toDateString() === today.toDateString()) return 'Today'
  const yesterday = new Date(today)
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday'
  return 'Earlier'
}

export function WorkspaceSidebar({ channels, conversations, selectedChannelId, selectedId, workingConversationId, me, familyId, mobileOpen, onClose, onSelectFamily, onOpenPlatform, onSelectChannel, onSelect, onDelete, onCreateChannel, onCreate, onSignOut, onManageFamily, onManageWhatsapp, onManageConnectors, onManageSchedules, isPrimary, settingsButtonRef, schedulesButtonRef }: {
  channels: ReadonlyArray<ChannelDto>
  conversations: ReadonlyArray<ConversationDto>
  selectedChannelId: ChannelId | null
  selectedId: ConversationId | null
  workingConversationId: ConversationId | null
  me: MeDto
  familyId: FamilyId
  isPrimary: boolean
  mobileOpen: boolean
  settingsButtonRef: RefObject<HTMLButtonElement | null>
  schedulesButtonRef: RefObject<HTMLButtonElement | null>
  onClose: () => void
  onSelectFamily: (id: FamilyId) => void
  onOpenPlatform: () => void
  onSelectChannel: (id: ChannelId) => void
  onSelect: (id: ConversationId) => void
  onDelete: (id: ConversationId) => Promise<void>
  onCreateChannel: (name: string, purpose: string) => Promise<void>
  onCreate: () => Promise<void>
  onSignOut: () => Promise<void>
  onManageFamily: () => void
  onManageWhatsapp: () => void
  onManageConnectors: () => void
  onManageSchedules: () => void
}) {
  const [creatingChannel, setCreatingChannel] = useState(false)
  const [pending, setPending] = useState(false)
  const [deletingId, setDeletingId] = useState<ConversationId | null>(null)
  const [filter, setFilter] = useState('')
  const sidebar = useRef<HTMLElement>(null)
  const closeButton = useRef<HTMLButtonElement>(null)
  const accountMenu = useRef<HTMLDivElement>(null)
  const menuId = useId()
  const familySelectId = useId()
  const closeForDesktop = useEffectEvent(() => { if (mobileOpen) onClose() })

  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)')
    function handleResize(event: MediaQueryListEvent) { if (event.matches) closeForDesktop() }
    desktop.addEventListener('change', handleResize)
    return () => desktop.removeEventListener('change', handleResize)
  }, [])

  useEffect(() => {
    if (!mobileOpen) return
    closeButton.current?.focus()
    const panel = sidebar.current
    function trapFocus(event: globalThis.KeyboardEvent) {
      if (event.key !== 'Tab' || !panel) return
      const controls = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input, select, summary'))
        .filter((element) => element.getClientRects().length > 0)
      const first = controls.at(0)
      const last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    panel?.addEventListener('keydown', trapFocus)
    return () => panel?.removeEventListener('keydown', trapFocus)
  }, [mobileOpen])

  function openSettings(action: () => void) {
    accountMenu.current?.hidePopover()
    action()
  }

  async function create() {
    setPending(true)
    try { await onCreate() } catch { /* The workspace displays request errors. */ } finally { setPending(false) }
  }

  async function createChannel(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setPending(true)
    try {
      await onCreateChannel(String(form.get('name') ?? ''), String(form.get('purpose') ?? ''))
      setCreatingChannel(false)
    } catch { /* The workspace displays request errors. */ } finally { setPending(false) }
  }

  async function remove(conversation: ConversationDto) {
    if (!window.confirm(`Delete "${conversationTitle(conversation)}"? This cannot be undone.`)) return
    setDeletingId(conversation.id)
    try { await onDelete(conversation.id) } catch { /* The workspace displays request errors. */ } finally { setDeletingId(null) }
  }

  const filtered = conversations.filter((conversation) => conversationTitle(conversation).toLocaleLowerCase().includes(filter.toLocaleLowerCase()))
  const sorted = filtered.toSorted((left, right) => DateTime.toEpochMillis(right.updatedAt) - DateTime.toEpochMillis(left.updatedAt))

  return <>
    {mobileOpen && <button type="button" aria-label="Close navigation" className="navigation-scrim" onClick={onClose} />}
    <aside ref={sidebar} className={cn('workspace-sidebar', mobileOpen && 'is-open')} role={mobileOpen ? 'dialog' : undefined} aria-modal={mobileOpen || undefined} aria-label="Workspace navigation" onKeyDown={(event) => { if (event.key === 'Escape' && mobileOpen) onClose() }}>
      <div className="sidebar-brand-row">
        <Brand />
        <Button ref={closeButton} type="button" variant="ghost" size="icon" className="lg:hidden" aria-label="Close navigation" onClick={onClose}><XMarkIcon className="size-4 shrink-0 fill-current" /></Button>
        <p className="sidebar-private"><ShieldCheckIcon className="size-4 shrink-0 fill-current" aria-hidden="true" /> Private</p>
      </div>

      <div className="sidebar-family">
        <UserGroupIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        <select id={familySelectId} name="family" aria-label="Active family" value={familyId} onChange={(event) => {
          const next = me.memberships.find(({ family }) => family.id === event.target.value)
          if (next) onSelectFamily(next.family.id)
        }}>{me.memberships.map(({ family }) => <option key={family.id} value={family.id}>{family.name}</option>)}</select>
        <ChevronDownIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
      </div>

      <div className="sidebar-actions">
        <Button type="button" variant="ghost" className="new-chat-button" disabled={selectedChannelId === null || pending} onClick={() => void create()}><PencilSquareIcon className="size-4 shrink-0 fill-current" /> New chat <PlusIcon className="ml-auto size-4 shrink-0 fill-current" aria-hidden="true" /></Button>
        <Button ref={schedulesButtonRef} type="button" variant="ghost" className="sidebar-schedules-button" aria-haspopup="dialog" onClick={onManageSchedules}><CalendarDaysIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />Schedules</Button>
        <div className="sidebar-search"><MagnifyingGlassIcon className="size-4 shrink-0 fill-current" aria-hidden="true" /><input name="chat-search" type="search" aria-label="Search chats in this channel" placeholder="Search chats" value={filter} onChange={(event) => setFilter(event.target.value)} /></div>
      </div>

      <div className="sidebar-section-heading"><h2>Channels</h2><Button type="button" variant="ghost" size="icon" aria-label="Create channel" title="Create channel" onClick={() => setCreatingChannel(!creatingChannel)}>{creatingChannel ? <XMarkIcon className="size-4 shrink-0 fill-current" /> : <PlusIcon className="size-4 shrink-0 fill-current" />}</Button></div>
      {creatingChannel && <form className="sidebar-channel-form" onSubmit={createChannel}>
        <Input name="name" aria-label="Channel name" placeholder="Channel name" autoFocus required maxLength={120} />
        <Input name="purpose" aria-label="Channel purpose (optional)" placeholder="What is this space for?" />
        <Button type="submit" size="compact" disabled={pending}>Create channel</Button>
      </form>}
      <nav className="sidebar-channels" aria-label="Channels"><ul role="list">{channels.map((channel) => <li key={channel.id}><button type="button" aria-current={selectedChannelId === channel.id ? 'page' : undefined} className="sidebar-channel" onClick={() => { setFilter(''); onSelectChannel(channel.id) }}><HashtagIcon className="size-4 shrink-0 fill-current" /><span className="truncate">{channel.name}</span></button></li>)}</ul></nav>

      <div className="sidebar-section-heading"><h2>Chats</h2><p className="tabular-nums">{conversations.length}</p></div>
      <nav className="sidebar-chats" aria-label="Chats"><ul role="list">
        {sorted.map((conversation, index) => {
          const working = conversation.id === workingConversationId
          const group = conversationGroup(conversation)
          const previous = sorted[index - 1]
          return <li key={conversation.id}>
            {(!previous || conversationGroup(previous) !== group) && <p className="chat-date-group">{group}</p>}
            <div className="sidebar-chat-row" data-selected={selectedId === conversation.id || undefined}>
              <button type="button" className="sidebar-chat" aria-current={selectedId === conversation.id ? 'page' : undefined} title={conversationTitle(conversation)} onClick={() => onSelect(conversation.id)}><span className="truncate">{conversationTitle(conversation)}</span></button>
              {working ? <span role="status" className="chat-working" aria-label="Generating response"><span className="working-dot" /></span> : <Button type="button" variant="ghost" size="icon" className="chat-delete" aria-label={`Delete ${conversationTitle(conversation)}`} title="Delete chat" disabled={deletingId !== null} onClick={() => void remove(conversation)}><TrashIcon className="size-4 shrink-0 fill-current" /></Button>}
            </div>
          </li>
        })}
      </ul>{sorted.length === 0 && <p className="sidebar-empty">{filter ? 'No matching chats.' : 'Your conversations will appear here.'}</p>}</nav>

      <div className="sidebar-footer">
        <Button ref={settingsButtonRef} type="button" variant="ghost" className="account-button" popoverTarget={menuId}>
          <span className="account-avatar" aria-hidden="true">{me.user.name.slice(0, 1).toUpperCase()}</span>
          <div className="account-name"><p>{me.user.name}</p><p>Settings & accounts</p></div>
          <EllipsisHorizontalIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
        </Button>
        <div id={menuId} ref={accountMenu} popover="auto" className="account-menu">
          <p className="account-menu-label">Your workspace</p>
          <button type="button" onClick={() => openSettings(onManageConnectors)}><WrenchScrewdriverIcon className="size-4 shrink-0 fill-current" />Connected accounts</button>
          <button type="button" onClick={() => openSettings(onManageWhatsapp)}><ChatBubbleLeftRightIcon className="size-4 shrink-0 fill-current" />WhatsApp</button>
          {isPrimary && <button type="button" onClick={() => openSettings(onManageFamily)}><UserGroupIcon className="size-4 shrink-0 fill-current" />Manage family</button>}
          {me.isPlatformAdministrator && <button type="button" onClick={() => openSettings(onOpenPlatform)}><ShieldCheckIcon className="size-4 shrink-0 fill-current" />Platform administration</button>}
          <div className="account-menu-divider" />
          <button type="button" onClick={() => { accountMenu.current?.hidePopover(); void onSignOut() }}><ArrowRightStartOnRectangleIcon className="size-4 shrink-0 fill-current" />Sign out</button>
        </div>
      </div>
    </aside>
  </>
}
