import { useEffect, useState } from 'react'
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider } from '@tanstack/react-router'
import { ApiError } from '@/lib/api'
import { authClient } from '@/lib/auth-client'
import { router } from '@/routes'

function AccountQueries() {
  const [scope] = useState(() => {
    let active = true
    function handleRequestError(error: Error) {
      if (!active || !(error instanceof ApiError) || error.status !== 401) return
      client.clear()
      void authClient.signOut().catch(() => undefined)
    }
    const client = new QueryClient({
      queryCache: new QueryCache({ onError: handleRequestError }),
      mutationCache: new MutationCache({ onError: handleRequestError }),
      defaultOptions: { queries: { retry: false } },
    })
    return { client, setActive: (value: boolean) => { active = value } }
  })
  useEffect(() => {
    scope.setActive(true)
    return () => {
      scope.setActive(false)
      scope.client.clear()
    }
  }, [scope])
  return <QueryClientProvider client={scope.client}><RouterProvider router={router} /></QueryClientProvider>
}

export function AccountBoundary() {
  const session = authClient.useSession()
  // A login change in any tab must never reuse another account's cached /me,
  // family data, approvals, or platform metadata, even for the same family URL.
  return <AccountQueries key={session.data?.user.id ?? 'anonymous'} />
}
