export type LiquidationParams = {
  entryPrice: number
  collateralUsd: number
  sizeUsd: number
  isLong: boolean
  /** Default 50 = 0.5% */
  maintenanceMarginRateBps?: number
}

/**
 * Estimate the liquidation price for a leveraged position.
 *
 * Returns the price at which the position's losses consume all collateral
 * minus the maintenance margin buffer.
 */
export function estimateLiquidationPrice(params: LiquidationParams): number {
  const {
    entryPrice,
    collateralUsd,
    sizeUsd,
    isLong,
    maintenanceMarginRateBps = 50,
  } = params

  if (!entryPrice || !sizeUsd) return 0

  const maintenanceMargin = (sizeUsd * maintenanceMarginRateBps) / 10_000
  const maxLoss = collateralUsd - maintenanceMargin
  const posTokens = sizeUsd / entryPrice

  return isLong
    ? entryPrice - maxLoss / posTokens
    : entryPrice + maxLoss / posTokens
}
