import { describe, expect, it } from "vitest"
import {
  MAX_DECIMALS,
  formatAmount,
  parseAmount,
  toProtocolAmount,
} from "./amount"

// ─────────────────────────────────────────────────────────────────────────────
// parseAmount
// ─────────────────────────────────────────────────────────────────────────────

describe("parseAmount", () => {
  describe("valid integer input", () => {
    it("parses an integer string", () => {
      const result = parseAmount("42")
      expect(result.value).toBe(42)
      expect(result.isPartial).toBe(false)
      expect(result.wasClamped).toBe(false)
    })

    it("parses zero", () => {
      const result = parseAmount("0")
      expect(result.value).toBe(0)
      expect(result.isPartial).toBe(false)
    })

    it("parses a large integer", () => {
      const result = parseAmount("1000000")
      expect(result.value).toBe(1_000_000)
    })
  })

  describe("valid decimal input", () => {
    it("parses a decimal string", () => {
      const result = parseAmount("1.5")
      expect(result.value).toBe(1.5)
      expect(result.isPartial).toBe(false)
    })

    it("parses full precision up to 7 decimal places", () => {
      const result = parseAmount("0.1234567")
      expect(result.value).toBe(0.1234567)
    })

    it("truncates input beyond 7 decimal places to 7", () => {
      // 0.12345678 truncated at 7 dp → 0.1234567
      const result = parseAmount("0.12345678")
      expect(result.value).toBe(0.1234567)
    })

    it("parses a custom decimals option", () => {
      const result = parseAmount("1.5678", { decimals: 2 })
      // truncate to 2 dp: 1.56
      expect(result.value).toBe(1.56)
    })
  })

  describe("trailing-dot (partial) input", () => {
    it("treats '1.' as partial with value 1", () => {
      const result = parseAmount("1.")
      expect(result.value).toBe(1)
      expect(result.isPartial).toBe(true)
      expect(result.wasClamped).toBe(false)
    })

    it("treats '0.' as partial with value 0", () => {
      const result = parseAmount("0.")
      expect(result.value).toBe(0)
      expect(result.isPartial).toBe(true)
    })
  })

  describe("empty and non-numeric input", () => {
    it("returns null value for empty string", () => {
      const result = parseAmount("")
      expect(result.value).toBeNull()
      expect(result.isPartial).toBe(false)
    })

    it("returns null for whitespace-only string", () => {
      const result = parseAmount("   ")
      expect(result.value).toBeNull()
    })

    it("returns null for alphabetic input", () => {
      const result = parseAmount("abc")
      expect(result.value).toBeNull()
    })

    it("returns null for mixed alphanumeric input", () => {
      expect(parseAmount("1a2").value).toBeNull()
    })

    it("returns null for negative sign input (users cannot enter negatives)", () => {
      expect(parseAmount("-1").value).toBeNull()
    })

    it("returns null for multiple dots", () => {
      expect(parseAmount("1.2.3").value).toBeNull()
    })
  })

  describe("clamping", () => {
    it("clamps value above maxAmount", () => {
      const result = parseAmount("10", { maxAmount: 5 })
      expect(result.value).toBe(5)
      expect(result.wasClamped).toBe(true)
    })

    it("does not clamp when value equals maxAmount", () => {
      const result = parseAmount("5", { maxAmount: 5 })
      expect(result.value).toBe(5)
      expect(result.wasClamped).toBe(false)
    })

    it("does not clamp when value is below maxAmount", () => {
      const result = parseAmount("3", { maxAmount: 5 })
      expect(result.value).toBe(3)
      expect(result.wasClamped).toBe(false)
    })

    it("clamps decimal values correctly", () => {
      const result = parseAmount("1.5", { maxAmount: 1.25 })
      expect(result.value).toBe(1.25)
      expect(result.wasClamped).toBe(true)
    })
  })

  describe("precision rules", () => {
    it("MAX_DECIMALS constant is 7", () => {
      expect(MAX_DECIMALS).toBe(7)
    })

    it("respects decimals:6 option", () => {
      const result = parseAmount("1.1234567", { decimals: 6 })
      expect(result.value).toBe(1.123456)
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// toProtocolAmount
// ─────────────────────────────────────────────────────────────────────────────

describe("toProtocolAmount", () => {
  it("converts 1.5 to protocol scale with 7 decimals", () => {
    expect(toProtocolAmount(1.5, 7)).toBe(15_000_000n)
  })

  it("converts 0.0000001 — the smallest unit at 7 decimals", () => {
    expect(toProtocolAmount(0.0000001, 7)).toBe(1n)
  })

  it("converts 1 to 10^7 with 7 decimals", () => {
    expect(toProtocolAmount(1, 7)).toBe(10_000_000n)
  })

  it("converts 1000000 (large integer) without precision loss", () => {
    expect(toProtocolAmount(1_000_000, 7)).toBe(10_000_000_000_000n)
  })

  it("does not down-cast an already-bigint value", () => {
    const raw = 999_999_999_999_999n
    expect(toProtocolAmount(raw, 7)).toBe(raw)
  })

  it("returns a bigint regardless of display scale", () => {
    const result = toProtocolAmount(2.5, 6)
    expect(typeof result).toBe("bigint")
    expect(result).toBe(2_500_000n)
  })

  it("throws for non-finite values", () => {
    expect(() => toProtocolAmount(Infinity, 7)).toThrow(RangeError)
    expect(() => toProtocolAmount(-Infinity, 7)).toThrow(RangeError)
    expect(() => toProtocolAmount(NaN, 7)).toThrow(RangeError)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatAmount
// ─────────────────────────────────────────────────────────────────────────────

describe("formatAmount", () => {
  it("formats 1.5000000 as '1.5' (strips trailing zeros)", () => {
    expect(formatAmount(1.5, 7)).toBe("1.5")
  })

  it("formats 0 as '0'", () => {
    expect(formatAmount(0, 7)).toBe("0")
  })

  it("returns empty string for null", () => {
    expect(formatAmount(null, 7)).toBe("")
  })

  it("returns empty string for undefined", () => {
    expect(formatAmount(undefined, 7)).toBe("")
  })

  it("returns empty string for NaN", () => {
    expect(formatAmount(NaN, 7)).toBe("")
  })

  it("preserves significant decimal digits", () => {
    expect(formatAmount(1.2345678, 7)).toBe("1.2345678")
  })
})
