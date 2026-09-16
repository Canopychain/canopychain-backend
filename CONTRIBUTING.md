# Contributing

This file covers the toolchain and checks for working in this repository.
For the full contribution guide (issue triage, PR process, coding
conventions across the Canopychain project), see
[canopychain-docs](https://canopychain.github.io/canopychain-docs/contributing).

## Toolchain

- Node.js 20 or newer, and npm.
- PostgreSQL 16. The included Compose file starts one, along with a
  separate `canopychain_test` database for the test suite.
- Docker, if you want to use that Compose file rather than a local
  Postgres install.

## Getting set up

```sh
cp .env.example .env
docker compose up -d postgres
npm install
npm run db:push
npm run dev
```

`npm install` runs `prisma generate` as a postinstall step, which needs
`DATABASE_URL` to be set. If you see a Prisma config error on a fresh
clone, it usually means `.env` hasn't been created yet.

## Checks to run before opening a PR

CI (`.github/workflows/ci.yml`) runs the following against every push and
pull request, with a Postgres service container. Run them locally first so
review isn't spent on things CI would catch:

```sh
npm run lint
npm run typecheck
npx prisma db push
npm test
```

The test suite is integration-heavy: it shares one Postgres database and
resets it between tests, so it needs `DATABASE_URL` pointing at a database
you don't mind being truncated. `.env.test.example` shows the expected
shape.

## Repository layout

- `src/routes`: the Fastify HTTP API, including the admin-only endpoints.
- `src/indexer`: polls Soroban events and mirrors on-chain state into
  Postgres. Event topics are decoded positionally, so the layout in
  canopychain-contracts' `EVENTS.md` is a contract between the two repos.
- `src/gfw`: Global Forest Watch polling, which produces the forest-cover
  figure milestones are judged against.
- `src/stellar`: submits attestations on-chain.
- `src/milestones`: milestone evaluation.
- `src/middleware`: SEP-53 admin request signing and verification.
- `prisma`: schema and migrations.

Tests live in `test/`, mirroring that structure.

## Security

Please don't open a public issue for a security vulnerability. See
[SECURITY.md](./SECURITY.md) for how to report one privately.
