import { createRootRoute, createRouter } from '@tanstack/react-router'
import { FamilyId } from '@ronto/api'
import { Schema } from 'effect'

import App from './App.tsx'

const AppSearchSchema = Schema.Struct({
  invite: Schema.optional(Schema.String),
  platformInvite: Schema.optional(Schema.String),
  platform: Schema.optional(Schema.Boolean),
  family: Schema.optional(FamilyId),
  channel: Schema.optional(Schema.String),
  conversation: Schema.optional(Schema.String),
})

export type AppSearch = typeof AppSearchSchema.Type

const rootRoute = createRootRoute({
  validateSearch: Schema.decodeUnknownSync(AppSearchSchema),
  component: App,
})

export const router = createRouter({ routeTree: rootRoute })

export const useAppSearch = () => rootRoute.useSearch()
export const useAppNavigate = () => rootRoute.useNavigate()
