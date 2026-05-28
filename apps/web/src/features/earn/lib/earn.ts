import { toast } from "sonner"
import { submitTx } from "@/shared/hooks/useTxSubmit"
import { NETWORK } from "@/app/config/network"
import { queryClient } from "@/app/providers/QueryProvider"
import { prepareAndSign } from "@/lib/soroban/tx-builder"
import { parseSorobanError } from "@/lib/soroban/errors"
import { walletKit } from "@/features/wallet/lib/wallet-kit"
import { queryKeys } from "@/shared/lib/query-keys"
import { toSorobanAmount } from "@/shared/lib/bignum"
import {
  buildStakeSO4Transaction,
  buildUnstakeSO4Transaction,
} from "@/lib/contracts/staking-router"
import { buildCreateDepositTransaction } from "@/lib/contracts/exchange-router-client"
import { GM_POOLS } from "../data/pools"

const SO4_DECIMALS = 7
const GM_TOKEN_DECIMALS = 7

function fakeTxDelay(ms = 1500): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

function isValidAccount(account: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(account)
}

async function runMockWrite(loadingMessage: string, successMessage: string, delay = 1500): Promise<string> {
  return submitTx(async () => "", {
    loadingMessage,
    successMessage,
    successDescription: () => "Tx: DUMMY_TX_HASH",
    execute: async () => {
      await fakeTxDelay(delay)
      return "DUMMY_TX_HASH"
    },
    onError: (error) => (error instanceof Error ? error.message : "Transaction failed"),
  })
}

async function invalidateStakingQueries(account: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: queryKeys.earn.stakingInfo(account) }),
    queryClient.invalidateQueries({ queryKey: ["tokenBalances", account] }),
  ])
}

export async function stakeSO4(account: string, amountSO4: number): Promise<string> {
  if (!isValidAccount(account)) throw new Error("Connect your wallet before staking.")
  if (!(amountSO4 > 0)) throw new Error("Enter an amount of SO4 to stake.")

  const amount = toSorobanAmount(amountSO4, SO4_DECIMALS)

  return submitTx(
    async () => {
      const tx = await buildStakeSO4Transaction(account, amount)
      return prepareAndSign(tx, walletKit, NETWORK.networkPassphrase)
    },
    {
      loadingMessage: `Staking ${amountSO4} SO4...`,
      successMessage: "SO4 staked successfully",
      successDescription: (hash) => `Tx: ${hash.slice(0, 8)}...`,
      onSuccess: () => invalidateStakingQueries(account),
      onError: parseSorobanError,
    },
  )
}

export async function unstakeSO4(account: string, amountSO4: number): Promise<string> {
  if (!isValidAccount(account)) throw new Error("Connect your wallet before unstaking.")
  if (!(amountSO4 > 0)) throw new Error("Enter an amount of SO4 to unstake.")

  const amount = toSorobanAmount(amountSO4, SO4_DECIMALS)

  return submitTx(
    async () => {
      const tx = await buildUnstakeSO4Transaction(account, amount)
      return prepareAndSign(tx, walletKit, NETWORK.networkPassphrase)
    },
    {
      loadingMessage: `Unstaking ${amountSO4} SO4...`,
      successMessage: "SO4 unstaked successfully",
      successDescription: (hash) =>
        `Tokens may be subject to an unbonding period before withdrawal. Tx: ${hash.slice(0, 8)}...`,
      onSuccess: () => invalidateStakingQueries(account),
      onError: parseSorobanError,
    },
  )
}

export async function depositGM(account: string, poolName: string, amountUsd: number): Promise<string> {
  if (!isValidAccount(account)) throw new Error("Connect your wallet before depositing.")
  if (!(amountUsd > 0)) throw new Error("Enter an amount to deposit.")

  const pool = GM_POOLS.find(
    (p) => p.name === poolName || p.id === poolName || p.marketAddress === poolName,
  )
  if (!pool) throw new Error(`Unknown GM pool: ${poolName}`)

  // Deposit the full amount as the long token; short side is left to rebalancing.
  const longTokenAmount = toSorobanAmount(amountUsd, GM_TOKEN_DECIMALS)

  let expectedGm: bigint | null = null

  return submitTx(
    async () => {
      const built = await buildCreateDepositTransaction({
        account,
        market: pool.marketAddress,
        longTokenAmount,
        shortTokenAmount: 0n,
      })
      expectedGm = built.expectedGm
      return prepareAndSign(built.tx, walletKit, NETWORK.networkPassphrase)
    },
    {
      loadingMessage: `Depositing into ${pool.name}...`,
      successMessage: "GM deposit submitted",
      successDescription: (hash) =>
        expectedGm !== null
          ? `~${expectedGm.toString()} GM expected | Tx: ${hash.slice(0, 8)}...`
          : `Tx: ${hash.slice(0, 8)}...`,
      onSuccess: () =>
        queryClient.invalidateQueries({ queryKey: ["earn", "gmPoolData"] }),
      onError: parseSorobanError,
    },
  )
}

export async function withdrawGM(_account: string, poolName: string, _gmAmount: number): Promise<string> {
  return runMockWrite(`Withdrawing from ${poolName}...`, "GM withdrawal submitted")
}

export async function depositGLV(_account: string, vaultName: string, _amountUsd: number): Promise<string> {
  return runMockWrite(`Depositing into ${vaultName}...`, "GLV deposit submitted")
}

export async function withdrawGLV(_account: string, vaultName: string, _glvAmount: number): Promise<string> {
  return runMockWrite(`Withdrawing from ${vaultName}...`, "GLV withdrawal submitted")
}

export async function claimRewards(_account: string): Promise<string> {
  return runMockWrite("Claiming rewards...", "Rewards claimed", 1000)
}

export async function compoundRewards(_account: string): Promise<string> {
  return runMockWrite("Compounding rewards...", "Rewards compounded", 1200)
}

export async function vestEsSO4(_account: string, _amount: number): Promise<string> {
  return runMockWrite("Starting esSO4 vesting...", "Vesting started")
}

export function buySO4(): void {
  toast.info("SO4 purchase coming soon", { description: "DEX integration in progress" })
}
