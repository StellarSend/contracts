import { useState } from "react"
import { useLocation } from "@tanstack/react-router"
import { useNetwork } from "../hooks/useNetwork"
import { useWalletStore } from "../store/wallet-store"
import { NETWORK } from "@/app/config/network"

const SESSION_KEY = "so4-network-mismatch-dismissed"

export function NetworkMismatchBanner() {
  const { pathname } = useLocation()
  const { mismatch, network } = useNetwork()
  const { status } = useWalletStore()
  const [dismissed, setDismissed] = useState(
    () => sessionStorage.getItem(SESSION_KEY) === "1"
  )

  // Never show on landing page
  if (pathname === "/") return null
  if (!mismatch || status !== "connected" || dismissed) return null

  const walletLabel = network === "mainnet" ? "Mainnet" : "Testnet"
  const appLabel = NETWORK.name === "mainnet" ? "Mainnet" : "Testnet"

  function dismiss() {
    sessionStorage.setItem(SESSION_KEY, "1")
    setDismissed(true)
  }

  return (
    <div
      role="alert"
      className="flex items-center justify-between border-b border-yellow-500/30 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-700 dark:text-yellow-400"
    >
      <span>
        Your wallet is connected to {walletLabel} but this app is running on{" "}
        {appLabel}. Please switch networks in your wallet.
      </span>
      <button
        onClick={dismiss}
        className="ml-4 shrink-0 font-medium underline-offset-2 hover:underline"
        aria-label="Dismiss network mismatch warning"
      >
        Dismiss
      </button>
    </div>
  )
}
