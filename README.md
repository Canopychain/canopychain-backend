# Canopychain — Backend

Indexer, satellite-polling worker, and API for Canopychain, a
milestone-verified reforestation funding platform on Stellar. Polls the
Global Forest Watch API for each active project's plot, attests confirmed
milestones on-chain, and mirrors on-chain state for the frontend.

## Stack

- TypeScript, Node.js
- Fastify (API server)
- PostgreSQL

## Local development

```
cp .env.example .env
docker compose up -d postgres   # starts Postgres (+ a canopychain_test DB)
npm install
npm run db:push                 # sync the schema onto canopychain
npm run dev
```

To run the whole stack containerized instead, after `npm run db:push` above: `docker compose up --build`.

To run the integration test suite, additionally:

```
cp .env.test.example .env.test
npm run db:push:test
npm test
```

## Indexer

Which contract events the indexer consumes, which tables/columns each one
writes, and which events it deliberately ignores: see
[docs/indexer-event-mapping.md](./docs/indexer-event-mapping.md).

## API documentation

Route schemas are the source of truth for the REST API — an OpenAPI 3
description generated from them is served at `/docs/json` (YAML at
`/docs/yaml`), with a browsable Swagger UI at `/docs`, whenever the server
is running.

## Related repositories

- [canopychain-contracts](https://github.com/canopychain/canopychain-contracts) — Soroban smart contracts
- [canopychain-frontend](https://github.com/canopychain/canopychain-frontend) — donor & operator web app
- [canopychain-docs](https://github.com/canopychain/canopychain-docs) — documentation

## Status

Early development.

## License

Apache-2.0 — see [LICENSE](./LICENSE).
