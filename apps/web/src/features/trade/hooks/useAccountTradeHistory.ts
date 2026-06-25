/**
 * apps/web/src/features/trade/hooks/useAccountTradeHistory.ts
 *
 * Query hook for fetching account trade history from SubQuery indexer.
 * Returns position changes with execution price, PnL, and fees sorted by timestamp descending.
 */

import { useQuery } from "@tanstack/react-query"
import { executeGraphQLQuery } from "@/lib/graphql/client"
import { GET_ACCOUNT_POSITION_CHANGES } from "@/lib/graphql/queries"
import { indexerQueryKeys } from "@/lib/graphql/query-keys"
import { INDEXER_CONFIG } from "@/app/config/indexer"
import type { PositionChange } from "@/lib/graphql/types"

export type UseAccountTradeHistoryResult = {
  data: PositionChange[]
  isLoading: boolean
  error: Error | null
  isDisabled: boolean
}

/**
 * Fetch trade history (position changes) for a specific account from the SubQuery indexer.
 * Results are sorted by timestamp in descending order (most recent first).
 * When indexer is disabled, returns empty array with isDisabled=true.
 *
 * @param account - The account address to fetch trade history for
 */
export function useAccountTradeHistory(account: string | null): UseAccountTradeHistoryResult {
  const { data, error, isLoading } = useQuery({
    queryKey: indexerQueryKeys.tradeHistory.byAccount(account ?? ""),
    queryFn: async () => {
      if (!INDEXER_CONFIG.enabled || !account) {
        return []
      }
      const result = await executeGraphQLQuery(GET_ACCOUNT_POSITION_CHANGES, { account })
      return result.positionChanges.nodes
    },
    enabled: INDEXER_CONFIG.enabled && !!account,
    retry: 3,
    staleTime: 30_000, // 30 seconds - trade history is more stable
  })

  if (!INDEXER_CONFIG.enabled) {
    return {
      data: [],
      error: null,
      isLoading: false,
      isDisabled: true,
    }
  }

  return {
    data: data ?? [],
    error: error as Error | null,
    isLoading,
    isDisabled: false,
  }
}
