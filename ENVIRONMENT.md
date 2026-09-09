# Environment variables

Copy `.env.example` to `.env` (and `.env.test.example` to `.env.test` for
the test suite) and fill these in.

| Variable                      | Required | Default                                | Notes                                                                                          |
| ------------------------------ | -------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DATABASE_URL`                 | Yes      | —                                        | Postgres connection string. Inside `docker compose`, the backend service overrides this to point at the `postgres` service, not `localhost`. |
| `PORT`                         | No       | `3000`                                   | Port the Fastify server listens on.                                                              |
| `SOROBAN_RPC_URL`               | No       | `https://soroban-testnet.stellar.org`    | Soroban RPC endpoint the indexer and attestation submitter use.                                  |
| `SOROBAN_NETWORK_PASSPHRASE`    | No       | Stellar testnet passphrase               | Network passphrase used when building/signing the `attest_milestone` transaction.                |
| `GFW_API_BASE_URL`              | No       | `https://data-api.globalforestwatch.org` | Base URL for the Global Forest Watch Data API.                                                   |
| `GFW_API_KEY`                   | Yes*     | — (empty)                                | API key for GFW's Data API. The polling worker's queries fail without it.                        |
| `GFW_POLL_INTERVAL_MS`          | No       | `21600000` (6h)                          | How often the GFW polling worker checks each active project's polygon.                           |
| `PROJECT_REGISTRY_CONTRACT_ID`  | No**     | — (empty)                                | Deployed `project-registry` contract id. See `canopychain-contracts/deployments.json`. The indexer no-ops until both contract ids are set. |
| `MILESTONE_VAULT_CONTRACT_ID`   | No**     | — (empty)                                | Deployed `milestone-vault` contract id. Same file as above. Also used by the attestation submitter. |
| `ATTESTOR_SECRET_KEY`           | Yes*     | — (empty)                                | Secret key for the backend's attestor identity. The one private key this backend holds — see the semi-trusted-attestor design notes in the docs. |
| `INDEXER_POLL_INTERVAL_MS`      | No       | `5000`                                   | How often the indexer polls `getEvents`.                                                         |
| `ADMIN_ADDRESS`                 | No***    | — (empty)                                | Stellar public key (`G...`) that must sign requests to admin routes (`/projects/pending`, `/projects/:id/reject`). Admin routes 503 until this is set. Should match the `admin` configured on the deployed contracts. |
| `LOG_LEVEL`                     | No       | `info`                                   | Pino log level: `fatal` \| `error` \| `warn` \| `info` \| `debug` \| `trace`.                     |
| `NODE_ENV`                      | No       | unset (treated as development)           | Set to `production` to switch logging to structured JSON instead of pino-pretty. Set automatically inside the Docker image. |

\* Required for the GFW polling worker / attestation submitter to do anything; the rest of the app runs fine without them, they just never see satellite data or attest anything.
\** Required for the indexer to do anything; the app runs fine without them, it just never sees on-chain events.
\*** Required for the admin review endpoints to work at all; everything else in the API works without it.
