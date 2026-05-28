export type TierLevel = 1 | 2 | 3

export type ReferralInfo = {
  /** Affiliate code registered to the account, or null when none is set. */
  code: string | null
  /** Trader tier (1=Bronze, 2=Silver, 3=Gold). */
  tier: TierLevel
}

export type ReferralStorageBinding = {
  getReferralInfo: (account: string) => Promise<ReferralInfo>
  getTraderTier: (account: string) => Promise<TierLevel>
}
