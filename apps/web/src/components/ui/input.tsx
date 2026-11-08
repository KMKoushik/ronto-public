import type { ComponentPropsWithRef } from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type = 'text', ...props }: ComponentPropsWithRef<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        'h-9 w-full min-w-0 rounded-lg border border-line-strong bg-panel px-3 text-base text-ink outline-none placeholder:text-faint focus-visible:border-focus focus-visible:outline-2 -outline-offset-1 focus-visible:outline-focus aria-invalid:border-danger aria-invalid:focus-visible:outline-danger disabled:cursor-not-allowed disabled:bg-soft disabled:opacity-50 sm:text-sm pointer-coarse:min-h-11',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
