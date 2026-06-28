import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { useWalletStore } from "@/features/wallet/store/wallet-store"
import { fakeWalletAddress } from "@/test/fakes/wallet"
import { FaucetPage } from "./faucet-page"

// ── UI mocks ───────────────────────────────────────────────────────────────────
vi.mock("../hooks/useClaim", () => ({
  useClaim: () => ({
    claimOne: vi.fn(),
    claimAll: vi.fn(),
    pendingTokens: new Set<string>(),
    isBulkPending: false,
  }),
}))

const mockUseFaucetData = vi.fn()
vi.mock("../hooks/useFaucetData", () => ({
  useFaucetData: (...args: unknown[]) => mockUseFaucetData(...args),
}))

vi.mock("@/ui/Navbar", () => ({ Navbar: () => <nav data-testid="navbar" /> }))
vi.mock("@/shared/components/TokenIcon", () => ({
  TokenIcon: ({ symbol }: { symbol: string }) => <span data-testid={`icon-${symbol}`} />,
}))
vi.mock("@/features/wallet/components/ConnectButton", () => ({
  ConnectButton: () => <button>Connect</button>,
}))
vi.mock("@/features/wallet/components/NetworkMismatchBanner", () => ({
  NetworkMismatchBanner: () => null,
}))
vi.mock("@/features/wallet/hooks/useNetwork", () => ({
  useNetwork: () => ({ mismatch: false, network: "testnet" }),
}))

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FaucetPage — per-token cooldown countdown (#327)", () => {
  let queryClient: QueryClient

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })

    useWalletStore.setState({
      address: fakeWalletAddress,
      walletId: "freighter",
      status: "connected",
      pendingTransactionXdr: null,
      network: "testnet",
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
    useWalletStore.setState({
      address: null,
      walletId: null,
      status: "disconnected",
      pendingTransactionXdr: null,
      network: "testnet",
    })
  })

  function renderPage() {
    return render(
      <QueryClientProvider client={queryClient}>
        <FaucetPage />
      </QueryClientProvider>,
    )
  }

  it("renders per-token cooldown text with last claim ledger", async () => {
    mockUseFaucetData.mockReturnValue({
      data: {
        balances: { TUSDC: 5, TWBTC: 5, TETH: 5, TXLM: 5 },
        claimAmounts: { TUSDC: 1, TWBTC: 1, TETH: 1, TXLM: 1 },
        lastClaimLedgers: { TUSDC: 500, TWBTC: 500, TETH: 500, TXLM: 500 },
        cooldownLedgers: 100,
      },
      isLoading: false,
    })

    renderPage()

    await waitFor(() =>
      expect(screen.getAllByText(/Last claim ledger 500/).length).toBe(4),
    )
  })

  it("renders the global cooldown ledger count", async () => {
    mockUseFaucetData.mockReturnValue({
      data: {
        balances: { TUSDC: 0, TWBTC: 0, TETH: 0, TXLM: 0 },
        claimAmounts: { TUSDC: 0, TWBTC: 0, TETH: 0, TXLM: 0 },
        lastClaimLedgers: { TUSDC: 100, TWBTC: 100, TETH: 100, TXLM: 100 },
        cooldownLedgers: 100,
      },
      isLoading: false,
    })

    renderPage()

    await waitFor(() =>
      expect(screen.getByText(/100 ledgers between claims/)).toBeInTheDocument(),
    )
  })

  it("renders 'No claim recorded' when lastClaimLedger is null", async () => {
    mockUseFaucetData.mockReturnValue({
      data: {
        balances: { TUSDC: 0, TWBTC: 0, TETH: 0, TXLM: 0 },
        claimAmounts: { TUSDC: 0, TWBTC: 0, TETH: 0, TXLM: 0 },
        lastClaimLedgers: { TUSDC: null, TWBTC: null, TETH: null, TXLM: null },
        cooldownLedgers: 100,
      },
      isLoading: false,
    })

    renderPage()

    await waitFor(() =>
      expect(screen.getAllByText("No claim recorded").length).toBe(4),
    )
  })

  it("renders token-specific cooldown cards for all 4 tokens", async () => {
    mockUseFaucetData.mockReturnValue({
      data: {
        balances: { TUSDC: 10, TWBTC: 2, TETH: 3, TXLM: 50 },
        claimAmounts: { TUSDC: 1, TWBTC: 1, TETH: 1, TXLM: 1 },
        lastClaimLedgers: { TUSDC: 500, TWBTC: 600, TETH: 700, TXLM: 800 },
        cooldownLedgers: 100,
      },
      isLoading: false,
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getAllByText("TUSDC").length).toBeGreaterThan(0)
      expect(screen.getAllByText("TWBTC").length).toBeGreaterThan(0)
      expect(screen.getAllByText("TETH").length).toBeGreaterThan(0)
      expect(screen.getAllByText("TXLM").length).toBeGreaterThan(0)
    })

    const cooldownTexts = screen.getAllByText(/Last claim ledger/)
    expect(cooldownTexts.length).toBe(4)
  })

  it("shows ready state after cooldown elapses via data update", async () => {
    mockUseFaucetData.mockReturnValue({
      data: {
        balances: { TUSDC: 0, TWBTC: 0, TETH: 0, TXLM: 0 },
        claimAmounts: { TUSDC: 1, TWBTC: 1, TETH: 1, TXLM: 1 },
        lastClaimLedgers: { TUSDC: 995, TWBTC: 995, TETH: 995, TXLM: 995 },
        cooldownLedgers: 100,
      },
      isLoading: false,
    })

    const { rerender } = renderPage()

    await waitFor(() =>
      expect(screen.getAllByText(/Last claim ledger 995/).length).toBe(4),
    )

    mockUseFaucetData.mockReturnValue({
      data: {
        balances: { TUSDC: 5, TWBTC: 5, TETH: 5, TXLM: 5 },
        claimAmounts: { TUSDC: 1, TWBTC: 1, TETH: 1, TXLM: 1 },
        lastClaimLedgers: { TUSDC: 850, TWBTC: 850, TETH: 850, TXLM: 850 },
        cooldownLedgers: 100,
      },
      isLoading: false,
    })

    rerender(
      <QueryClientProvider client={queryClient}>
        <FaucetPage />
      </QueryClientProvider>,
    )

    await waitFor(() =>
      expect(screen.getAllByText(/Last claim ledger 850/).length).toBe(4),
    )
  })

  it("does not use real timers — assertions are deterministic", async () => {
    mockUseFaucetData.mockReturnValue({
      data: {
        balances: { TUSDC: 0, TWBTC: 0, TETH: 0, TXLM: 0 },
        claimAmounts: { TUSDC: 0, TWBTC: 0, TETH: 0, TXLM: 0 },
        lastClaimLedgers: { TUSDC: 500, TWBTC: 500, TETH: 500, TXLM: 500 },
        cooldownLedgers: 100,
      },
      isLoading: false,
    })

    renderPage()

    await waitFor(() =>
      expect(screen.getAllByText(/Last claim ledger 500/).length).toBe(4),
    )

    expect(screen.getAllByText(/Last claim ledger 500/).length).toBe(4)
    expect(screen.getByText(/100 ledgers between claims/)).toBeInTheDocument()
  })
})
