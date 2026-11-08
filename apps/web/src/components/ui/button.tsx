import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithRef } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex shrink-0 touch-manipulation items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:cursor-not-allowed disabled:opacity-45 pointer-coarse:min-h-11 pointer-coarse:min-w-11 [&_svg]:size-4 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        primary: 'bg-primary text-on-primary enabled:hover:bg-primary/85 enabled:active:bg-primary/75',
        secondary: 'bg-panel text-ink inset-ring inset-ring-line-strong enabled:hover:bg-hover enabled:active:bg-soft',
        outline: 'bg-transparent text-ink inset-ring inset-ring-line-strong enabled:hover:bg-hover enabled:active:bg-soft',
        ghost: 'text-muted enabled:hover:bg-hover enabled:hover:text-ink enabled:active:bg-soft',
      },
      size: {
        default: 'h-9 px-3',
        compact: 'h-7 px-2.5',
        icon: 'relative size-9 p-0',
      },
    },
    defaultVariants: {
      variant: 'secondary',
      size: 'default',
    },
  },
)

type ButtonProps = ComponentPropsWithRef<'button'> &
  VariantProps<typeof buttonVariants>

function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button }
