import { useWalletContext } from "../components/WalletProvider"

export function useWallet() {
  const { address, status, walletId, connect, disconnect, signTransaction } = useWalletContext()

  return {
    address,
    isConnected: status === "connected",
    status,
    walletId,
    connect,
    disconnect,
    signTransaction,
  }
}
