import { describe, expect, it } from "vitest"
import { formatToken } from "./format"

describe("formatToken", () => {
  describe("fallback display for invalid amounts", () => {
    it.each([
      ["undefined amount", undefined],
      ["null amount", null],
      ["NaN amount", Number.NaN],
      ["positive infinity", Number.POSITIVE_INFINITY],
      ["negative infinity", Number.NEGATIVE_INFINITY],
    ] as const)("returns the shared fallback for %s", (_label, amount) => {
      expect(formatToken(amount, "USDC")).toBe("—")
      expect(formatToken(amount, "TWBTC")).toBe("—")
    })
  })

  describe("amount and symbol display", () => {
    it("places the token symbol after the formatted amount", () => {
      expect(formatToken(1.5, "TUSDC")).toBe("1.5 TUSDC")
      expect(formatToken(0.00432, "TWBTC")).toBe("0.0043 TWBTC")
    })

    it("formats zero balances for faucet-style token symbols", () => {
      expect(formatToken(0, "TXLM")).toBe("0 TXLM")
      expect(formatToken(0, "TUSDC", { decimals: 2 })).toBe("0 TUSDC")
      expect(formatToken(0, "TUSDC", { decimals: 2, minDecimals: 2 })).toBe("0.00 TUSDC")
    })

    it("formats typical faucet claim amounts with two decimal places", () => {
      expect(formatToken(250, "TUSDC", { decimals: 2 })).toBe("250 TUSDC")
      expect(formatToken(12.3, "TETH", { decimals: 2 })).toBe("12.3 TETH")
      expect(formatToken(12.345, "TUSDC", { decimals: 2 })).toBe("12.35 TUSDC")
    })

    it("formats trading balances with four decimal places by default", () => {
      expect(formatToken(0.123456, "TWBTC")).toBe("0.1235 TWBTC")
      expect(formatToken(42.9876, "TXLM")).toBe("42.9876 TXLM")
    })

    it("formats large balances with grouping separators", () => {
      expect(formatToken(1_234_567.8912, "USDC", { decimals: 4 })).toBe("1,234,567.8912 USDC")
      expect(formatToken(9_876_543.21, "WBTC", { decimals: 2 })).toBe("9,876,543.21 WBTC")
    })
  })

  describe("decimal precision options", () => {
    it("respects the maximum decimal precision option", () => {
      expect(formatToken(1234.56789, "USDC", { decimals: 2 })).toBe("1,234.57 USDC")
      expect(formatToken(0.00009, "BTC", { decimals: 4 })).toBe("0.0001 BTC")
      expect(formatToken(0.000001, "BTC", { decimals: 4 })).toBe("0 BTC")
    })

    it("pads amounts to the configured minimum decimal precision", () => {
      expect(formatToken(100, "esSO4", { minDecimals: 2 })).toBe("100.00 esSO4")
      expect(formatToken(5, "MP", { decimals: 4, minDecimals: 2 })).toBe("5.00 MP")
    })

    it("matches faucet balance formatting with four decimal places", () => {
      expect(formatToken(1234.5678, "TUSDC", { decimals: 4 })).toBe("1,234.5678 TUSDC")
    })
  })
})
