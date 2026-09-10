import type { InputHTMLAttributes } from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type = 'text', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        'h-10 w-full rounded-lg bg-cat-surface-0 px-3 text-base text-cat-text ring-1 ring-cat-overlay-1 outline-none placeholder:text-cat-subtext-0 focus-visible:outline-2 -outline-offset-1 focus-visible:outline-cat-mauve disabled:cursor-not-allowed disabled:opacity-50 sm:h-9 sm:text-sm',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
