import { Contract, TransactionBuilder, rpc, xdr } from "@stellar/stellar-sdk"
import type { Transaction } from "@stellar/stellar-sdk"
import { CONTRACTS } from "@/app/config/contracts"
import { NETWORK } from "@/app/config/network"
import { sorobanRpc } from "@/lib/soroban/client"
import { i128ToScVal } from "./scval"

export type StakerInfo = {
  stakedSO4: bigint
  stakedEsSO4: bigint
  stakedMultiplierPoints: bigint
  pendingEsSO4Rewards: bigint
  pendingWethFees: bigint
  esSO4Balance: bigint
  stakedAmount: bigint
  accruedRewards: bigint
}

export type StakingRouterBinding = {
  stakeSO4: (account: string, amount: bigint) => Promise<xdr.ScVal>
  unstakeSO4: (account: string, amount: bigint) => Promise<xdr.ScVal>
  claimRewards: (account: string) => Promise<xdr.ScVal>
  getStakerInfo: (account: string) => Promise<StakerInfo>
  compound: (account: string) => Promise<xdr.ScVal>
}

export class StakingRouterClient implements StakingRouterBinding {
  readonly contractId: string

  constructor(contractId = CONTRACTS.stakingRouter) {
    this.contractId = contractId
  }

  async stakeSO4(account: string, amount: bigint): Promise<xdr.ScVal> {
    return this.invoke("stakeSO4", [xdr.ScVal.scvString(account), i128ToScVal(amount)])
  }

  async unstakeSO4(account: string, amount: bigint): Promise<xdr.ScVal> {
    return this.invoke("unstakeSO4", [xdr.ScVal.scvString(account), i128ToScVal(amount)])
  }

  async claimRewards(account: string): Promise<xdr.ScVal> {
    return this.invoke("claimRewards", [xdr.ScVal.scvString(account)])
  }

  async getStakerInfo(_account: string): Promise<StakerInfo> {
    return {
      stakedSO4: 0n,
      stakedEsSO4: 0n,
      stakedMultiplierPoints: 0n,
      pendingEsSO4Rewards: 0n,
      pendingWethFees: 0n,
      stakedAmount: 0n,
      esSO4Balance: 0n,
      accruedRewards: 0n,
    }
  }

  async compound(account: string): Promise<xdr.ScVal> {
    return this.invoke("compound", [xdr.ScVal.scvString(account)])
  }

  private async invoke(_method: string, _args: Array<xdr.ScVal>): Promise<xdr.ScVal> {
    return xdr.ScVal.scvVoid()
  }
}

async function buildStakingTransaction(
  account: string,
  method: "stakeSO4" | "unstakeSO4",
  amount: bigint,
): Promise<Transaction> {
  const sourceAccount = await sorobanRpc.getAccount(account)
  const contract = new Contract(CONTRACTS.stakingRouter)

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK.networkPassphrase,
  })
    .addOperation(contract.call(method, xdr.ScVal.scvString(account), i128ToScVal(amount)))
    .setTimeout(180)
    .build()

  const simulation = await sorobanRpc.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Transaction simulation failed: ${simulation.error}`)
  }

  return rpc.assembleTransaction(tx, simulation).build()
}

/** Build a fee-assembled Soroban transaction calling StakingRouter.stakeSO4. */
export function buildStakeSO4Transaction(account: string, amount: bigint): Promise<Transaction> {
  return buildStakingTransaction(account, "stakeSO4", amount)
}

/** Build a fee-assembled Soroban transaction calling StakingRouter.unstakeSO4. */
export function buildUnstakeSO4Transaction(account: string, amount: bigint): Promise<Transaction> {
  return buildStakingTransaction(account, "unstakeSO4", amount)
}
