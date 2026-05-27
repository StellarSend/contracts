import { useEffect } from "react"
import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk"
import { useWalletStore } from "../store/wallet-store"

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const { address, setConnected, setDisconnected } = useWalletStore()

  useEffect(() => {
    if (!address) return

    StellarWalletsKit.getAddress()
      .then(({ address: liveAddress }) => {
        if (liveAddress === address) {
          setConnected(liveAddress, "kit")
        } else {
          setDisconnected()
        }
      })
      .catch(() => {
        setDisconnected()
      })
  }, [address, setConnected, setDisconnected])

  return <>{children}</>
}
