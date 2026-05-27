import { useQuery } from "@tanstack/react-query"
import { fromSorobanAmount } from "@/shared/lib/bignum"

type MarketPoolAmounts = {
  longTokenAmount: number
  shortTokenAmount: number
  poolValueUsd: number
}

async function fetchMarketPoolAmounts(marketAddress: string): Promise<MarketPoolAmounts> {
  // TODO: replace with SyntheticsReader.getMarketPoolAmounts(marketAddress).
  const longRaw = marketAddress.includes("BTC") ? 12_500_0000000n : marketAddress.includes("ETH") ? 23_400_0000000n : 89_000_0000000n
  const shortRaw = marketAddress.includes("BTC") ? 8_200_0000000n : marketAddress.includes("ETH") ? 11_100_0000000n : 7_600_0000000n

  return {
    longTokenAmount: fromSorobanAmount(longRaw, 7),
    shortTokenAmount: fromSorobanAmount(shortRaw, 7),
    poolValueUsd: fromSorobanAmount(longRaw + shortRaw, 7),
  }
}

export function useMarketPoolAmounts(marketAddress: string) {
  return useQuery<MarketPoolAmounts>({
    queryKey: ["earn", "marketPoolAmounts", marketAddress],
    queryFn: () => fetchMarketPoolAmounts(marketAddress),
    enabled: !!marketAddress,
    staleTime: 20_000,
    refetchInterval: 30_000,
  })
}
