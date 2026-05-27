import { useQuery } from "@tanstack/react-query"
import { useWalletStore } from "../store/wallet-store"
import { NETWORK } from "@/app/config/network"

type HorizonBalance = {
  asset_type: "native" | "credit_alphanum4" | "credit_alphanum12"
  asset_code?: string
  balance: string
}

async function fetchTokenBalances(
  address: string
): Promise<Record<string, number>> {
  const res = await fetch(`${NETWORK.horizonUrl}/accounts/${address}`)
  if (!res.ok) throw new Error(`Horizon error ${res.status}`)
  const data = await res.json()

  const result: Record<string, number> = {}
  for (const entry of data.balances as Array<HorizonBalance>) {
    const symbol = entry.asset_type === "native" ? "XLM" : (entry.asset_code ?? "")
    if (symbol) result[symbol] = parseFloat(entry.balance)
  }
  return result
}

export function useTokenBalances() {
  const { address, status } = useWalletStore()

  return useQuery({
    queryKey: ["tokenBalances", address],
    queryFn: () => fetchTokenBalances(address!),
    enabled: !!address && status === "connected",
    staleTime: 15_000,
    refetchInterval: 15_000,
  })
}
