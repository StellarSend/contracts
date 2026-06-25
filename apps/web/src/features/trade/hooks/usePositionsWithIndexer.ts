/**
 * apps/web/src/features/trade/hooks/usePositionsWithIndexer.ts
 *
 * Enhanced position hook that uses SubQuery for historical data
 * and merges with fresh contract reads for live PnL and mark prices.
 */

import { useQuery } from "@tanstack/react-query"
import { useAccountPositions } from "./useAccountPositions"
import { useTokenPrices } from "./useTokenPrices"
import { useWalletStore } from "@/features/wallet/store/wallet-store"
import { INDEXER_CONFIG } from "@/app/config/indexer"
import { syntheticsReaderClient } from "@/lib/contracts"
import { fromSorobanAmount } from "@/shared/lib/bignum"
import { queryKeys } from "../lib/query-keys"
import type { Position } from "./usePositions"
import type { PositionInfo } from "@/lib/contracts"

const CHAIN_ID = "stellar-mainnet"
const USD_DECIMALS = 30
const TOKEN_DECIMALS = 7

/**
 * Fetch fresh PnL and liquidation data from contracts.
 */
async function fetchFreshPositionData(account: string) {
  const rawPositions = await syntheticsReaderClient.getAccountPositions(account)
  
  const freshDataMap = new Map()
  for (const p of rawPositions) {
    const key = `${p.position.account}-${p.position.market}-${p.position.collateralToken}-${p.position.isLong}`
    freshDataMap.set(key, {
      pnlUsd: fromSorobanAmount(p.pnlUsd, USD_DECIMALS),
      fundingFeeUsd: fromSorobanAmount(p.fundingFeeUsd, USD_DECIMALS),
      liquidationPrice: fromSorobanAmount(p.liquidationPrice, USD_DECIMALS),
      sizeInUsdRaw: p.position.sizeInUsd,
    })
  }
  
  return freshDataMap
}

/**
 * Enhanced usePositions that combines SubQuery indexed data with fresh contract reads.
 * Falls back to contract-only data when indexer is disabled.
 */
export function usePositionsWithIndexer() {
  const account = useWalletStore((state) => state.address)
  const { getMidPrice } = useTokenPrices()
  
  // Get indexed positions from SubQuery
  const { data: indexedPositions = [], isLoading: isLoadingIndexer, isDisabled } = useAccountPositions(account)
  
  // Get fresh PnL data from contracts
  const { data: freshDataMap, isLoading: isLoadingFresh } = useQuery({
    queryKey: queryKeys.trade.positionsFresh(CHAIN_ID, account ?? ""),
    queryFn: () => fetchFreshPositionData(account!),
    enabled: INDEXER_CONFIG.enabled && !!account && indexedPositions.length > 0,
    staleTime: 5_000,
    refetchInterval: 10_000,
  })
  
  // If indexer is disabled, fall back to the original usePositions behavior
  const { data: contractPositions, isLoading: isLoadingContract } = useQuery<Array<Position>>({
    queryKey: queryKeys.trade.positions(CHAIN_ID, account ?? ""),
    queryFn: async () => {
      if (!account) return []
      const rawPositions = await syntheticsReaderClient.getAccountPositions(account)
      
      return rawPositions
        .filter((p: PositionInfo) => p.position.sizeInUsd > 0n)
        .map((p: PositionInfo): Position => {
          const props = p.position
          const collateralAmount = fromSorobanAmount(props.collateralAmount, TOKEN_DECIMALS)
          const sizeUsd = fromSorobanAmount(props.sizeInUsd, USD_DECIMALS)
          const sizeInTokens = fromSorobanAmount(props.sizeInTokens, TOKEN_DECIMALS)
          const entryPrice = sizeInTokens > 0 ? sizeUsd / sizeInTokens : 0
          const pnlUsd = fromSorobanAmount(p.pnlUsd, USD_DECIMALS)
          const fundingFeeUsd = fromSorobanAmount(p.fundingFeeUsd, USD_DECIMALS)
          const liquidationPrice = fromSorobanAmount(p.liquidationPrice, USD_DECIMALS)
          const collateralPrice = getMidPrice(props.collateralToken)
          const collateralUsd = collateralPrice > 0 ? collateralAmount * collateralPrice : sizeUsd * 0.01
          const leverage = collateralUsd > 0 ? Math.round(sizeUsd / collateralUsd) : 0
          const pnlAfterFees = pnlUsd - fundingFeeUsd
          const pnlPercent = collateralUsd > 0 ? (pnlAfterFees / collateralUsd) * 100 : 0
          const markPrice = getMidPrice(props.market) || entryPrice

          return {
            key: `${props.account}-${props.market}-${props.collateralToken}-${props.isLong}`,
            account: props.account,
            marketAddress: props.market,
            marketName: props.market,
            indexToken: props.market,
            collateralToken: props.collateralToken,
            collateralAmount,
            collateralUsd,
            sizeUsd,
            sizeInUsdRaw: props.sizeInUsd,
            entryPrice,
            markPrice,
            liquidationPrice,
            leverage,
            pnl: pnlUsd,
            pnlPercent,
            isLong: props.isLong,
            pnlAfterFees,
            fundingFeeUsd,
          }
        })
    },
    enabled: !INDEXER_CONFIG.enabled && !!account,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
  
  // If indexer is disabled, return contract-only data
  if (isDisabled || !INDEXER_CONFIG.enabled) {
    return {
      data: contractPositions ?? [],
      isLoading: isLoadingContract,
      isDisabled: true,
    }
  }
  
  // Merge indexed positions with fresh contract data
  const mergedPositions: Position[] = indexedPositions
    .filter(p => p.status === "open" && parseFloat(p.sizeUsd ?? "0") > 0)
    .map((indexedPos) => {
      const key = `${indexedPos.account}-${indexedPos.market.key}-${indexedPos.collateralToken?.address}-${indexedPos.isLong}`
      const freshData = freshDataMap?.get(key)
      
      const sizeUsd = fromSorobanAmount(BigInt(indexedPos.sizeUsd ?? "0"), USD_DECIMALS)
      const collateralAmount = fromSorobanAmount(BigInt(indexedPos.collateralAmount ?? "0"), TOKEN_DECIMALS)
      const entryPrice = parseFloat(indexedPos.averagePrice ?? "0")
      
      // Use fresh data if available, otherwise use indexed data
      const pnlUsd = freshData?.pnlUsd ?? 0
      const fundingFeeUsd = freshData?.fundingFeeUsd ?? 0
      const liquidationPrice = freshData?.liquidationPrice ?? 0
      
      const collateralPrice = getMidPrice(indexedPos.collateralToken?.address ?? "")
      const collateralUsd = collateralPrice > 0 ? collateralAmount * collateralPrice : sizeUsd * 0.01
      const leverage = collateralUsd > 0 ? Math.round(sizeUsd / collateralUsd) : 0
      const pnlAfterFees = pnlUsd - fundingFeeUsd
      const pnlPercent = collateralUsd > 0 ? (pnlAfterFees / collateralUsd) * 100 : 0
      const markPrice = getMidPrice(indexedPos.market.indexToken?.address ?? "") || entryPrice
      
      return {
        key,
        account: indexedPos.account,
        marketAddress: indexedPos.market.key,
        marketName: indexedPos.market.name ?? indexedPos.market.key,
        indexToken: indexedPos.market.indexToken?.address ?? "",
        collateralToken: indexedPos.collateralToken?.address ?? "",
        collateralAmount,
        collateralUsd,
        sizeUsd,
        sizeInUsdRaw: freshData?.sizeInUsdRaw ?? BigInt(indexedPos.sizeUsd ?? "0"),
        entryPrice,
        markPrice,
        liquidationPrice,
        leverage,
        pnl: pnlUsd,
        pnlPercent,
        isLong: indexedPos.isLong,
        pnlAfterFees,
        fundingFeeUsd,
      }
    })
  
  return {
    data: mergedPositions,
    isLoading: isLoadingIndexer || isLoadingFresh,
    isDisabled: false,
  }
}
