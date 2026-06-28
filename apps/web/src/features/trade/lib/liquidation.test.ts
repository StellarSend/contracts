import { describe, expect, it } from "vitest"
import { estimateLiquidationPrice } from "./liquidation"

describe("estimateLiquidationPrice", () => {
  describe("zero / missing inputs", () => {
    it("returns 0 when sizeUsd is 0", () => {
      const result = estimateLiquidationPrice({
        entryPrice: 50_000,
        collateralUsd: 5_000,
        sizeUsd: 0,
        isLong: true,
      })
      expect(result).toBe(0)
      expect(isFinite(result)).toBe(true)
    })

    it("returns 0 when entryPrice is 0", () => {
      const result = estimateLiquidationPrice({
        entryPrice: 0,
        collateralUsd: 5_000,
        sizeUsd: 50_000,
        isLong: true,
      })
      expect(result).toBe(0)
      expect(isFinite(result)).toBe(true)
    })

    it("does not produce NaN with zero collateral", () => {
      const result = estimateLiquidationPrice({
        entryPrice: 50_000,
        collateralUsd: 0,
        sizeUsd: 50_000,
        isLong: true,
      })
      expect(isNaN(result)).toBe(false)
      expect(isFinite(result)).toBe(true)
    })

    it("does not produce Infinity with zero inputs", () => {
      const result = estimateLiquidationPrice({
        entryPrice: 0,
        collateralUsd: 0,
        sizeUsd: 0,
        isLong: false,
      })
      expect(isFinite(result) || result === 0).toBe(true)
    })
  })

  describe("long positions", () => {
    // entryPrice=50000, collateral=5000, size=50000 (10x)
    // maintenance = 50000 * 50/10000 = 250
    // maxLoss = 5000 - 250 = 4750
    // posTokens = 50000 / 50000 = 1
    // liqPrice = 50000 - 4750 = 45250
    it("computes long liquidation price at 10x leverage", () => {
      expect(
        estimateLiquidationPrice({
          entryPrice: 50_000,
          collateralUsd: 5_000,
          sizeUsd: 50_000,
          isLong: true,
        }),
      ).toBeCloseTo(45_250, 2)
    })

    // 5x leverage: collateral=10000, size=50000
    // maintenance = 50000*50/10000 = 250
    // maxLoss = 10000 - 250 = 9750
    // liqPrice = 50000 - 9750 = 40250
    it("computes long liquidation price at 5x leverage", () => {
      expect(
        estimateLiquidationPrice({
          entryPrice: 50_000,
          collateralUsd: 10_000,
          sizeUsd: 50_000,
          isLong: true,
        }),
      ).toBeCloseTo(40_250, 2)
    })

    // 20x leverage: collateral=2500, size=50000
    // maintenance = 250
    // maxLoss = 2500 - 250 = 2250
    // liqPrice = 50000 - 2250 = 47750
    it("computes long liquidation price at 20x leverage", () => {
      expect(
        estimateLiquidationPrice({
          entryPrice: 50_000,
          collateralUsd: 2_500,
          sizeUsd: 50_000,
          isLong: true,
        }),
      ).toBeCloseTo(47_750, 2)
    })

    it("long liquidation price is below entry price", () => {
      const result = estimateLiquidationPrice({
        entryPrice: 50_000,
        collateralUsd: 5_000,
        sizeUsd: 50_000,
        isLong: true,
      })
      expect(result).toBeLessThan(50_000)
    })
  })

  describe("short positions", () => {
    // entryPrice=50000, collateral=5000, size=50000 (10x short)
    // maintenance = 250
    // maxLoss = 4750
    // liqPrice = 50000 + 4750 = 54750
    it("computes short liquidation price at 10x leverage", () => {
      expect(
        estimateLiquidationPrice({
          entryPrice: 50_000,
          collateralUsd: 5_000,
          sizeUsd: 50_000,
          isLong: false,
        }),
      ).toBeCloseTo(54_750, 2)
    })

    // 5x short: collateral=10000
    // maxLoss = 9750
    // liqPrice = 50000 + 9750 = 59750
    it("computes short liquidation price at 5x leverage", () => {
      expect(
        estimateLiquidationPrice({
          entryPrice: 50_000,
          collateralUsd: 10_000,
          sizeUsd: 50_000,
          isLong: false,
        }),
      ).toBeCloseTo(59_750, 2)
    })

    // 20x short: collateral=2500
    // maxLoss = 2250
    // liqPrice = 50000 + 2250 = 52250
    it("computes short liquidation price at 20x leverage", () => {
      expect(
        estimateLiquidationPrice({
          entryPrice: 50_000,
          collateralUsd: 2_500,
          sizeUsd: 50_000,
          isLong: false,
        }),
      ).toBeCloseTo(52_250, 2)
    })

    it("short liquidation price is above entry price", () => {
      const result = estimateLiquidationPrice({
        entryPrice: 50_000,
        collateralUsd: 5_000,
        sizeUsd: 50_000,
        isLong: false,
      })
      expect(result).toBeGreaterThan(50_000)
    })
  })

  describe("custom maintenance margin rate", () => {
    it("applies custom maintenanceMarginRateBps", () => {
      // 100 bps = 1% maintenance
      // maintenance = 50000 * 100 / 10000 = 500
      // maxLoss = 5000 - 500 = 4500
      // liqPrice = 50000 - 4500 = 45500
      expect(
        estimateLiquidationPrice({
          entryPrice: 50_000,
          collateralUsd: 5_000,
          sizeUsd: 50_000,
          isLong: true,
          maintenanceMarginRateBps: 100,
        }),
      ).toBeCloseTo(45_500, 2)
    })
  })
})
