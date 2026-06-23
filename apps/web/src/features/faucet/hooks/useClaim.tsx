import { useCallback, useState } from "react"
import { toast } from "sonner"
import { useQueryClient } from "@tanstack/react-query"
import { FAUCET_TOKENS } from "../data/tokens"
import { createFaucetClient } from "../lib/clients"
import { useWalletStore } from "@/features/wallet/store/wallet-store"
import { walletKit } from "@/features/wallet/lib/wallet-kit"
import { sendAndPoll } from "@/lib/tx-builder"
import { explorerTxUrl } from "@/app/config/network"
import { queryKeys } from "@/shared/lib/query-keys"
import { parseSorobanError } from "@/lib/contracts"

function isClaimTooSoonError(error: unknown): boolean {
  const text = String(error).toLowerCase()
  return (
    text.includes("claimtoosoon") ||
    text.includes("claim_too_soon") ||
    // contract error code 6 may appear as '#6' or 'Error(Contract, #6)'
    /error\(contract,\s*#6\)/i.test(String(error))
  )
}

export function useClaim() {
  const address = useWalletStore((state) => state.address)
  const isConnected = useWalletStore((state) => state.status === "connected")
  const queryClient = useQueryClient()
  const [pendingTokens, setPendingTokens] = useState<Set<string>>(new Set())
  const [isBulkPending, setIsBulkPending] = useState(false)

  const claim = useCallback(
    async (tokenIds: Array<string>) => {
      if (!address || !isConnected) return
      if (tokenIds.length === 0) return

      const isBulk = tokenIds.length === FAUCET_TOKENS.length

      if (isBulk) {
        setIsBulkPending(true)
      } else {
        setPendingTokens((prev) => {
          const next = new Set(prev)
          for (const id of tokenIds) {
            next.add(id)
          }
          return next
        })
      }

      const toastId = toast.loading(
        tokenIds.length === 1 ? "Claiming test token…" : "Claiming test tokens…",
      )

      try {
        const faucet = createFaucetClient(address)
        const tx = await faucet.claim_many({
          account: address,
          tokens: tokenIds,
        })

        const unsignedXdr = tx.toXDR()
        const { signedTxXdr } = await walletKit.signTransaction(unsignedXdr)
        const signedXdr = signedTxXdr
        const { hash } = await sendAndPoll(signedXdr)

        // Refresh balances after a successful claim
        await queryClient.invalidateQueries({ queryKey: queryKeys.faucet.data(address) })

        toast.success("Test tokens claimed!", {
          id: toastId,
          description: (
            <a
              href={explorerTxUrl(hash)}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-primary hover:underline"
            >
              View transaction →
            </a>
          ),
        })
      } catch (error) {
        const message = isClaimTooSoonError(error)
          ? "Cooldown active — please wait before claiming again."
          : parseSorobanError(error)
        toast.error(message, { id: toastId })
      } finally {
        if (isBulk) {
          setIsBulkPending(false)
        } else {
          setPendingTokens((prev) => {
            const next = new Set(prev)
            for (const id of tokenIds) {
              next.delete(id)
            }
            return next
          })
        }
      }
    },
    [address, isConnected, queryClient],
  )

  return { claim, pendingTokens, isBulkPending }
}
