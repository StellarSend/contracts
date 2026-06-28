/**
 * Smoke test: AppProviders mounts children without crashing.
 *
 * MSW is active via vitest.setup.ts (onUnhandledRequest: "error"), so any
 * provider-triggered network request without a registered handler will fail
 * the test — ensuring the guard stays enabled.
 */
import { afterEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import { AppProviders } from "./index"

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

// StellarWalletsKit performs dynamic imports and tries to connect to the
// extension on mount — stub the entire SDK so no real wallet code runs.
vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: {
    init: vi.fn(),
    on: vi.fn(() => vi.fn()), // returns unsubscribe fn
    authModal: vi.fn(),
    disconnect: vi.fn(),
  },
}))

vi.mock("@creit.tech/stellar-wallets-kit/modules/utils", () => ({
  defaultModules: vi.fn(() => []),
}))

vi.mock("@creit.tech/stellar-wallets-kit/types", () => ({
  KitEventType: { STATE_UPDATED: "STATE_UPDATED", DISCONNECT: "DISCONNECT" },
  Networks: { TESTNET: "Test SDF Network ; September 2015", PUBLIC: "Public Global Stellar Network ; September 2015" },
}))

// ReactQueryDevtools tries to render a floating panel — skip it in tests.
vi.mock("@tanstack/react-query-devtools", () => ({
  ReactQueryDevtools: () => null,
}))

// useIndexerInvalidation may fire a query on mount — stub it out.
vi.mock("@/lib/graphql/use-indexer-invalidation", () => ({
  useIndexerInvalidation: vi.fn(),
}))

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("AppProviders smoke render", () => {
  afterEach(cleanup)

  it("mounts without crashing and renders a trivial child", () => {
    render(
      <AppProviders>
        <p data-testid="child">hello providers</p>
      </AppProviders>,
    )

    expect(screen.getByTestId("child")).toBeInTheDocument()
  })

  it("the trivial child is visible", () => {
    render(
      <AppProviders>
        <span data-testid="visible-child">visible</span>
      </AppProviders>,
    )

    const child = screen.getByTestId("visible-child")
    expect(child).toBeVisible()
    expect(child).toHaveTextContent("visible")
  })

  it("renders multiple children without crashing", () => {
    render(
      <AppProviders>
        <div data-testid="child-a">A</div>
        <div data-testid="child-b">B</div>
      </AppProviders>,
    )

    expect(screen.getByTestId("child-a")).toBeInTheDocument()
    expect(screen.getByTestId("child-b")).toBeInTheDocument()
  })

  it("does not render the error boundary fallback on a clean mount", () => {
    render(
      <AppProviders>
        <p data-testid="no-error">no error</p>
      </AppProviders>,
    )

    // Error page renders an h1 — it must not be present on a clean mount
    expect(screen.queryByRole("heading")).not.toBeInTheDocument()
    expect(screen.getByTestId("no-error")).toBeInTheDocument()
  })
})
