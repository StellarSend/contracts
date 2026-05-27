import { useEffect } from "react"
import { walletKit } from "../lib/wallet-kit"
import { useWalletStore } from "../store/wallet-store"

interface WalletProviderProps {
  children: React.ReactNode
}

export function WalletProvider({ children }: WalletProviderProps) {
  const { address, walletId, setConnected, setDisconnected } = useWalletStore()

  useEffect(() => {
    // Nothing persisted — nothing to reconnect
    if (!address || !walletId) return

    // Point the kit at the previously-used wallet module, then ask for the
    // current address.  If the extension is still installed and approved,
    // this resolves without a modal.  Any error means the wallet is gone —
    // clear the store without showing a toast.
    walletKit.setWallet(walletId)
    walletKit
      .getAddress()
      .then(({ address: liveAddress }) => {
        if (liveAddress === address) {
          setConnected(liveAddress, walletId)
        } else {
          setDisconnected()
        }
      })
      .catch(() => {
        setDisconnected()
      })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run only once on mount

  return <>{children}</>
}
