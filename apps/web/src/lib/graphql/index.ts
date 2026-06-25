/**
 * apps/web/src/lib/graphql/index.ts
 *
 * Central export point for GraphQL client, types, queries, and query keys.
 */

// Client
export { executeGraphQLQuery } from "./client"
export type { GraphQLError, GraphQLResponse } from "./client"

// Types
export type {
  ProtocolContract,
  Token,
  Market,
  MarketConfigSnapshot,
  Deposit,
  Withdrawal,
  PoolBalanceSnapshot,
  MarketTokenTransfer,
  Order,
  Position,
  PositionChange,
  Liquidation,
  AdlEvent,
  FeeClaim,
  UiFeeAccrual,
  FundingFeeClaim,
  ReferralCode,
  TraderReferral,
  ReferralOwnershipTransfer,
} from "./types"

// Queries
export {
  GET_ACCOUNT_POSITIONS,
  GET_ACCOUNT_ORDERS,
  GET_MARKETS,
  GET_POOL_BALANCE_SNAPSHOTS,
  GET_ACCOUNT_DEPOSITS,
  GET_ACCOUNT_WITHDRAWALS,
  GET_ACCOUNT_POSITION_CHANGES,
  GET_TRADER_REFERRAL,
  GET_AFFILIATE_TRADERS,
  GET_ACCOUNT_FEE_CLAIMS,
} from "./queries"

// Query Keys
export { indexerQueryKeys } from "./query-keys"

// Hooks
export { useIndexerInvalidation } from "./use-indexer-invalidation"
