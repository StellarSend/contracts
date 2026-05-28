import { CONTRACTS } from "@/app/config/contracts"
import { NETWORK } from "@/app/config/network"
import { Client, type MarketInfo, type OrderInfo, type PositionInfo } from "./generated/synthetics-reader/src"

export type { MarketInfo, OrderInfo, PositionInfo }

/**
 * Thin wrapper around the generated SyntheticsReader Soroban client.
 * Consumes CONTRACTS.syntheticsReader + NETWORK config so callers
 * don't need to pass constructor options directly.
 */
export class SyntheticsReaderClient {
  private client: Client

  constructor() {
    this.client = new Client({
      contractId: CONTRACTS.syntheticsReader,
      networkPassphrase: NETWORK.networkPassphrase,
      rpcUrl: NETWORK.rpcUrl,
    })
  }

  getMarketInfo(marketAddress: string): Promise<MarketInfo> {
    return this.client.getMarketInfo(marketAddress)
  }

  getOrderInfo(account: string): Promise<OrderInfo[]> {
    return this.client.getOrderInfo(account)
  }

  getPositionInfo(account: string, marketAddress: string, isLong: boolean): Promise<PositionInfo> {
    return this.client.getPositionInfo(account, marketAddress, isLong)
  }
}

