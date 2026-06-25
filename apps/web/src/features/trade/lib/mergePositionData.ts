/**
 * apps/web/src/features/trade/lib/mergePositionData.ts
 *
 * Merge indexed position data with fresh contract reads (PnL, mark price).
 * Computes derived fields like pnlAfterFees, pnlPercent, leverage, and collateralUsd.
 */

import type { Position } from "@/lib/graphql/types"

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type FreshPositionData = {
  /** Current unrealized PnL from Reader Contract */
  pnlUsd: number
  /** Accrued funding fees */
  fundingFeeUsd: number
  /** Current liquidation price */
  liquidationPrice: number
}

export type FreshPriceData = {
  /** Current index token price from Oracle Contract */
  markPrice: number
}

export type HybridPosition = Position & {
  /** Fresh PnL data */
  freshPnlUsd: number
  freshFundingFeeUsd: number
  freshLiquidationPrice: number
  freshMarkPrice: number
  /** Computed derived fields */
  pnlAfterFees: number
  pnlPercent: number
  leverage: number
  collateralUsd: number
}

// ─────────────────────────────────────────────────────────────────────────────
// Merging Function
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Merge indexed position data with fresh contract reads.
 * Handles cases where indexer data is stale but contract data is fresh.
 *
 * @param indexedPosition - Position data from SubQuery indexer
 * @param freshPosition - Fresh PnL data from Reader Contract (optional)
 * @param freshPrice - Fresh mark price from Oracle Contract (optional)
 * @returns Hybrid position with all fields populated and derived fields computed
 */
export function mergePositionData(
  indexedPosition: Position,
  freshPosition?: FreshPositionData,
  freshPrice?: FreshPriceData,
): HybridPosition {
  // Parse indexed values
  const sizeUsd = parseFloat(indexedPosition.sizeUsd ?? "0")
  const collateralAmount = parseFloat(indexedPosition.collateralAmount ?? "0")
  const averagePrice = parseFloat(indexedPosition.averagePrice ?? "0")

  // Use fresh data if available, otherwise fall back to indexed data
  const pnlUsd = freshPosition?.pnlUsd ?? parseFloat(indexedPosition.realizedPnlUsd ?? "0")
  const fundingFeeUsd = freshPosition?.fundingFeeUsd ?? 0
  const liquidationPrice = freshPosition?.liquidationPrice ?? 0
  const markPrice = freshPrice?.markPrice ?? averagePrice

  // Compute collateral in USD (assuming collateral token has same decimals as position)
  // This is a simplified calculation - real implementation would need token price conversion
  const collateralUsd = collateralAmount * markPrice

  // Compute PnL after fees
  const pnlAfterFees = pnlUsd - fundingFeeUsd

  // Compute PnL percentage relative to collateral
  const pnlPercent = collateralUsd > 0 ? (pnlAfterFees / collateralUsd) * 100 : 0

  // Compute leverage
  const leverage = collateralUsd > 0 ? sizeUsd / collateralUsd : 0

  return {
    ...indexedPosition,
    freshPnlUsd: pnlUsd,
    freshFundingFeeUsd: fundingFeeUsd,
    freshLiquidationPrice: liquidationPrice,
    freshMarkPrice: markPrice,
    pnlAfterFees,
    pnlPercent,
    leverage,
    collateralUsd,
  }
}

/**
 * Merge multiple positions with their fresh data.
 *
 * @param indexedPositions - Array of positions from SubQuery
 * @param freshDataMap - Map of position key to fresh data (optional)
 * @param freshPriceMap - Map of market key to fresh price (optional)
 * @returns Array of hybrid positions
 */
export function mergePositionsData(
  indexedPositions: Position[],
  freshDataMap?: Map<string, FreshPositionData>,
  freshPriceMap?: Map<string, FreshPriceData>,
): HybridPosition[] {
  return indexedPositions.map((position) => {
    const freshPosition = freshDataMap?.get(position.key)
    const freshPrice = freshPriceMap?.get(position.market.key)
    return mergePositionData(position, freshPosition, freshPrice)
  })
}
