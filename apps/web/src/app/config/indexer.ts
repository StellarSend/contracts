/**
 * apps/web/src/app/config/indexer.ts
 *
 * Indexer configuration derived from environment variables.
 * Validates all indexer-related settings at startup.
 *
 * Usage:
 *   import { INDEXER_CONFIG } from "@/app/config/indexer"
 *   if (INDEXER_CONFIG.enabled) {
 *     // Query SubQuery GraphQL endpoint
 *   }
 */

import { ENV } from "./env"

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function optionalIndexerEnv(value: string | undefined): string | null {
  return value ?? null
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type IndexerConfig = {
  /** GraphQL endpoint URL */
  graphqlUrl: string | null
  /** Whether indexer integration is enabled */
  enabled: boolean
  /** Network context for query isolation */
  network: "testnet" | "mainnet"
}

// ─────────────────────────────────────────────────────────────────────────────
// INDEXER_CONFIG — evaluated once at startup
// ─────────────────────────────────────────────────────────────────────────────

/**
 * If VITE_INDEXER_GRAPHQL_URL is not set, indexer is disabled.
 * When disabled, query hooks must gracefully degrade to contract-only or empty data.
 */
export const INDEXER_CONFIG: IndexerConfig = {
  graphqlUrl: optionalIndexerEnv(import.meta.env.VITE_INDEXER_GRAPHQL_URL),
  enabled: !!import.meta.env.VITE_INDEXER_GRAPHQL_URL,
  network: ENV.NETWORK,
}

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validate indexer config at startup.
 * Throws descriptive error if required vars are missing.
 */
export function validateIndexerConfig(): void {
  if (!INDEXER_CONFIG.enabled) {
    console.warn("Indexer disabled: VITE_INDEXER_GRAPHQL_URL not set")
    return
  }

  if (!INDEXER_CONFIG.graphqlUrl) {
    throw new Error("VITE_INDEXER_GRAPHQL_URL is required when indexer is enabled")
  }

  if (!["testnet", "mainnet"].includes(INDEXER_CONFIG.network)) {
    throw new Error(`Invalid network: ${INDEXER_CONFIG.network}`)
  }

  console.log(`Indexer enabled: ${INDEXER_CONFIG.graphqlUrl} (${INDEXER_CONFIG.network})`)
}
