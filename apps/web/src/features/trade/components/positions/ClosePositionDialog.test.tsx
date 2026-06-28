import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { cleanup, render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { ClosePositionDialog } from "./ClosePositionDialog"
import type { Position } from "../../hooks/usePositions"

afterEach(() => {
  cleanup()
  document.body.innerHTML = ""
})

function createMockPosition(overrides: Partial<Position> = {}): Position {
  return {
    key: "pos-1",
    account: "GABCDEF123456789",
    marketAddress: "0xbtc",
    marketName: "BTC/USD",
    indexToken: "WBTC",
    collateralToken: "USDC",
    collateralAmount: 1,
    collateralUsd: 5_000,
    sizeUsd: 50_000,
    sizeInUsdRaw: 50_000_000_000n,
    entryPrice: 50_000,
    markPrice: 51_000,
    liquidationPrice: 45_000,
    leverage: 10,
    pnl: 1_000,
    pnlPercent: 20,
    isLong: true,
    pnlAfterFees: 950,
    fundingFeeUsd: 50,
    ...overrides,
  }
}

describe("ClosePositionDialog", () => {
  describe("rendering", () => {
    it("renders nothing when position is null", () => {
      const { container } = render(
        <ClosePositionDialog position={null} open={true} onClose={vi.fn()} onConfirm={vi.fn()} />,
      )
      expect(container.firstChild).toBeNull()
    })

    it("shows the market name in the dialog title", () => {
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      expect(screen.getByRole("heading", { name: /Close Position.*BTC\/USD/ })).toBeInTheDocument()
    })

    it("shows position size in the info block", () => {
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      expect(screen.getByText("$50,000.00")).toBeInTheDocument()
    })

    it("shows Long badge for a long position", () => {
      render(
        <ClosePositionDialog
          position={createMockPosition({ isLong: true })}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      expect(screen.getByText("Long")).toBeInTheDocument()
    })

    it("shows Short badge for a short position", () => {
      render(
        <ClosePositionDialog
          position={createMockPosition({ isLong: false })}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      expect(screen.getByText("Short")).toBeInTheDocument()
    })

    it("defaults to full close mode", () => {
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      expect(screen.getByText(/Closes the entire position/)).toBeInTheDocument()
    })
  })

  describe("close type toggling", () => {
    it("shows partial amount input after toggling to partial close", async () => {
      const user = userEvent.setup()
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      await user.click(screen.getByRole("button", { name: /Partial close/i }))
      expect(screen.getByPlaceholderText("0.00")).toBeInTheDocument()
    })

    it("hides partial amount input when switching back to full close", async () => {
      const user = userEvent.setup()
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      await user.click(screen.getByRole("button", { name: /Partial close/i }))
      await user.click(screen.getByRole("button", { name: /Full close/i }))
      expect(screen.queryByPlaceholderText("0.00")).not.toBeInTheDocument()
    })
  })

  describe("confirm callback payload", () => {
    it("calls onConfirm with full payload on full close", async () => {
      const onConfirm = vi.fn()
      const user = userEvent.setup()
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )
      await user.click(screen.getByRole("button", { name: "Confirm Close" }))
      expect(onConfirm).toHaveBeenCalledWith({ isFull: true, sizeDeltaUsd: 50_000 })
    })

    it("calls onConfirm with partial payload when a partial amount is entered", async () => {
      const onConfirm = vi.fn()
      const user = userEvent.setup()
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={onConfirm}
        />,
      )
      await user.click(screen.getByRole("button", { name: /Partial close/i }))
      await user.type(screen.getByPlaceholderText("0.00"), "10000")
      await user.click(screen.getByRole("button", { name: "Confirm Close" }))
      expect(onConfirm).toHaveBeenCalledWith({ isFull: false, sizeDeltaUsd: 10_000 })
    })

    it("calls onClose after confirm to dismiss the dialog", async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={onClose}
          onConfirm={vi.fn()}
        />,
      )
      await user.click(screen.getByRole("button", { name: "Confirm Close" }))
      expect(onClose).toHaveBeenCalled()
    })
  })

  describe("validation messages", () => {
    beforeEach(async () => {
      const user = userEvent.setup()
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={vi.fn()}
          onConfirm={vi.fn()}
        />,
      )
      await user.click(screen.getByRole("button", { name: /Partial close/i }))
    })

    it("disables confirm button when partial amount is empty", () => {
      expect(screen.getByRole("button", { name: "Confirm Close" })).toBeDisabled()
    })

    it("shows an error when partial amount equals position size", async () => {
      const user = userEvent.setup()
      await user.type(screen.getByPlaceholderText("0.00"), "50000")
      expect(screen.getByText(/less than total position size/i)).toBeInTheDocument()
    })

    it("shows an error when partial amount exceeds position size", async () => {
      const user = userEvent.setup()
      await user.type(screen.getByPlaceholderText("0.00"), "99999")
      expect(screen.getByText(/less than total position size/i)).toBeInTheDocument()
    })

    it("enables confirm button for a valid partial amount", async () => {
      const user = userEvent.setup()
      await user.type(screen.getByPlaceholderText("0.00"), "10000")
      expect(screen.getByRole("button", { name: "Confirm Close" })).toBeEnabled()
    })
  })

  describe("cancel button", () => {
    it("calls onClose when cancel is clicked", async () => {
      const onClose = vi.fn()
      const user = userEvent.setup()
      render(
        <ClosePositionDialog
          position={createMockPosition()}
          open={true}
          onClose={onClose}
          onConfirm={vi.fn()}
        />,
      )
      await user.click(screen.getByRole("button", { name: "Cancel" }))
      expect(onClose).toHaveBeenCalledTimes(1)
    })
  })
})
