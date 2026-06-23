# Stellar Testnet Indexer

This Bun workspace package contains the SubQuery Stellar indexer scaffold for
the S03 app. It indexes Stellar testnet payments, account credit/debit effects,
and Soroban `transfer` events.

## Workspace Commands

Run these commands from the repository root:

```bash
bun install
bun run indexer:codegen
bun run indexer:build
bun run indexer:dev
```

The same commands are available inside the workspace package:

```bash
bun run --cwd apps/s03-indexer codegen
bun run --cwd apps/s03-indexer build
bun run --cwd apps/s03-indexer dev
bun run --cwd apps/s03-indexer start
```

`indexer:dev` is the clean-checkout local path. It generates SubQuery artifacts,
builds the mappings, pulls the required Docker images, and starts the local
stack.

## Local Services

The Docker stack in `docker-compose.yml` starts three services:

| Service | Image/build | Port | Purpose |
| --- | --- | --- | --- |
| `postgres` | local `docker/pg-Dockerfile` | `localhost:5432` | SubQuery metadata and indexed entities |
| `subquery-node` | `subquerynetwork/subql-node-stellar:latest` | internal `3000` | Stellar/SubQuery indexing node |
| `graphql-engine` | `subquerynetwork/subql-query:latest` | `localhost:3000` | GraphQL API and playground |

Requirements:

- Bun 1.3.x or newer, matching the root `packageManager` field.
- Docker Engine with Docker Compose v2.
- Network access for the first image pull and for public Stellar testnet
  endpoints when using the default config.

Open `http://localhost:3000` after the services become healthy to query the
GraphQL playground.

## Environment

Copy the example file when you need to customize the runtime:

```bash
cp apps/s03-indexer/.env.example apps/s03-indexer/.env
```

The default configuration targets public SDF testnet:

```dotenv
ENDPOINT=https://horizon-testnet.stellar.org
CHAIN_ID=Test SDF Network ; September 2015
SOROBAN_ENDPOINT=https://soroban-testnet.stellar.org
```

Use these defaults when indexing public testnet data or when contributors need
the same deterministic remote network.

For local standalone or `stellar/quickstart` development, switch the same
variables to the local values shown in `.env.example`:

```dotenv
ENDPOINT=http://host.docker.internal:8000
CHAIN_ID=Standalone Network ; February 2017
SOROBAN_ENDPOINT=http://host.docker.internal:8000/soroban/rpc
```

Use local endpoints when you are testing against a local Stellar network,
contract deployment, or fixture data. The compose file maps
`host.docker.internal` to the host gateway so the indexer container can reach a
host-run standalone node.

## Generated Artifacts

`project.ts`, `schema.graphql`, and the TypeScript mapping sources are the
committed source of truth. `project.yaml`, `dist/`, and `src/types/` are
generated artifacts and stay ignored so they cannot drift from the source.

Regenerate them with:

```bash
bun run indexer:codegen
bun run indexer:build
```

The repository uses the root Bun lockfile only. Do not add `package-lock.json`,
`yarn.lock`, or `pnpm-lock.yaml` files.

## Useful Query

After the stack is running, try this query in the GraphQL playground:

```graphql
{
  query {
    transfers(first: 5, orderBy: VALUE_DESC) {
      totalCount
      nodes {
        id
        date
        ledger
        toId
        fromId
        value
      }
    }
    accounts(first: 5, orderBy: SENT_TRANSFERS_COUNT_DESC) {
      nodes {
        id
        sentTransfers(first: 5, orderBy: LEDGER_DESC) {
          totalCount
          nodes {
            id
            toId
            value
          }
        }
        firstSeenLedger
        lastSeenLedger
      }
    }
  }
}
```
