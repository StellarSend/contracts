import { useQuery } from "@tanstack/react-query"
import { useWalletStore } from "@/features/wallet/store/wallet-store"
import { SyntheticsReaderClient } from "@/lib/contracts/synthetics-reader"
import { fromSorobanAmount } from "@/shared/lib/bignum"
import { queryKeys } from "../lib/query-keys"
import { MARKETS } from "../data/markets"

const USD_DECIMALS = 30
const CHAIN_ID = "stellar-mainnet"

export type OrderType =
  | "MarketIncrease"
  | "LimitIncrease"
  | "MarketDecrease"
  | "LimitDecrease"
  | "StopLoss"
  | "Swap"

export type OrderStatus = "active" | "frozen"

export type Order = {
  key: string
  account: string
  marketAddress: string
  marketName: string
  indexToken: string
  collateralToken: string
  sizeUsd: number
  triggerPrice: number
  acceptablePrice: number
  orderType: OrderType
  isLong: boolean
  status: OrderStatus
  createdAt: number            // unix timestamp ms
}

async function fetchOrders(account: string): Promise<Array<Order>> {
  const client = new SyntheticsReaderClient()
  const raw = await client.getOrderInfo(account)
  return raw.map((info) => {
    const market = MARKETS.find((m) => m.address === info.marketAddress)
    return {
      key: `${info.account}-${info.marketAddress}-${info.orderType}`,
      account: info.account,
      marketAddress: info.marketAddress,
      marketName: market?.name ?? info.marketAddress,
      indexToken: market?.indexTokenAddress ?? "",
      collateralToken: info.collateralToken,
      sizeUsd: fromSorobanAmount(info.sizeUsd, USD_DECIMALS),
      triggerPrice: fromSorobanAmount(info.triggerPrice, USD_DECIMALS),
      acceptablePrice: fromSorobanAmount(info.acceptablePrice, USD_DECIMALS),
      orderType: info.orderType as OrderType,
      isLong: info.isLong,
      // Contract does not expose a status field — orders returned by
      // getOrderInfo are live (not yet executed or cancelled).
      status: "active" as OrderStatus,
      createdAt: Number(info.createdAt) * 1000,
    }
  })
}

export function hasFrozenOrders(orders: Array<Order>): boolean {
  return orders.some((order) => order.status === "frozen")
}

export function useOrders() {
  const account = useWalletStore((state) => state.address)

  return useQuery<Array<Order>>({
    queryKey: queryKeys.trade.orders(CHAIN_ID, account ?? ""),
    queryFn: () => fetchOrders(account!),
    enabled: !!account,
    staleTime: 10_000,
    refetchInterval: 15_000,
  })
}
