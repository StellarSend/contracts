import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { PoolTransactionDialog } from "./pool-transaction-dialog"
import type { PoolMarketConfig } from "../data/markets"

vi.mock("@/lib/contracts", () => ({
  getTokenClient: () => ({
    balance: vi.fn().mockResolvedValue(100_000_000n),
  }),
}))

vi.mock("../lib/pool-transactions", () => ({
  submitPoolDeposit: vi.fn().mockResolvedValue({ hash: "testDepositHash123", expectedAmount: 50_000_000n }),
  submitPoolWithdrawal: vi.fn(),
}))

vi.mock("sonner", () => ({
  toast: {
    loading: vi.fn().mockReturnValue("toast-id"),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock("@/shared/components/NumberInput", () => ({
  NumberInput: ({
    value,
    onValueChange,
    onMax,
    placeholder,
  }: {
    value: string
    onValueChange: (v: string) => void
    onMax?: () => void
    placeholder?: string
  }) => (
    <div>
      <input
        type="text"
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
      />
      {onMax && <button onClick={onMax}>MAX</button>}
    </div>
  ),
}))

vi.mock("@/shared/components/TokenIcon", () => ({
  TokenIcon: ({ symbol }: { symbol: string }) => <span data-testid={`icon-${symbol}`} />,
}))

const FAKE_MARKET: PoolMarketConfig = {
  label: "TWBTC/TUSDC",
  displayName: "BTC/USD",
  marketToken: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4",
  indexToken: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSE2",
  longToken: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSE2",
  shortToken: "CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSDS",
  longSymbol: "TWBTC",
  shortSymbol: "TUSDC",
  decimals: 7,
}

const FAKE_ACCOUNT = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"

describe("PoolTransactionDialog — deposit mode (#328)", () => {
  let queryClient: QueryClient
  let onClose: ReturnType<typeof vi.fn>
  let onQueued: ReturnType<typeof vi.fn>

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, staleTime: 0 } },
    })
    onClose = vi.fn()
    onQueued = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function renderDialog(overrides?: Partial<React.ComponentProps<typeof PoolTransactionDialog>>) {
    return render(
      <QueryClientProvider client={queryClient}>
        <PoolTransactionDialog
          open
          mode="deposit"
          market={FAKE_MARKET}
          account={FAKE_ACCOUNT}
          userGmBalance={0n}
          onClose={onClose}
          onQueued={onQueued}
          {...overrides}
        />
      </QueryClientProvider>,
    )
  }

  it("renders the deposit dialog title and description", async () => {
    renderDialog()

    expect(screen.getByText("Deposit TWBTC/TUSDC")).toBeInTheDocument()
    expect(screen.getByText(/Queue a pool deposit/)).toBeInTheDocument()
  })

  it("renders long and short token input fields", async () => {
    renderDialog()

    expect(screen.getByText("TWBTC")).toBeInTheDocument()
    expect(screen.getByText("TUSDC")).toBeInTheDocument()
  })

  it("shows MAX buttons for both token fields", async () => {
    renderDialog()

    const maxButtons = screen.getAllByText("MAX")
    expect(maxButtons.length).toBe(2)
  })

  it("enters an amount in the long token field", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "1.5")

    expect(inputs[0]).toHaveValue("1.5")
  })

  it("enters an amount in the short token field", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[1], "25.0")

    expect(inputs[1]).toHaveValue("25.0")
  })

  it("clicks MAX and sets the long token amount", async () => {
    const user = userEvent.setup()
    renderDialog()

    const maxButtons = screen.getAllByText("MAX")
    await user.click(maxButtons[0])

    const inputs = screen.getAllByRole("textbox")
    expect(inputs[0].value).not.toBe("")
  })

  it("clicks MAX and sets the short token amount", async () => {
    const user = userEvent.setup()
    renderDialog()

    const maxButtons = screen.getAllByText("MAX")
    await user.click(maxButtons[1])

    const inputs = screen.getAllByRole("textbox")
    expect(inputs[1].value).not.toBe("")
  })

  it("disables submit when both amounts are zero", async () => {
    renderDialog()

    const submitButton = screen.getByText("Queue Deposit")
    expect(submitButton).toBeDisabled()
  })

  it("enables submit button when an amount is entered", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "1.0")

    const submitButton = screen.getByText("Queue Deposit")
    expect(submitButton).not.toBeDisabled()
  })

  it("calls onQueued after successful deposit", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "1.0")

    await user.click(screen.getByText("Queue Deposit"))

    await waitFor(() => {
      expect(screen.getByText("Queued")).toBeInTheDocument()
    })
    expect(onQueued).toHaveBeenCalled()
  })

  it("shows error state for invalid decimal input", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "1.12345678")

    await waitFor(() => {
      expect(
        screen.getByText("Enter amounts with no more than 7 decimal places."),
      ).toBeInTheDocument()
    })
  })

  it("calls onClose when cancel is clicked", async () => {
    const user = userEvent.setup()
    renderDialog()

    const cancelButton = screen.getByText("Cancel")
    await user.click(cancelButton)

    expect(onClose).toHaveBeenCalled()
  })

  it("shows balance validation error when amount exceeds token balance", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "11.0")

    await waitFor(() => {
      expect(screen.getByText("Insufficient TWBTC balance.")).toBeInTheDocument()
    })
  })

  it("shows balance validation error for short token exceeding balance", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[1], "11.0")

    await waitFor(() => {
      expect(screen.getByText("Insufficient TUSDC balance.")).toBeInTheDocument()
    })
  })

  it("shows queued state after successful deposit", async () => {
    const user = userEvent.setup()
    renderDialog()

    const inputs = screen.getAllByRole("textbox")
    await user.type(inputs[0], "1.0")

    const submitButton = screen.getByText("Queue Deposit")
    await user.click(submitButton)

    await waitFor(() => {
      expect(screen.getByText("Queued")).toBeInTheDocument()
    })
  })
})
