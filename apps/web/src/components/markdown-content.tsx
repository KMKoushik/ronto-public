import { createCodePlugin } from '@streamdown/code'
import { Streamdown } from 'streamdown'

const code = createCodePlugin({
  themes: ['catppuccin-mocha', 'catppuccin-mocha'],
})

const components = {
  a: ({ children: label, ...props }: React.ComponentProps<'a'>) => (
    <a {...props} target="_blank" rel="noreferrer">{label}</a>
  ),
}

export default function MarkdownContent({
  children,
  className = 'agent-markdown',
  streaming = false,
}: {
  children: string
  className?: string
  streaming?: boolean
}) {
  return (
    <Streamdown
      className={className}
      components={components}
      codeBlockMaxHeight="32rem"
      controls={{
        code: { copy: true, download: false },
        table: false,
      }}
      isAnimating={streaming}
      lineNumbers={false}
      mode={streaming ? 'streaming' : 'static'}
      plugins={{ code }}
      tableMaxHeight="24rem"
    >
      {children}
    </Streamdown>
  )
}
