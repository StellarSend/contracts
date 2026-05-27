import { useWalletStore } from "../store/wallet-store"
import { NETWORK } from "@/app/config/network"

export function useNetwork() {
  const { network, status } = useWalletStore()

  const isTestnet = network === "testnet"
  const isMainnet = network === "mainnet"
  // Mismatch only meaningful when a wallet is connected
  const mismatch = status === "connected" && network !== NETWORK.name

  return { network, isTestnet, isMainnet, mismatch }
}
