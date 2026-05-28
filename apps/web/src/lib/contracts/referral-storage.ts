import { CONTRACTS } from "@/app/config/contracts"
import type { TierLevel } from "./referral-storage-types"
import {
  getReferralCodeStats,
  getTraderDiscountBps,
  getTraderRebateInfo,
  getTraderReferralCode,
  type ReferralCodeStats,
  type TraderRebateInfo,
} from "@/lib/soroban/referral-storage"

export type { TierLevel, ReferralInfo, ReferralStorageBinding } from "./referral-storage-types"
export type { ReferralCodeStats, TraderRebateInfo }

/**
 * Client for the ReferralStorage Soroban contract.
 *
 * Read methods simulate against the deployed contract (or return typed defaults
 * when the contract id is still a placeholder). Write helpers live in
 * `@/lib/soroban/referral-storage`.
 */
export class ReferralStorageClient {
  readonly contractId: string

  constructor(contractId = CONTRACTS.referralStorage) {
    this.contractId = contractId
  }

  async getReferralInfo(account: string): Promise<import("./referral-storage-types").ReferralInfo> {
    const [code, discountBps] = await Promise.all([
      getTraderReferralCode(account),
      getTraderDiscountBps(account),
    ])

    const tier: TierLevel = discountBps >= 500 ? 3 : discountBps >= 300 ? 2 : 1

    return { code, tier }
  }

  async getTraderTier(account: string): Promise<TierLevel> {
    const info = await this.getReferralInfo(account)
    return info.tier
  }

  async getStatsForCode(code: string, period: string): Promise<ReferralCodeStats> {
    return getReferralCodeStats(code, period)
  }

  async getTraderRebates(account: string): Promise<TraderRebateInfo> {
    return getTraderRebateInfo(account)
  }
}
