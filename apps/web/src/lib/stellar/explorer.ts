/**
 * apps/web/src/lib/stellar/explorer.ts
 *
 * Block-explorer URL builders for stellar.expert.
 *
 * stellar.expert uses network-specific path prefixes:
 *   Testnet : https://stellar.expert/explorer/testnet/…
 *   Mainnet : https://stellar.expert/explorer/public/…
 *
 * All helpers accept an explicit `network` parameter so they work
 * independently of the module-level NETWORK singleton — this makes them
 * trivial to test without touching env vars.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ExplorerNetwork = "testnet" | "mainnet"

// ─────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────────────────────────────────────

function baseUrl(network: ExplorerNetwork): string {
  return network === "mainnet"
    ? "https://stellar.expert/explorer/public"
    : "https://stellar.expert/explorer/testnet"
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build a stellar.expert URL for a transaction hash.
 *
 * @example
 * explorerTxUrl("abc123", "testnet")
 * // "https://stellar.expert/explorer/testnet/tx/abc123"
 */
export function explorerTxUrl(hash: string, network: ExplorerNetwork = "testnet"): string {
  return `${baseUrl(network)}/tx/${hash}`
}

/**
 * Build a stellar.expert URL for an account (G... public key).
 *
 * @example
 * explorerAccountUrl("GAAZI...", "mainnet")
 * // "https://stellar.expert/explorer/public/account/GAAZI..."
 */
export function explorerAccountUrl(address: string, network: ExplorerNetwork = "testnet"): string {
  return `${baseUrl(network)}/account/${address}`
}

/**
 * Build a stellar.expert URL for a contract (C... address).
 *
 * @example
 * explorerContractUrl("CAAAA...", "testnet")
 * // "https://stellar.expert/explorer/testnet/contract/CAAAA..."
 */
export function explorerContractUrl(
  contractId: string,
  network: ExplorerNetwork = "testnet",
): string {
  return `${baseUrl(network)}/contract/${contractId}`
}
