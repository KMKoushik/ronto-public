# Ronto

Ronto is a self-hosted agent for a small group of trusted families. It combines
an Effect-based Node.js server, a React web application, SQLite persistence,
family-scoped workspaces, and optional WhatsApp and connected-account
integrations.

This repository is a source snapshot. It deliberately excludes the private
deployment runbook, production infrastructure configuration, operational state,
and credentials used by the hosted Ronto instance.

## Mirror relationship

This repository is a curated public mirror of Ronto's private development
repository. Applicable product and source changes are ported here, while
private operations material, credentials, and family data remain excluded.

The public mirror intentionally uses GPT-5.6 Luna as its primary model, with
DeepSeek Flash as fallback. This model policy may differ from the private
deployment and should be preserved when syncing unrelated changes.

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
