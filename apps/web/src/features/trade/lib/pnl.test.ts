import { describe, expect, it } from "vitest"
import { formatPnl, formatPnlPercent } from "./pnl"

describe("formatPnl", () => {
  describe("sign prefix", () => {
    it("prefixes positive PnL with +", () => {
      expect(formatPnl(500)).toMatch(/^\+/)
    })

    it("prefixes negative PnL with - (via currency format)", () => {
      const result = formatPnl(-250)
      expect(result).toMatch(/-/)
      expect(result).not.toMatch(/^\+/)
    })

    it("prefixes zero PnL with +", () => {
      expect(formatPnl(0)).toMatch(/^\+/)
    })
  })

  describe("currency formatting", () => {
    it("formats a positive value as USD with 2 decimals", () => {
      expect(formatPnl(500)).toBe("+$500.00")
    })

    it("formats a negative value as USD", () => {
      expect(formatPnl(-250.5)).toBe("-$250.50")
    })

    it("formats zero as USD", () => {
      expect(formatPnl(0)).toBe("+$0.00")
    })

    it("formats a large positive value with thousands separator", () => {
      expect(formatPnl(12_345.67)).toBe("+$12,345.67")
    })

    it("formats a large negative value with thousands separator", () => {
      expect(formatPnl(-12_345.67)).toBe("-$12,345.67")
    })
  })

  describe("missing / invalid inputs", () => {
    it("returns fallback for undefined", () => {
      expect(formatPnl(undefined)).toBe("—")
    })

    it("returns fallback for null", () => {
      expect(formatPnl(null)).toBe("—")
    })

    it("returns fallback for NaN", () => {
      expect(formatPnl(NaN)).toBe("—")
    })

    it("returns fallback for Infinity", () => {
      expect(formatPnl(Infinity)).toBe("—")
    })

    it("returns fallback for -Infinity", () => {
      expect(formatPnl(-Infinity)).toBe("—")
    })
  })
})

describe("formatPnlPercent", () => {
  describe("sign prefix", () => {
    it("prefixes positive percentage with +", () => {
      expect(formatPnlPercent(12.5)).toMatch(/^\+/)
    })

    it("does not prefix negative percentage with +", () => {
      expect(formatPnlPercent(-3.75)).not.toMatch(/^\+/)
    })

    it("prefixes zero percentage with +", () => {
      expect(formatPnlPercent(0)).toMatch(/^\+/)
    })
  })

  describe("formatting", () => {
    it("formats a positive percentage with 2 decimal places", () => {
      expect(formatPnlPercent(12.5)).toBe("+12.50%")
    })

    it("formats a negative percentage with 2 decimal places", () => {
      expect(formatPnlPercent(-3.75)).toBe("-3.75%")
    })

    it("formats zero with 2 decimal places", () => {
      expect(formatPnlPercent(0)).toBe("+0.00%")
    })

    it("formats a fractional percentage precisely", () => {
      expect(formatPnlPercent(100)).toBe("+100.00%")
    })
  })

  describe("missing / invalid inputs", () => {
    it("returns fallback for undefined", () => {
      expect(formatPnlPercent(undefined)).toBe("—")
    })

    it("returns fallback for null", () => {
      expect(formatPnlPercent(null)).toBe("—")
    })

    it("returns fallback for NaN", () => {
      expect(formatPnlPercent(NaN)).toBe("—")
    })

    it("returns fallback for Infinity", () => {
      expect(formatPnlPercent(Infinity)).toBe("—")
    })
  })
})
