import { Contract, TransactionBuilder, rpc, scValToNative, xdr } from "@stellar/stellar-sdk"
import { CONTRACTS } from "@/app/config/contracts"
import { NETWORK } from "@/app/config/network"
import { sorobanRpc } from "@/lib/soroban/client"
import {
  createOrderArgs,
  cancelOrderArgs,
  swapOrderArgs,
  type CreateOrderParams,
  type OrderKey,
  type SwapOrderParams,
  type BatchOperation,
} from "@/lib/contracts/generated/exchange-router/src"
import type { Transaction } from "@stellar/stellar-sdk"

/**
 * Build a fee-assembled Soroban transaction calling ExchangeRouter.createOrder.
 */
export async function buildCreateOrderTransaction(
  params: CreateOrderParams,
): Promise<Transaction> {
  const sourceAccount = await sorobanRpc.getAccount(params.account)
  const contract = new Contract(CONTRACTS.exchangeRouter)

  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK.networkPassphrase,
  })
    .addOperation(contract.call("createOrder", ...createOrderArgs(params)))
    .setTimeout(180)
    .build()

  const simulation = await sorobanRpc.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Transaction simulation failed: ${simulation.error}`)
  }

  return rpc.assembleTransaction(tx, simulation).build()
}

/**
 * Build a fee-assembled Soroban transaction calling ExchangeRouter.cancelOrder.
 */
export async function buildCancelOrderTransaction(
  account: string,
  orderKey: OrderKey,
): Promise<Transaction> {
  const sourceAccount = await sorobanRpc.getAccount(account)
  const contract = new Contract(CONTRACTS.exchangeRouter)

  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK.networkPassphrase,
  })
    .addOperation(contract.call("cancelOrder", ...cancelOrderArgs(account, orderKey)))
    .setTimeout(180)
    .build()

  const simulation = await sorobanRpc.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Transaction simulation failed: ${simulation.error}`)
  }

  return rpc.assembleTransaction(tx, simulation).build()
}

/**
 * Build a fee-assembled Soroban transaction calling ExchangeRouter.createSwapOrder.
 */
export async function buildSwapOrderTransaction(
  params: SwapOrderParams,
): Promise<Transaction> {
  const sourceAccount = await sorobanRpc.getAccount(params.account)
  const contract = new Contract(CONTRACTS.exchangeRouter)

  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK.networkPassphrase,
  })
    .addOperation(contract.call("createSwapOrder", ...swapOrderArgs(params)))
    .setTimeout(180)
    .build()

  const simulation = await sorobanRpc.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Transaction simulation failed: ${simulation.error}`)
  }

  return rpc.assembleTransaction(tx, simulation).build()
}

/**
 * Build a multi-operation Soroban transaction from a batch of createOrder / cancelOrder ops.
 * All operations succeed or all fail atomically.
 */
export async function buildClaimFundingFeesTransaction(
  account: string,
  marketAddresses: string[],
): Promise<Transaction> {
  const sourceAccount = await sorobanRpc.getAccount(account)
  const contract = new Contract(CONTRACTS.exchangeRouter)

  let tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "claimFundingFees",
        xdr.ScVal.scvString(account),
        xdr.ScVal.scvVec(marketAddresses.map((m) => xdr.ScVal.scvString(m))),
      ),
    )
    .setTimeout(180)
    .build()

  const simulation = await sorobanRpc.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Claim funding fees simulation failed: ${simulation.error}`)
  }

  return rpc.assembleTransaction(tx, simulation).build()
}

export type CreateDepositParams = {
  account: string
  market: string
  longTokenAmount: bigint
  shortTokenAmount: bigint
}

/**
 * Build a fee-assembled Soroban transaction calling ExchangeRouter.createDeposit.
 * Returns both the assembled transaction and the simulated GM tokens to receive
 * (decoded from the simulation result when available).
 */
export async function buildCreateDepositTransaction(
  params: CreateDepositParams,
): Promise<{ tx: Transaction; expectedGm: bigint | null }> {
  const sourceAccount = await sorobanRpc.getAccount(params.account)
  const contract = new Contract(CONTRACTS.exchangeRouter)

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK.networkPassphrase,
  })
    .addOperation(
      contract.call(
        "createDeposit",
        xdr.ScVal.scvString(params.market),
        xdr.ScVal.scvString(params.longTokenAmount.toString()),
        xdr.ScVal.scvString(params.shortTokenAmount.toString()),
      ),
    )
    .setTimeout(180)
    .build()

  const simulation = await sorobanRpc.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Deposit simulation failed: ${simulation.error}`)
  }

  let expectedGm: bigint | null = null
  const retval = simulation.result?.retval
  if (retval) {
    try {
      expectedGm = BigInt(scValToNative(retval) as string | number | bigint)
    } catch {
      expectedGm = null
    }
  }

  return { tx: rpc.assembleTransaction(tx, simulation).build(), expectedGm }
}

export async function buildBatchOrderTransaction(
  account: string,
  operations: Array<BatchOperation>,
): Promise<Transaction> {
  const sourceAccount = await sorobanRpc.getAccount(account)
  const contract = new Contract(CONTRACTS.exchangeRouter)

  let builder = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: NETWORK.networkPassphrase,
  })

  for (const op of operations) {
    if (op.actionType === "createOrder" && op.orderParams) {
      builder = builder.addOperation(
        contract.call("createOrder", ...createOrderArgs(op.orderParams)),
      )
    } else if (op.actionType === "cancelOrder" && op.cancelKey) {
      builder = builder.addOperation(
        contract.call("cancelOrder", ...cancelOrderArgs(account, op.cancelKey)),
      )
    }
  }

  let tx = builder.setTimeout(30).build()

  const simulation = await sorobanRpc.simulateTransaction(tx)
  if (rpc.Api.isSimulationError(simulation)) {
    throw new Error(`Batch transaction simulation failed: ${simulation.error}`)
  }

  return rpc.assembleTransaction(tx, simulation).build()
}
