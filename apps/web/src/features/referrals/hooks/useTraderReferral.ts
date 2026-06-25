/**
 * apps/web/src/features/referrals/hooks/useTraderReferral.ts
 *
 * Query hook for fetching trader referral assignment from SubQuery indexer.
 * Returns referral code assignment and referrer information for a trader.
 */

import { useQuery } from "@tanstack/react-query"
import { executeGraphQLQuery } from "@/lib/graphql/client"
import { GET_TRADER_REFERRAL } from "@/lib/graphql/queries"
import { indexerQueryKeys } from "@/lib/graphql/query-keys"
import { INDEXER_CONFIG } from "@/app/config/indexer"
import type { TraderReferral } from "@/lib/graphql/types"

export type UseTraderReferralResult = {
  data: TraderReferral | null
  isLoading: boolean
  error: Error | null
  isDisabled: boolean
}

/**
 * Fetch trader referral assignment for a specific trader from the SubQuery indexer.
 * When indexer is disabled, returns null with isDisabled=true.
 *
 * @param trader - The trader address to fetch referral assignment for
 */
export function useTraderReferral(trader: string | null): UseTraderReferralResult {
  const { data, error, isLoading } = useQuery({
    queryKey: indexerQueryKeys.referrals.traderReferral(trader ?? ""),
    queryFn: async () => {
      if (!INDEXER_CONFIG.enabled || !trader) {
        return null
      }
      const result = await executeGraphQLQuery(GET_TRADER_REFERRAL, { trader })
      // Return the first (most recent) referral assignment
      return result.traderReferrals.nodes[0] ?? null
    },
    enabled: INDEXER_CONFIG.enabled && !!trader,
    retry: 3,
    staleTime: 60_000, // 60 seconds - referral assignments don't change often
  })

  if (!INDEXER_CONFIG.enabled) {
    return {
      data: null,
      error: null,
      isLoading: false,
      isDisabled: true,
    }
  }

  return {
    data: data ?? null,
    error: error as Error | null,
    isLoading,
    isDisabled: false,
  }
}
