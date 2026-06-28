import { describe, expect, it } from "vitest"
import {
  formatAddress,
  isValidAddress,
  isValidContractAddress,
  isValidStellarAddress,
  shortenAddress,
  STELLAR_ADDRESS_LENGTH,
} from "./address"

// Valid 56-character Stellar addresses used throughout the tests.
// GBBD47... is a real 56-char G address (StrKey base32: A-Z, 2-7).
const VALID_G_ADDRESS = "GBBD47UZQ2YNRGESRV37TJZWQ6HC76ZK34CSXVGBTCVRXGT7GBNXVQ34"
const VALID_C_ADDRESS = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF"

// Verify our fixtures are actually 56 chars (structural sanity)
if (VALID_G_ADDRESS.length !== 56) throw new Error("G fixture length is wrong")
if (VALID_C_ADDRESS.length !== 56) throw new Error("C fixture length is wrong")

// ─────────────────────────────────────────────────────────────────────────────
// isValidStellarAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidStellarAddress", () => {
  it("returns true for a valid G... address", () => {
    expect(isValidStellarAddress(VALID_G_ADDRESS)).toBe(true)
  })

  it("returns false for a C... contract address", () => {
    expect(isValidStellarAddress(VALID_C_ADDRESS)).toBe(false)
  })

  it("returns false for an empty string", () => {
    expect(isValidStellarAddress("")).toBe(false)
  })

  it("returns false for null", () => {
    expect(isValidStellarAddress(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isValidStellarAddress(undefined)).toBe(false)
  })

  it("returns false for an address that is too short", () => {
    expect(isValidStellarAddress("GAAZI4TCR3")).toBe(false)
  })

  it("returns false for an address that is too long", () => {
    expect(isValidStellarAddress(VALID_G_ADDRESS + "X")).toBe(false)
  })

  it("returns false for a string starting with a different prefix", () => {
    // Replace G with X — same length (56 chars), wrong prefix
    const xAddr = "X" + VALID_G_ADDRESS.slice(1)
    expect(isValidStellarAddress(xAddr)).toBe(false)
  })

  it("returns false when address contains lowercase characters", () => {
    const lower = VALID_G_ADDRESS.toLowerCase()
    expect(isValidStellarAddress(lower)).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isValidContractAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidContractAddress", () => {
  it("returns true for a valid C... address", () => {
    expect(isValidContractAddress(VALID_C_ADDRESS)).toBe(true)
  })

  it("returns false for a G... public key address", () => {
    expect(isValidContractAddress(VALID_G_ADDRESS)).toBe(false)
  })

  it("returns false for an empty string", () => {
    expect(isValidContractAddress("")).toBe(false)
  })

  it("returns false for null", () => {
    expect(isValidContractAddress(null)).toBe(false)
  })

  it("returns false for undefined", () => {
    expect(isValidContractAddress(undefined)).toBe(false)
  })

  it("returns false for an address that is too short", () => {
    expect(isValidContractAddress("CAAAAAAAAAA")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// isValidAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("isValidAddress", () => {
  it("returns true for a valid G... address", () => {
    expect(isValidAddress(VALID_G_ADDRESS)).toBe(true)
  })

  it("returns true for a valid C... address", () => {
    expect(isValidAddress(VALID_C_ADDRESS)).toBe(true)
  })

  it("returns false for an empty string", () => {
    expect(isValidAddress("")).toBe(false)
  })

  it("returns false for null", () => {
    expect(isValidAddress(null)).toBe(false)
  })

  it("returns false for a random string", () => {
    expect(isValidAddress("not-an-address")).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// STELLAR_ADDRESS_LENGTH constant
// ─────────────────────────────────────────────────────────────────────────────

describe("STELLAR_ADDRESS_LENGTH", () => {
  it("equals 56", () => {
    expect(STELLAR_ADDRESS_LENGTH).toBe(56)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// shortenAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("shortenAddress", () => {
  it("shortens a G... address to first 4 + last 4 chars by default", () => {
    // GBBD47UZQ2YNRGESRV37TJZWQ6HC76ZK34CSXVGBTCVRXGT7GBNXVQ34
    // first 4: "GBBD"  last 4: "VQ34"
    expect(shortenAddress(VALID_G_ADDRESS)).toBe("GBBD\u2026VQ34")
  })

  it("shortens a C... address to first 4 + last 4 chars by default", () => {
    // CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF
    // first 4: "CAAA"  last 4: "AAAF"
    expect(shortenAddress(VALID_C_ADDRESS)).toBe("CAAA\u2026AAAF")
  })

  it("respects a custom chars option", () => {
    // first 6: "GBBD47"  last 6: "NXVQ34"
    expect(shortenAddress(VALID_G_ADDRESS, { chars: 6 })).toBe("GBBD47\u2026NXVQ34")
  })

  it("respects a custom separator option", () => {
    expect(shortenAddress(VALID_G_ADDRESS, { separator: "..." })).toBe("GBBD...VQ34")
  })

  it("returns empty string for null", () => {
    expect(shortenAddress(null)).toBe("")
  })

  it("returns empty string for undefined", () => {
    expect(shortenAddress(undefined)).toBe("")
  })

  it("returns empty string for empty string", () => {
    expect(shortenAddress("")).toBe("")
  })

  it("returns the address unchanged when it is too short to shorten", () => {
    expect(shortenAddress("GABC")).toBe("GABC")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// formatAddress
// ─────────────────────────────────────────────────────────────────────────────

describe("formatAddress", () => {
  it("returns a shortened display string for a valid G... address", () => {
    expect(formatAddress(VALID_G_ADDRESS)).toBe("GBBD\u2026VQ34")
  })

  it("returns a shortened display string for a valid C... address", () => {
    expect(formatAddress(VALID_C_ADDRESS)).toBe("CAAA\u2026AAAF")
  })

  it("returns '—' for null", () => {
    expect(formatAddress(null)).toBe("—")
  })

  it("returns '—' for undefined", () => {
    expect(formatAddress(undefined)).toBe("—")
  })

  it("returns '—' for an empty string", () => {
    expect(formatAddress("")).toBe("—")
  })

  it("returns '—' for an invalid address", () => {
    expect(formatAddress("not-an-address")).toBe("—")
  })

  it("passes through custom options to shortenAddress", () => {
    expect(formatAddress(VALID_G_ADDRESS, { chars: 6 })).toBe("GBBD47\u2026NXVQ34")
  })
})
