import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useWalletStore } from "../store/wallet-store"
import { ConnectButton } from "./ConnectButton"
import { useKeyboardShortcut } from "@/shared/hooks/useKeyboardShortcut"

vi.mock("@/shared/hooks/useKeyboardShortcut", () => ({
  useKeyboardShortcut: vi.fn(),
}))

vi.mock("@/app/providers", () => ({
  useWallet: () => ({
    disconnect: vi.fn(),
  }),
}))

vi.mock("../hooks/useBalance", () => ({
  useBalance: () => null,
}))

vi.mock("@creit.tech/stellar-wallets-kit/sdk", () => ({
  StellarWalletsKit: {
    refreshSupportedWallets: vi.fn().mockResolvedValue([
      { id: "freighter", name: "Freighter", isAvailable: true },
      { id: "xbull", name: "xBull", isAvailable: false },
      { id: "hana", name: "Hana", isAvailable: false },
    ]),
    setWallet: vi.fn(),
    fetchAddress: vi.fn().mockResolvedValue("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"),
  },
}))

describe("WalletSelectModal — wallet selection (#330)", () => {
  beforeEach(() => {
    useWalletStore.setState({
      address: null,
      walletId: null,
      status: "disconnected",
      pendingTransactionXdr: null,
      network: "testnet",
    })

    ;(useKeyboardShortcut as ReturnType<typeof vi.fn>).mockImplementation(() => {})
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

  it("opens the wallet modal when Connect Wallet is clicked", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    const button = screen.getByRole("button", { name: /Connect wallet/i })
    await user.click(button)

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })
    expect(screen.getByRole("dialog")).toHaveTextContent("Connect Wallet")
  })

  it("shows all three wallet options", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(screen.getByText("Freighter")).toBeInTheDocument()
      expect(screen.getByText("xBull")).toBeInTheDocument()
      expect(screen.getByText("Hana")).toBeInTheDocument()
    })
  })

  it("each wallet option has a button that is clickable", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: /Connect wallet/i }))

    await waitFor(() => {
      const freighterBtn = screen.getByText("Freighter").closest("button")!
      expect(freighterBtn).toBeInTheDocument()
      expect(freighterBtn).toHaveAttribute("type", "button")

      const xbullBtn = screen.getByText("xBull").closest("button")!
      expect(xbullBtn).toBeInTheDocument()

      const hanaBtn = screen.getByText("Hana").closest("button")!
      expect(hanaBtn).toBeInTheDocument()
    })
  })

  it("shows Not installed label for unavailable wallets", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: /Connect wallet/i }))

    await waitFor(() => {
      const xbullButton = screen.getByText("xBull").closest("button")!
      expect(xbullButton).toHaveTextContent("Not installed")

      const hanaButton = screen.getByText("Hana").closest("button")!
      expect(hanaButton).toHaveTextContent("Not installed")
    })
  })

  it("shows install prompt when clicking unavailable wallet", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(screen.getByText("xBull")).toBeInTheDocument()
    })

    const xbullButton = screen.getByText("xBull").closest("button")!
    await user.click(xbullButton)

    await waitFor(() => {
      expect(screen.getByText("xBull is not installed.")).toBeInTheDocument()
    })
  })

  it("shows the mobile wallet QR code section", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(screen.getByText("Use Mobile Wallet")).toBeInTheDocument()
    })
    expect(screen.getByText(/Scan to connect from a mobile wallet/)).toBeInTheDocument()
  })

  it("closes modal when dialog close is triggered", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })

    await user.keyboard("{Escape}")

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument()
    })
  })

  it("dialog has correct title and description", async () => {
    const user = userEvent.setup()
    render(<ConnectButton />)

    await user.click(screen.getByRole("button", { name: /Connect wallet/i }))

    await waitFor(() => {
      expect(screen.getByRole("dialog")).toBeInTheDocument()
    })

    const dialog = screen.getByRole("dialog")
    expect(dialog).toHaveTextContent("Connect Wallet")
    expect(dialog).toHaveTextContent("Choose a supported Stellar wallet to continue.")
  })
})
