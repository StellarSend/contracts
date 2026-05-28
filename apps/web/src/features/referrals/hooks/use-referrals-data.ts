import { useQuery } from "@tanstack/react-query"
import { useWalletStore } from "@/features/wallet/store/wallet-store"
import { ReferralStorageClient } from "@/lib/contracts/referral-storage"
import { getTraderDiscountBps, getTraderReferralCode } from "@/lib/soroban/referral-storage"

export type TimePeriod = "24h" | "7d" | "30d" | "90d" | "total"

export type TraderStats = {
  referralCode: string | null
  tradingVolumeUsd: number
  discountUsd: number
  discountPct: number
  claimableRebateUsd: number
  lastUpdated: string | null
}

export type AffiliateStats = {
  code: string | null
  referralCount: number
  tradingVolumeUsd: number
  commissionUsd: number
  tier: 1 | 2 | 3
  lastUpdated: string | null
}

export type AffiliateReferral = {
  account: string
  volumeUsd: number
  commissionUsd: number
  registeredAt: string
}

export type DistributionEntry = {
  id: string
  epoch: string
  date: string
  token: string
  amount: number
  amountUsd: number
  txHash: string
}

export function useTraderStats(period: TimePeriod = "total") {
  const address = useWalletStore((state) => state.address)

  return useQuery<TraderStats>({
    queryKey: ["referrals", "trader-stats", address, period],
    queryFn: async (): Promise<TraderStats> => {
      if (!address) {
        return {
          referralCode: null,
          tradingVolumeUsd: 0,
          discountUsd: 0,
          discountPct: 0,
          claimableRebateUsd: 0,
          lastUpdated: null,
        }
      }

      const client = new ReferralStorageClient()
      const [referralCode, rebates, discountBps] = await Promise.all([
        getTraderReferralCode(address),
        client.getTraderRebates(address),
        getTraderDiscountBps(address),
      ])

      const discountPct = referralCode ? Math.max(1, Math.round(discountBps / 100)) : 5

      return {
        referralCode,
        tradingVolumeUsd: rebates.totalDiscountUsd,
        discountUsd: rebates.totalDiscountUsd,
        discountPct,
        claimableRebateUsd: rebates.claimableRebateUsd,
        lastUpdated: new Date().toISOString(),
      }
    },
    enabled: !!address,
    staleTime: 60_000,
  })
}

export function useAffiliateStats(period: TimePeriod = "total") {
  return useQuery<AffiliateStats>({
    queryKey: ["referrals", "affiliate-stats", period],
    queryFn: async (): Promise<AffiliateStats> => {
      // TODO: Fetch from ReferralsReader Soroban contract:
      //   - getAffiliateCode(account) → code string
      //   - getAffiliateStats(account, period) → referralCount, tradingVolumeUsd, commissionUsd
      //   - getTierLevel(totalVolumeUsd) → tier 1|2|3
      return {
        code: null,
        referralCount: 0,
        tradingVolumeUsd: 0,
        commissionUsd: 0,
        tier: 1,
        lastUpdated: null,
      }
    },
    staleTime: 60_000,
  })
}

export function useAffiliateReferrals() {
  return useQuery<Array<AffiliateReferral>>({
    queryKey: ["referrals", "affiliate-referrals"],
    queryFn: async (): Promise<Array<AffiliateReferral>> => {
      // TODO: Query Stellar subgraph / event log:
      //   - Filter ReferralCodeUpdated events where affiliate === account
      //   - Join with per-address trading stats for volume + commission
      return []
    },
    staleTime: 60_000,
  })
}

export function useDistributions() {
  return useQuery<Array<DistributionEntry>>({
    queryKey: ["referrals", "distributions"],
    queryFn: async (): Promise<Array<DistributionEntry>> => {
      // TODO: Query RewardDistributor events on Stellar:
      //   - Filter DistributionClaimed where affiliate === account
      //   - Group by epoch (weekly), include txHash for explorer link
      return []
    },
    staleTime: 60_000,
  })
}
