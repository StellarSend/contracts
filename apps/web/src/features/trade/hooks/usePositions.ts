import { useQuery } from "@tanstack/react-query"
import { queryKeys } from "../lib/query-keys"
import { MARKETS } from "../data/markets"
import { useWalletStore } from "@/features/wallet/store/wallet-store"
import { SyntheticsReaderClient } from "@/lib/contracts/synthetics-reader"
import { fromSorobanAmount } from "@/shared/lib/bignum"
import { getToken } from "../data/tokens"

export type Position = {
  key: string                   // unique: account + market + collateral + isLong
  account: string
  marketAddress: string
  marketName: string            // e.g. "BTC/USD"
  indexToken: string
  collateralToken: string
  collateralAmount: number      // in token units
  collateralUsd: number
  sizeUsd: number
  entryPrice: number
  markPrice: number
  liquidationPrice: number
  leverage: number
  pnl: number                   // unrealized PnL in USD
  pnlPercent: number
  isLong: boolean
  pnlAfterFees: number
  fundingFeeDebt: number
}

const CHAIN_ID = "stellar-mainnet"
const USD_DECIMALS = 30

async function fetchPositions(account: string): Promise<Array<Position>> {
  if (!account) return []

  const client = new SyntheticsReaderClient()

  const positions = await Promise.all(
    MARKETS.flatMap(async (market) => {
      return Promise.all(
        [true, false].map(async (isLong) => {
          try {
            const info = await client.getPositionInfo(account, market.address, isLong)
            if (!info || info.sizeUsd === 0n) return null

            const collateralTokenSymbol = isLong ? market.longTokenAddress : market.shortTokenAddress
            const tokenMeta = getToken(collateralTokenSymbol)
            const decimals = tokenMeta?.decimals ?? 7

            const collateralAmount = fromSorobanAmount(info.collateralAmount, decimals)
            const collateralUsd = fromSorobanAmount(info.collateralUsd, USD_DECIMALS)
            const sizeUsd = fromSorobanAmount(info.sizeUsd, USD_DECIMALS)
            const entryPrice = fromSorobanAmount(info.entryPrice, USD_DECIMALS)
            const markPrice = fromSorobanAmount(info.markPrice, USD_DECIMALS)
            const liquidationPrice = fromSorobanAmount(info.liquidationPrice, USD_DECIMALS)
            const pnl = fromSorobanAmount(info.pnl, USD_DECIMALS)
            const fundingFeeDebt = fromSorobanAmount(info.fundingFeeDebt, USD_DECIMALS)
            
            const pnlAfterFees = pnl - fundingFeeDebt
            const pnlPercent = collateralUsd > 0 ? (pnlAfterFees / collateralUsd) * 100 : 0
            const leverage = info.leverage

            return {
              key: `${account}-${market.address}-${isLong ? "long" : "short"}`,
              account,
              marketAddress: market.address,
              marketName: market.name,
              indexToken: market.indexTokenAddress,
              collateralToken: collateralTokenSymbol,
              collateralAmount,
              collateralUsd,
              sizeUsd,
              entryPrice,
              markPrice,
              liquidationPrice,
              leverage,
              pnl,
              pnlPercent,
              isLong,
              pnlAfterFees,
              fundingFeeDebt,
            } satisfies Position
          } catch (e) {
            console.error(`Failed to fetch position info for market=${market.address} isLong=${isLong}`, e)
            return null
          }
        })
      )
    })
  ).then((results) => results.flat().filter((p): p is Position => p !== null))

  return positions
}

export function usePositions() {
  const account = useWalletStore((state) => state.address)

  return useQuery<Array<Position>>({
    queryKey: queryKeys.trade.positions(CHAIN_ID, account ?? ""),
    queryFn: () => fetchPositions(account!),
    enabled: !!account,
    staleTime: 10_000,
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
  })
}

