import type { TextareaHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        'min-h-11 w-full resize-none rounded-lg bg-cat-surface-0 px-3 py-2.5 text-base text-cat-text ring-1 ring-cat-overlay-1 outline-none placeholder:text-cat-subtext-0 focus-visible:outline-2 -outline-offset-1 focus-visible:outline-cat-mauve disabled:cursor-not-allowed disabled:opacity-50 sm:py-2 sm:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Textarea }
