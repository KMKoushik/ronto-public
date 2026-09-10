# Ronto

Ronto is a self-hosted agent for a small group of trusted families. It combines
an Effect-based Node.js server, a React web application, SQLite persistence,
family-scoped workspaces, and optional WhatsApp and connected-account
integrations.

This repository is a source snapshot. It deliberately excludes the private
deployment runbook, production infrastructure configuration, operational state,
and credentials used by the hosted Ronto instance.

## Development

Requirements:

- Node.js 24
- pnpm 10.34.4

Copy `apps/server/.env.example` to `apps/server/.env`, provide the required local
values, and then run:

```bash
pnpm install
pnpm dev
```

The local web application defaults to `http://localhost:2718` and the API to
`http://localhost:3141`.

## Checks

```bash
pnpm lint
pnpm check
pnpm build
```

## Security

Do not commit `.env` files, SQLite databases, family workspaces, provider
credentials, or deployment configuration. See [SECURITY.md](SECURITY.md) for
reporting guidance.
