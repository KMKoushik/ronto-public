import { SparklesIcon } from '@heroicons/react/16/solid'

export function Brand() {
  return (
    <a href="/" aria-label="Homepage" className="brand">
      <SparklesIcon className="size-4 shrink-0 fill-current" aria-hidden="true" />
      <span>ronto</span>
    </a>
  )
}
