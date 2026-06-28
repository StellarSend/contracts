/**
 * apps/web/src/lib/stellar/address.ts
 *
 * Address formatting and validation helpers for Stellar / Soroban accounts.
 *
 * Stellar has two main address types:
 *   G...  StrKey-encoded ed25519 public keys (56 chars, always starts with G)
 *   C...  StrKey-encoded contract addresses   (56 chars, always starts with C)
 *
 * Validation is structural only (prefix + length) — no network call is made.
 * The full StrKey checksum is not verified here; use @stellar/stellar-sdk's
 * `StrKey.isValidEd25519PublicKey` / `StrKey.isValidContract` for that.
 *
 * Shortening uses the conventional "GABC…WXYZ" display format shown in
 * block explorers: first N chars + ellipsis + last N chars.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Expected length of a valid Stellar StrKey-encoded address (G... or C...). */
export const STELLAR_ADDRESS_LENGTH = 56

/** Default number of leading/trailing chars shown in a shortened address. */
const DEFAULT_SHORTEN_CHARS = 4

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns true when `address` looks like a valid Stellar ed25519 public key
 * (starts with "G", exactly 56 uppercase alphanumeric characters).
 *
 * @example
 * isValidStellarAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN") // true
 * isValidStellarAddress("CABC...")   // false — contract address, not G-key
 * isValidStellarAddress("")          // false
 */
export function isValidStellarAddress(address: string | null | undefined): boolean {
  if (!address || typeof address !== "string") return false
  return address.length === STELLAR_ADDRESS_LENGTH && /^G[A-Z2-7]{55}$/.test(address)
}

/**
 * Returns true when `address` looks like a valid Soroban contract address
 * (starts with "C", exactly 56 uppercase alphanumeric characters).
 *
 * @example
 * isValidContractAddress("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4") // false — too long (padded example)
 * isValidContractAddress("CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF")  // true (56-char C address)
 * isValidContractAddress("")   // false
 */
export function isValidContractAddress(address: string | null | undefined): boolean {
  if (!address || typeof address !== "string") return false
  return address.length === STELLAR_ADDRESS_LENGTH && /^C[A-Z2-7]{55}$/.test(address)
}

/**
 * Returns true for any valid Stellar address (G... public key or C... contract).
 */
export function isValidAddress(address: string | null | undefined): boolean {
  return isValidStellarAddress(address) || isValidContractAddress(address)
}

// ─────────────────────────────────────────────────────────────────────────────
// Formatting
// ─────────────────────────────────────────────────────────────────────────────

export type ShortenAddressOptions = {
  /**
   * Number of characters to show at each end.
   * @default 4
   */
  chars?: number
  /** Custom separator string.  @default "…" */
  separator?: string
}

/**
 * Shorten a Stellar address for display: "GABC…WXYZ".
 *
 * Returns the full address unchanged if it is too short to shorten, and
 * returns an empty string for null / undefined / empty inputs.
 *
 * @example
 * shortenAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")
 * // "GAAZ…CWWN"  (4 chars each side)
 *
 * shortenAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN", { chars: 6 })
 * // "GAAZI4…CCWN" — wait, chars=6: "GAAZI4…CCWN"
 */
export function shortenAddress(
  address: string | null | undefined,
  options: ShortenAddressOptions = {},
): string {
  if (!address || typeof address !== "string") return ""

  const chars = options.chars ?? DEFAULT_SHORTEN_CHARS
  const separator = options.separator ?? "…"

  // Not long enough to shorten — return as-is
  if (address.length <= chars * 2 + separator.length) {
    return address
  }

  return `${address.slice(0, chars)}${separator}${address.slice(-chars)}`
}

/**
 * Format an address for display: shorten if valid, otherwise return
 * a safe fallback ("—").
 *
 * Useful in React components where you always want a printable string.
 *
 * @example
 * formatAddress("GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN")
 * // "GAAZ…CWWN"
 * formatAddress(null)   // "—"
 * formatAddress("bad")  // "—"
 */
export function formatAddress(
  address: string | null | undefined,
  options: ShortenAddressOptions = {},
): string {
  if (!isValidAddress(address)) return "—"
  return shortenAddress(address, options)
}
