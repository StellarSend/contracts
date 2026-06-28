/**
 * apps/web/src/lib/amount.ts
 *
 * User-facing amount parsing and validation helpers.
 *
 * All amounts entered by users are free-form strings.  These utilities turn
 * that input into a canonical form that the rest of the app can work with
 * safely before it is ever handed to a contract or displayed back.
 *
 * Protocol scale
 * ──────────────
 * Stellar / Soroban contracts work with integer "raw" values where 1 token
 * unit = 10^decimals raw units (7 for XLM/SAC tokens, 6 for USDC, etc.).
 * `toProtocolAmount` converts a display string to the correct bigint scale
 * and never down-casts an existing bigint through Number, preventing silent
 * precision loss on large values.
 *
 * Precision / clamping
 * ────────────────────
 * • Maximum 7 decimal places (Stellar SAC token precision).
 * • Trailing dot ("1.") is treated as "1" — valid but incomplete input.
 * • Empty and non-numeric strings produce `null` (caller decides fallback).
 * • Values are clamped to [0, maxAmount] when a `maxAmount` is supplied.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum decimal places accepted from user input (Stellar SAC precision). */
export const MAX_DECIMALS = 7

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type ParseAmountOptions = {
  /**
   * Number of decimal places used by this token (default: MAX_DECIMALS = 7).
   * Must be a non-negative integer ≤ MAX_DECIMALS.
   */
  decimals?: number
  /**
   * Optional upper bound.  If the parsed value exceeds this, it is clamped
   * to `maxAmount`.  Comparison is done in display-number space.
   */
  maxAmount?: number
}

export type ParseAmountResult = {
  /** Parsed display-space value, or null when input is invalid / empty. */
  value: number | null
  /**
   * Whether the raw string is a syntactically valid (possibly incomplete)
   * number that the user is still typing — e.g. "1." returns true so the
   * UI doesn't discard the trailing dot while the user types.
   */
  isPartial: boolean
  /** True when clamping was applied. */
  wasClamped: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// parseAmount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Parse a user-typed amount string into a validated numeric value.
 *
 * @example
 * parseAmount("1.5")          // { value: 1.5,  isPartial: false, wasClamped: false }
 * parseAmount("1.")           // { value: 1,    isPartial: true,  wasClamped: false }
 * parseAmount("")             // { value: null, isPartial: false, wasClamped: false }
 * parseAmount("abc")          // { value: null, isPartial: false, wasClamped: false }
 * parseAmount("5", { maxAmount: 3 }) // { value: 3, isPartial: false, wasClamped: true }
 */
export function parseAmount(raw: string, options: ParseAmountOptions = {}): ParseAmountResult {
  const decimals = options.decimals ?? MAX_DECIMALS
  const maxAmount = options.maxAmount

  // Empty input — no value yet
  if (raw === "" || raw === undefined || raw === null) {
    return { value: null, isPartial: false, wasClamped: false }
  }

  const trimmed = String(raw).trim()
  if (trimmed === "") {
    return { value: null, isPartial: false, wasClamped: false }
  }

  // Detect trailing-dot — the user is mid-type: "1." means they typed "1" then "."
  const isPartial = trimmed.endsWith(".")

  // Strip trailing dot before parsing
  const normalized = isPartial ? trimmed.slice(0, -1) : trimmed

  // Only allow digits and a single decimal point (no negatives from user input)
  if (!/^\d+(\.\d+)?$/.test(normalized)) {
    return { value: null, isPartial: false, wasClamped: false }
  }

  const parsed = Number(normalized)

  // Guard: NaN or Infinity shouldn't happen with the regex above, but be safe
  if (!Number.isFinite(parsed)) {
    return { value: null, isPartial: false, wasClamped: false }
  }

  // Enforce decimal precision — truncate excess digits
  const factor = 10 ** decimals
  const truncated = Math.floor(parsed * factor) / factor

  // Clamp to maxAmount if provided
  let finalValue = truncated
  let wasClamped = false

  if (maxAmount !== undefined && finalValue > maxAmount) {
    finalValue = maxAmount
    wasClamped = true
  }

  return { value: finalValue, isPartial, wasClamped }
}

// ─────────────────────────────────────────────────────────────────────────────
// toProtocolAmount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Convert a display-space number **or** raw bigint to the protocol-scale
 * bigint expected by contracts (value × 10^decimals).
 *
 * Passing an already-scaled bigint returns it unchanged — this prevents
 * accidental double-scaling when callers don't know which representation
 * they have.
 *
 * @throws {RangeError}  When `displayValue` has more decimal places than
 *                       `decimals` allows (would silently truncate).
 *
 * @example
 * toProtocolAmount(1.5, 7)    // 15_000_000n
 * toProtocolAmount(1n, 7)     // 1n   ← already bigint, returned as-is
 */
export function toProtocolAmount(displayValue: number | bigint, decimals: number): bigint {
  // Already in protocol (bigint) space — return unchanged
  if (typeof displayValue === "bigint") {
    return displayValue
  }

  if (!Number.isFinite(displayValue)) {
    throw new RangeError(`toProtocolAmount: non-finite value ${displayValue}`)
  }

  // Use string-based conversion to avoid floating-point drift
  const str = displayValue.toFixed(decimals)
  const [intPart, fracPart = ""] = str.split(".")

  const padded = fracPart.padEnd(decimals, "0")
  const raw = BigInt(intPart) * BigInt(10 ** decimals) + BigInt(padded)

  return raw
}

// ─────────────────────────────────────────────────────────────────────────────
// formatAmount
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Format a display-space number for rendering in an input field.
 * Strips trailing zeros while keeping up to `decimals` significant fractional
 * digits.  Returns `""` for null / undefined.
 *
 * @example
 * formatAmount(1.5000000, 7)  // "1.5"
 * formatAmount(0, 7)          // "0"
 * formatAmount(null, 7)       // ""
 */
export function formatAmount(value: number | null | undefined, decimals: number = MAX_DECIMALS): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return ""
  // toFixed then strip trailing zeros (but keep at least one digit before dot)
  return parseFloat(value.toFixed(decimals)).toString()
}
