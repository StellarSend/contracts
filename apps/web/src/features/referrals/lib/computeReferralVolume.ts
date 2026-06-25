/**
 * apps/web/src/features/referrals/lib/computeReferralVolume.ts
 *
 * Compute total referral volume from executed orders.
 * Maintains arithmetic precision without loss.
 */

import type { Order } from "@/lib/graphql/types"

/**
 * Compute total referral volume by summing order size deltas.
 * Handles empty arrays and null size deltas gracefully.
 * Uses BigInt for precision to avoid floating point errors.
 *
 * @param orders - Array of executed orders to compute volume from
 * @returns Total volume as a string in base units (e.g., "1000000" for 1 USD with 6 decimals)
 */
export function computeReferralVolume(orders: Order[]): string {
  if (orders.length === 0) {
    return "0"
  }

  try {
    let totalVolume = BigInt(0)

    for (const order of orders) {
      // Only count executed orders with size delta
      if (order.status === "executed" && order.sizeDeltaUsd) {
        // Parse the size delta string as BigInt (assumes it's already in base units)
        const sizeDelta = BigInt(order.sizeDeltaUsd)
        // Take absolute value to handle both increases and decreases
        totalVolume += sizeDelta < 0 ? -sizeDelta : sizeDelta
      }
    }

    return totalVolume.toString()
  } catch (error) {
    console.error("Error computing referral volume:", error)
    return "0"
  }
}

/**
 * Format volume string to human-readable USD with decimals.
 * Assumes input is in base units with 30 decimals (1e30 format).
 *
 * @param volumeStr - Volume string in base units
 * @param decimals - Number of decimals (default 30 for USD 1e30)
 * @returns Formatted volume string (e.g., "1234.56")
 */
export function formatReferralVolume(volumeStr: string, decimals = 30): string {
  if (!volumeStr || volumeStr === "0") {
    return "0"
  }

  try {
    const volume = BigInt(volumeStr)
    const divisor = BigInt(10) ** BigInt(decimals)
    const integerPart = volume / divisor
    const fractionalPart = volume % divisor

    // Format with 2 decimal places for display
    const fractionalStr = fractionalPart.toString().padStart(decimals, "0").slice(0, 2)
    
    return `${integerPart}.${fractionalStr}`
  } catch (error) {
    console.error("Error formatting referral volume:", error)
    return "0"
  }
}
