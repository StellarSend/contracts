/**
 * Explorer URL builder tests.
 *
 * Module cache is reset between network-variant sections via vi.resetModules()
 * so each describe block starts from a clean import state.  The helpers
 * themselves accept an explicit `network` parameter, so no module-level state
 * is involved — vi.resetModules() is called at the boundary as documented in
 * the acceptance criteria, even though the pure-function design makes it
 * unnecessary in practice.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────────────────

const TX_HASH = "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2"
const ACCOUNT_ID = "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN"
const CONTRACT_ID = "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAF"

// ─────────────────────────────────────────────────────────────────────────────
// Testnet URLs
// ─────────────────────────────────────────────────────────────────────────────

describe("explorer URL builders — testnet", () => {
  let explorerTxUrl: typeof import("./explorer").explorerTxUrl
  let explorerAccountUrl: typeof import("./explorer").explorerAccountUrl
  let explorerContractUrl: typeof import("./explorer").explorerContractUrl

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("./explorer")
    explorerTxUrl = mod.explorerTxUrl
    explorerAccountUrl = mod.explorerAccountUrl
    explorerContractUrl = mod.explorerContractUrl
  })

  afterEach(() => {
    vi.resetModules()
  })

  it("builds a transaction URL for testnet", () => {
    expect(explorerTxUrl(TX_HASH, "testnet")).toBe(
      `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
    )
  })

  it("defaults to testnet when no network argument is supplied", () => {
    expect(explorerTxUrl(TX_HASH)).toBe(
      `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
    )
  })

  it("builds an account URL for testnet", () => {
    expect(explorerAccountUrl(ACCOUNT_ID, "testnet")).toBe(
      `https://stellar.expert/explorer/testnet/account/${ACCOUNT_ID}`,
    )
  })

  it("builds a contract URL for testnet", () => {
    expect(explorerContractUrl(CONTRACT_ID, "testnet")).toBe(
      `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`,
    )
  })

  it("transaction URL contains the exact hash", () => {
    const url = explorerTxUrl(TX_HASH, "testnet")
    expect(url).toContain(TX_HASH)
  })

  it("account URL contains the exact account id", () => {
    const url = explorerAccountUrl(ACCOUNT_ID, "testnet")
    expect(url).toContain(ACCOUNT_ID)
  })

  it("contract URL contains the exact contract id", () => {
    const url = explorerContractUrl(CONTRACT_ID, "testnet")
    expect(url).toContain(CONTRACT_ID)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Mainnet URLs
// ─────────────────────────────────────────────────────────────────────────────

describe("explorer URL builders — mainnet", () => {
  let explorerTxUrl: typeof import("./explorer").explorerTxUrl
  let explorerAccountUrl: typeof import("./explorer").explorerAccountUrl
  let explorerContractUrl: typeof import("./explorer").explorerContractUrl

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("./explorer")
    explorerTxUrl = mod.explorerTxUrl
    explorerAccountUrl = mod.explorerAccountUrl
    explorerContractUrl = mod.explorerContractUrl
  })

  afterEach(() => {
    vi.resetModules()
  })

  it("builds a transaction URL for mainnet", () => {
    expect(explorerTxUrl(TX_HASH, "mainnet")).toBe(
      `https://stellar.expert/explorer/public/tx/${TX_HASH}`,
    )
  })

  it("builds an account URL for mainnet", () => {
    expect(explorerAccountUrl(ACCOUNT_ID, "mainnet")).toBe(
      `https://stellar.expert/explorer/public/account/${ACCOUNT_ID}`,
    )
  })

  it("builds a contract URL for mainnet", () => {
    expect(explorerContractUrl(CONTRACT_ID, "mainnet")).toBe(
      `https://stellar.expert/explorer/public/contract/${CONTRACT_ID}`,
    )
  })

  it("mainnet URL uses 'public' path segment, not 'testnet'", () => {
    const url = explorerTxUrl(TX_HASH, "mainnet")
    expect(url).toContain("/public/")
    expect(url).not.toContain("/testnet/")
  })

  it("testnet URL uses 'testnet' path segment, not 'public'", () => {
    const url = explorerTxUrl(TX_HASH, "testnet")
    expect(url).toContain("/testnet/")
    expect(url).not.toContain("/public/")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Exact URL string assertions (both networks side-by-side)
// ─────────────────────────────────────────────────────────────────────────────

describe("explorer URL exact string assertions", () => {
  let explorerTxUrl: typeof import("./explorer").explorerTxUrl
  let explorerAccountUrl: typeof import("./explorer").explorerAccountUrl
  let explorerContractUrl: typeof import("./explorer").explorerContractUrl

  beforeEach(async () => {
    vi.resetModules()
    const mod = await import("./explorer")
    explorerTxUrl = mod.explorerTxUrl
    explorerAccountUrl = mod.explorerAccountUrl
    explorerContractUrl = mod.explorerContractUrl
  })

  afterEach(() => {
    vi.resetModules()
  })

  it.each([
    [
      "tx — testnet",
      () => explorerTxUrl(TX_HASH, "testnet"),
      `https://stellar.expert/explorer/testnet/tx/${TX_HASH}`,
    ],
    [
      "tx — mainnet",
      () => explorerTxUrl(TX_HASH, "mainnet"),
      `https://stellar.expert/explorer/public/tx/${TX_HASH}`,
    ],
    [
      "account — testnet",
      () => explorerAccountUrl(ACCOUNT_ID, "testnet"),
      `https://stellar.expert/explorer/testnet/account/${ACCOUNT_ID}`,
    ],
    [
      "account — mainnet",
      () => explorerAccountUrl(ACCOUNT_ID, "mainnet"),
      `https://stellar.expert/explorer/public/account/${ACCOUNT_ID}`,
    ],
    [
      "contract — testnet",
      () => explorerContractUrl(CONTRACT_ID, "testnet"),
      `https://stellar.expert/explorer/testnet/contract/${CONTRACT_ID}`,
    ],
    [
      "contract — mainnet",
      () => explorerContractUrl(CONTRACT_ID, "mainnet"),
      `https://stellar.expert/explorer/public/contract/${CONTRACT_ID}`,
    ],
  ] as const)("%s produces exact URL", (_label, fn, expected) => {
    expect(fn()).toBe(expected)
  })
})
