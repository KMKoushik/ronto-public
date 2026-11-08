import { XMarkIcon } from '@heroicons/react/16/solid'
import { type ReactNode, useEffect, useId, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import './settings-dialog.css'

export function SettingsDialog({ title, description, onClose, className, children }: {
  title: string
  description: string
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (!dialog.open) dialog.showModal()
    return () => { if (dialog.open) dialog.close() }
  }, [])

  return (
    <dialog
      ref={ref}
      className={cn('settings-dialog max-w-2xl', className)}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); onClose() }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return
        const rect = event.currentTarget.getBoundingClientRect()
        if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose()
      }}
    >
      <header className="settings-dialog-header">
        <div className="flex min-w-0 flex-col gap-1.5">
          <h2 id={titleId} className="text-lg font-semibold text-balance">{title}</h2>
          <p id={descriptionId} className="max-w-[60ch] text-base/7 text-pretty text-muted sm:text-sm/6">{description}</p>
        </div>
        <Button autoFocus variant="ghost" size="icon" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><XMarkIcon aria-hidden="true" /></Button>
      </header>
      <div className="settings-dialog-content">{children}</div>
    </dialog>
  )
}
