import { ArrowUpIcon, DocumentIcon, LockClosedIcon, PlusIcon, StopIcon, XMarkIcon } from '@heroicons/react/16/solid'
import type { ConversationId } from '@ronto/api'
import { useId, type FormEvent, type KeyboardEvent, type RefObject } from 'react'

import { Button } from '@/components/ui/button'

export function ChatComposer({ selectedId, sending, selectedIsWorking, selectedFiles, fileInputRef, textareaRef, draft, onDraftChange, errorMessage, onSubmit, onComposerKeyDown, onFilesSelected, onRemoveFile, onStopResponse }: {
  selectedId: ConversationId | null
  sending: boolean
  selectedIsWorking: boolean
  selectedFiles: ReadonlyArray<File>
  fileInputRef: RefObject<HTMLInputElement | null>
  textareaRef: RefObject<HTMLTextAreaElement | null>
  draft: string
  onDraftChange: (value: string) => void
  errorMessage: string | null | undefined
  onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void>
  onComposerKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFilesSelected: (files: ReadonlyArray<File>) => void
  onRemoveFile: (index: number) => void
  onStopResponse: () => Promise<void>
}) {
  const helpId = useId()
  const busy = sending || selectedIsWorking
  return <footer className="composer-footer">
    <div className="composer-container">
      <form className="composer-form" onSubmit={onSubmit} onReset={() => onDraftChange('')}>
        {selectedFiles.length > 0 && <div className="composer-attachments" aria-label="Selected attachments">{selectedFiles.map((file, index) => <div key={`${file.name}-${file.lastModified}-${index}`} className="composer-attachment">
          <DocumentIcon className="size-4 shrink-0 fill-current" />
          <span className="truncate">{file.name}</span>
          <Button type="button" variant="ghost" size="icon" aria-label={`Remove ${file.name}`} onClick={() => onRemoveFile(index)}><XMarkIcon className="size-4 shrink-0 fill-current" /></Button>
        </div>)}</div>}
        <textarea ref={textareaRef} name="message" aria-label="Message Ronto" aria-describedby={helpId} className="composer-textarea" placeholder={selectedId === null ? 'Create a chat to get started' : 'Ask anything, or share a little life update…'} rows={2} value={draft} onChange={(event) => onDraftChange(event.target.value)} disabled={selectedId === null || busy} onKeyDown={onComposerKeyDown} />
        <div className="composer-toolbar">
          <input ref={fileInputRef} name="attachments" type="file" multiple aria-label="Attach files" className="sr-only" tabIndex={-1} onChange={(event) => { onFilesSelected(Array.from(event.target.files ?? [])); event.target.value = '' }} />
          <Button type="button" variant="ghost" size="icon" className="attach-button" title="Attach files" aria-label="Attach files" disabled={selectedId === null || busy} onClick={() => fileInputRef.current?.click()}><PlusIcon className="size-4 shrink-0 fill-current" /></Button>
          <p>{selectedIsWorking ? 'Ronto is working…' : sending ? 'Sending…' : 'Ronto'}{busy && <span role="status" className="sr-only">{selectedIsWorking ? 'Ronto is working' : 'Sending message'}</span>}</p>
          <Button type={selectedIsWorking ? 'button' : 'submit'} variant="primary" size="icon" className="send-button" title={selectedIsWorking ? 'Stop response' : 'Send message'} aria-label={selectedIsWorking ? 'Stop response' : 'Send message'} disabled={selectedId === null || (!selectedIsWorking && (sending || (!draft.trim() && selectedFiles.length === 0)))} onClick={selectedIsWorking ? () => void onStopResponse() : undefined}>
            {selectedIsWorking ? <StopIcon className="size-4 shrink-0 fill-current" /> : <ArrowUpIcon className="size-4 shrink-0 fill-current" />}
          </Button>
        </div>
      </form>
      {errorMessage && <p role="alert" className="composer-error">{errorMessage}</p>}
      <div className="composer-caption" id={helpId}><p><LockClosedIcon className="size-4 shrink-0 fill-current" aria-hidden="true" /> Only your family. Always your space.</p><p>Enter to send · Shift + Enter for a new line</p></div>
    </div>
  </footer>
}
