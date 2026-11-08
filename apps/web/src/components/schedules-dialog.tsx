import { ArrowPathIcon, ChevronRightIcon } from '@heroicons/react/16/solid'
import type { FamilyId, ScheduleDto } from '@ronto/api'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { DateTime } from 'effect'
import { useId, useRef, useState } from 'react'

import { SettingsDialog } from '@/components/settings-dialog'
import { Button } from '@/components/ui/button'
import { api, ApiError } from '@/lib/api'
import { schedulesQuery } from '@/lib/queries'
import { cn } from '@/lib/utils'

function cronDescription(cron: string): string | null {
  const fields = cron.trim().split(/\s+/)
  if (fields.length !== 5) return null
  const [minute, hour, day, month, weekday] = fields
  if (day !== '*' || month !== '*') return null
  if (weekday === '*' && hour === '*') {
    if (minute === '0') return 'Every hour'
    if (minute === '*/15') return 'Every 15 minutes'
    if (minute === '*/20') return 'Every 20 minutes'
    if (minute === '*/30') return 'Every 30 minutes'
  }
  if (!/^\d{1,2}$/.test(minute ?? '') || !/^\d{1,2}$/.test(hour ?? '')) return null
  const minutes = Number(minute)
  const hours = Number(hour)
  if (minutes > 59 || hours > 23) return null
  const time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
  if (weekday === '*') return `Every day at ${time}`
  if (weekday === '1-5') return `Weekdays at ${time}`
  if (weekday === '0,6' || weekday === '6,0') return `Weekends at ${time}`
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  const dayName = /^\d$/.test(weekday ?? '') ? days[Number(weekday)] : undefined
  return dayName ? `Every ${dayName} at ${time}` : null
}

function scheduleTime(value: DateTime.Utc, timezone: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      timeZone: timezone,
      year: 'numeric', month: 'short', day: 'numeric',
      hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    }).format(DateTime.toDate(value))
  } catch {
    return `${DateTime.formatIso(value)} (schedule timezone unavailable)`
  }
}

function ScheduleTiming({ task }: { task: ScheduleDto }) {
  const cadence = task.cron === null ? 'One time' : cronDescription(task.cron)
  return <div className="flex min-w-0 flex-col gap-3">
    <div className="flex min-w-0 flex-col gap-1 text-base/7 text-muted sm:text-sm/6">
      <p className="break-words tabular-nums">{cadence ?? <>Custom schedule: <code className="font-mono text-ink">{task.cron}</code></>}</p>
      <p className="break-words">{task.timezone} <span aria-hidden="true">·</span> {task.responseMode === 'optional' ? 'Only respond if relevant' : 'Always respond'}</p>
    </div>
    <dl className="grid min-w-0 gap-x-8 gap-y-2 text-base/7 sm:grid-cols-2 sm:text-sm/6">
      {task.status === 'active' && <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="font-medium text-ink">Next run</dt>
        <dd className="break-words text-muted tabular-nums">{task.nextRunAt === null ? 'Not scheduled' : <time dateTime={DateTime.formatIso(task.nextRunAt)}>{scheduleTime(task.nextRunAt, task.timezone)}</time>}</dd>
      </div>}
      <div className="flex min-w-0 flex-col gap-0.5">
        <dt className="font-medium text-ink">Last run</dt>
        <dd className="break-words text-muted tabular-nums">{task.lastRunAt === null ? 'Not run yet' : <time dateTime={DateTime.formatIso(task.lastRunAt)}>{scheduleTime(task.lastRunAt, task.timezone)}</time>}</dd>
      </div>
    </dl>
  </div>
}

function ScheduleItem({ task, confirming, pending, busy, onConfirm, onKeep, onCancel }: {
  task: ScheduleDto
  confirming: boolean
  pending: boolean
  busy: boolean
  onConfirm: () => void
  onKeep: () => void
  onCancel: () => void
}) {
  const titleId = useId()
  return <li className="flex min-w-0 flex-col gap-4 py-6 first:pt-0 last:pb-0">
    <article aria-labelledby={titleId} className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <h4 id={titleId} className="break-words text-base font-medium text-balance">{task.title}</h4>
          <p className="break-words text-base/7 text-muted sm:text-sm/6">{task.channelId.startsWith('personal-channel-') ? 'Your WhatsApp' : task.channelName} <span aria-hidden="true">·</span> Created by {task.creatorName}</p>
          <p className="text-base/7 text-muted tabular-nums sm:text-sm/6">Created <time dateTime={DateTime.formatIso(task.createdAt)}>{scheduleTime(task.createdAt, task.timezone)}</time></p>
        </div>
        <p className={cn('flex shrink-0 items-center gap-1.5 text-sm', task.status === 'active' ? 'text-success' : 'text-muted')}>
          {task.status === 'active' && <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden="true" />}
          {task.status === 'active' ? 'Active' : task.status === 'completed' ? 'Completed' : 'Cancelled'}
        </p>
      </div>
      <ScheduleTiming task={task} />
      {task.lastError !== null && <div className="flex min-w-0 flex-col gap-1 rounded-lg bg-soft p-3 text-base/7 sm:text-sm/6">
        <p className="font-medium text-warning">Last run issue</p>
        <p className="whitespace-pre-wrap break-words text-muted">{task.lastError}</p>
      </div>}
      <div className="flex min-w-0 flex-col gap-4">
        <details className="group/instructions min-w-0">
          <summary className="flex min-h-7 w-fit items-center gap-1.5 rounded-sm text-sm font-medium text-muted hover:text-ink pointer-coarse:min-h-11">
            <ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 fill-current group-open/instructions:rotate-90" />
            View instructions<span className="sr-only"> for {task.title}</span>
          </summary>
          <div className="flex min-w-0 flex-col gap-3 pt-3 text-base/7 sm:text-sm/6">
            <p className="whitespace-pre-wrap break-words text-ink [overflow-wrap:anywhere]">{task.instruction}</p>
            {task.cron !== null && <p className="break-words text-muted">Cron: <code className="font-mono">{task.cron}</code></p>}
          </div>
        </details>
        {task.status === 'active' && (confirming ? <div className="flex min-w-0 flex-col gap-3 rounded-lg bg-soft p-4">
          <div className="flex flex-col gap-1 text-base/7 sm:text-sm/6">
            <p className="font-medium">Cancel this task?</p>
            <p className="text-pretty text-muted">Future runs will stop. A run that is already queued or in progress may still finish.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="compact" disabled={busy} onClick={onKeep}>Keep task</Button>
            <Button variant="secondary" size="compact" className="text-danger" disabled={busy} onClick={onCancel} aria-label={`Confirm cancel ${task.title}`}>{pending ? 'Cancelling…' : 'Cancel task'}</Button>
          </div>
        </div> : <Button variant="ghost" size="compact" className="self-start" disabled={busy} onClick={onConfirm} aria-label={`Cancel ${task.title}`}>Cancel task</Button>)}
      </div>
    </article>
  </li>
}

export function SchedulesDialog({ familyId, onClose }: { familyId: FamilyId; onClose: () => void }) {
  const queryClient = useQueryClient()
  const schedules = useQuery(schedulesQuery(familyId))
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const activeHeading = useRef<HTMLHeadingElement>(null)
  const activeTitleId = useId()
  const cancel = useMutation({
    mutationFn: (task: ScheduleDto) => api.cancelSchedule(familyId, task.id),
    onSuccess: (updated) => {
      queryClient.setQueryData(schedulesQuery(familyId).queryKey, (current) => current?.map((task) => task.id === updated.id ? updated : task))
      setConfirmingId(null)
      setNotice(`“${updated.title}” was cancelled. No further runs will be scheduled.`)
      requestAnimationFrame(() => activeHeading.current?.focus())
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: schedulesQuery(familyId).queryKey, exact: true }),
  })
  const active = (schedules.data ?? []).filter((task) => task.status === 'active').toSorted((left, right) =>
    (left.nextRunAt === null ? Infinity : DateTime.toEpochMillis(left.nextRunAt)) - (right.nextRunAt === null ? Infinity : DateTime.toEpochMillis(right.nextRunAt)),
  )
  const history = (schedules.data ?? []).filter((task) => task.status !== 'active').toSorted((left, right) =>
    DateTime.toEpochMillis(right.lastRunAt ?? right.createdAt) - DateTime.toEpochMillis(left.lastRunAt ?? left.createdAt),
  )
  const cancelError = cancel.error instanceof ApiError && cancel.error.status === 409
    ? 'This task is no longer active. It may have completed or been cancelled elsewhere.'
    : cancel.error instanceof ApiError && cancel.error.status === 404
      ? 'This task is no longer available.'
      : cancel.error?.message

  function taskItem(task: ScheduleDto) {
    return <ScheduleItem key={task.id} task={task} confirming={confirmingId === task.id} pending={cancel.isPending && cancel.variables?.id === task.id} busy={cancel.isPending}
      onConfirm={() => { cancel.reset(); setNotice(null); setConfirmingId(task.id) }}
      onKeep={() => { cancel.reset(); setConfirmingId(null) }}
      onCancel={() => cancel.mutate(task)} />
  }

  return <SettingsDialog title="Scheduled tasks" description="Review upcoming tasks across your channels, including your personal WhatsApp chat." className="max-w-3xl" onClose={onClose}>
    <div className="flex flex-wrap items-start justify-between gap-3">
      <p className="min-w-0 flex-1 text-base/7 text-pretty text-muted sm:text-sm/6">To create a task or change its timing or instructions, ask Ronto in the chat where it belongs.</p>
      <Button variant="ghost" size="compact" className="pl-1.5 pr-2.5" disabled={schedules.isFetching || cancel.isPending} onClick={() => { setNotice(null); void schedules.refetch() }} aria-label="Refresh scheduled tasks"><ArrowPathIcon aria-hidden="true" className="fill-current" />{schedules.isFetching ? 'Refreshing…' : 'Refresh'}</Button>
    </div>
    {notice && <p role="status" className="rounded-lg bg-soft p-3 text-base/7 text-muted sm:text-sm/6">{notice}</p>}
    {cancelError && <p role="alert" className="text-base/7 text-danger sm:text-sm/6">Unable to cancel task. {cancelError}</p>}
    {schedules.isError && <div className="flex flex-col items-start gap-3 rounded-lg bg-soft p-4">
      <div className="flex flex-col gap-1 text-base/7 sm:text-sm/6"><p role="alert" className="font-medium">Couldn’t {schedules.data ? 'refresh' : 'load'} scheduled tasks.</p><p className="text-muted">{schedules.data ? 'The list below may be out of date. ' : ''}{schedules.error.message}</p></div>
      <Button variant="outline" size="compact" disabled={schedules.isFetching} onClick={() => void schedules.refetch()}>Try again</Button>
    </div>}
    {schedules.isPending ? <p role="status" className="py-8 text-base/7 text-muted sm:text-sm/6">Loading scheduled tasks…</p> : schedules.data !== undefined && <>
      <section className="flex min-w-0 flex-col gap-5" aria-labelledby={activeTitleId}>
        <h3 ref={activeHeading} id={activeTitleId} tabIndex={-1} className="flex items-center gap-2 text-base font-medium sm:text-sm">Active tasks <span className="text-muted tabular-nums">{active.length}</span></h3>
        {active.length === 0 ? <div className="flex flex-col gap-1 py-3 text-base/7 sm:text-sm/6">
          <p className="font-medium">No active tasks</p>
          <p className="text-pretty text-muted">{history.length > 0 ? 'Completed and cancelled tasks are kept in History below.' : 'Ask Ronto in chat to schedule a reminder, a daily briefing, or a regular check-in.'}</p>
        </div> : <ul role="list" className="flex min-w-0 flex-col divide-y divide-line">{active.map(taskItem)}</ul>}
      </section>
      <details className="group/history border-t border-line pt-5">
        <summary className="flex min-h-7 w-fit items-center gap-2 rounded-sm text-base font-medium sm:text-sm pointer-coarse:min-h-11"><ChevronRightIcon aria-hidden="true" className="size-4 shrink-0 fill-muted group-open/history:rotate-90" />History <span className="text-muted tabular-nums">{history.length}</span></summary>
        <div className="min-w-0 pt-5">{history.length === 0 ? <p className="text-base/7 text-muted sm:text-sm/6">Completed and cancelled tasks will appear here.</p> : <ul role="list" className="flex min-w-0 flex-col divide-y divide-line">{history.map(taskItem)}</ul>}</div>
      </details>
    </>}
  </SettingsDialog>
}
