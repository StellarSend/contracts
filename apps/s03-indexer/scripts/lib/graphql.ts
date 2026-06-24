// SubQuery GraphQL helpers for the smoke runner.
//
// After protocol actions run, the smoke flow queries the GraphQL layer to prove
// the indexer turned on-chain events into entities. SubQuery exposes a `_metadata`
// node for indexing progress and auto-generated `<entity>s { totalCount }` queries
// for every schema type.

import type { EntityCounts } from "./types";

export interface GraphqlResult<T> {
  data?: T;
  errors?: Array<{ message: string }>;
}

export async function gqlQuery<T>(
  endpoint: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphqlResult<T>> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (!response.ok) {
    return { errors: [{ message: `GraphQL HTTP ${response.status}` }] };
  }

  return (await response.json()) as GraphqlResult<T>;
}

export interface IndexerMetadata {
  lastProcessedHeight?: number;
  targetHeight?: number;
  indexerHealthy?: boolean;
}

export async function fetchMetadata(endpoint: string): Promise<IndexerMetadata | undefined> {
  const result = await gqlQuery<{
    _metadata: {
      lastProcessedHeight?: number;
      targetHeight?: number;
      indexerHealthy?: boolean;
    };
  }>(
    endpoint,
    `{ _metadata { lastProcessedHeight targetHeight indexerHealthy } }`,
  );

  return result.data?._metadata;
}

/** True once the indexer is reachable and within `lagTolerance` of `targetLedger`. */
export async function waitForIndexer(
  endpoint: string,
  targetLedger: number,
  options: { lagTolerance: number; timeoutMs: number; pollMs?: number },
): Promise<{ caughtUp: boolean; metadata?: IndexerMetadata }> {
  const deadline = Date.now() + options.timeoutMs;
  const pollMs = options.pollMs ?? 3000;
  let metadata: IndexerMetadata | undefined;

  while (Date.now() < deadline) {
    metadata = await fetchMetadata(endpoint);
    const height = metadata?.lastProcessedHeight ?? 0;
    if (height >= targetLedger - options.lagTolerance) {
      return { caughtUp: true, metadata };
    }
    await sleep(pollMs);
  }

  return { caughtUp: false, metadata };
}

const COUNT_QUERY = `{
  markets { totalCount }
  deposits { totalCount }
  orders { totalCount }
  positions { totalCount }
  marketTokenTransfers { totalCount }
  positionChanges { totalCount }
  referralCodes { totalCount }
}`;

type CountNode = { totalCount: number };

export async function fetchEntityCounts(endpoint: string): Promise<EntityCounts> {
  const result = await gqlQuery<{
    markets: CountNode;
    deposits: CountNode;
    orders: CountNode;
    positions: CountNode;
    marketTokenTransfers: CountNode;
    positionChanges: CountNode;
    referralCodes: CountNode;
  }>(endpoint, COUNT_QUERY);

  if (result.errors?.length) {
    throw new Error(`GraphQL count query failed: ${result.errors.map((e) => e.message).join("; ")}`);
  }

  const data = result.data;
  return {
    markets: data?.markets.totalCount ?? 0,
    deposits: data?.deposits.totalCount ?? 0,
    orders: data?.orders.totalCount ?? 0,
    positions: data?.positions.totalCount ?? 0,
    transfers: data?.marketTokenTransfers.totalCount ?? 0,
    positionChanges: data?.positionChanges.totalCount ?? 0,
    referralCodes: data?.referralCodes.totalCount ?? 0,
  };
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
