import { cva, type VariantProps } from 'class-variance-authority'
import type { ComponentPropsWithRef } from 'react'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  'inline-flex h-9 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cat-lavender',
  {
    variants: {
      variant: {
        primary: 'bg-cat-mauve text-cat-crust hover:bg-cat-lavender',
        secondary: 'bg-cat-surface-0 text-cat-text hover:bg-cat-surface-1',
        outline: 'ring-1 ring-cat-surface-2 bg-transparent text-cat-text hover:bg-cat-surface-0',
        ghost: 'text-cat-subtext-0 hover:bg-cat-surface-0 hover:text-cat-text',
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

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Button }
