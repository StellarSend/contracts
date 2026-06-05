import { Contract, rpc, xdr } from "@stellar/stellar-sdk"

export interface CreateDepositParams {
  account: string
  glvAddress: string
  depositAmount: bigint
}

export interface CreateWithdrawalParams {
  account: string
  glvAddress: string
  withdrawalAmount: bigint
}

export interface GlvInfo {
  glvAddress: string
  totalDeposits: bigint
  totalShares: bigint
  sharePrice: bigint
  lastUpdatedAt: bigint
}

export interface ClientOptions {
  contractId: string
  networkPassphrase: string
  rpcUrl: string
}

function i128(v: bigint): xdr.ScVal {
  return xdr.ScVal.scvI128(
    new xdr.Int128Parts({
      lo: xdr.Uint64.fromString((v & BigInt("0xFFFFFFFFFFFFFFFF")).toString()),
      hi: xdr.Int64.fromString((v >> BigInt(64)).toString()),
    }),
  )
}

function address(a: string): xdr.ScVal {
  return xdr.ScVal.scvString(a)
}

function symbol(s: string): xdr.ScVal {
  return xdr.ScVal.scvSymbol(s)
}

function opt<T>(val: T | null, fn: (v: T) => xdr.ScVal): xdr.ScVal {
  return val !== null ? xdr.ScVal.scvVec([fn(val)]) : xdr.ScVal.scvVoid()
}

export class Client {
  private contract: Contract
  private rpcUrl: string
  private networkPassphrase: string

  constructor(opts: ClientOptions) {
    this.contract = new Contract(opts.contractId)
    this.rpcUrl = opts.rpcUrl
    this.networkPassphrase = opts.networkPassphrase
  }

  private async buildTx(method: string, ...args: xdr.ScVal[]): Promise<string> {
    const server = new rpc.Server(this.rpcUrl)
    const call = this.contract.call(method, ...args)
    const prepared = await server.prepareTransaction(call, "" as any, {
      networkPassphrase: this.networkPassphrase,
    })
    return prepared.toXDR()
  }

  private async simulateTx(method: string, ...args: xdr.ScVal[]): Promise<xdr.ScVal> {
    const server = new rpc.Server(this.rpcUrl)
    const call = this.contract.call(method, ...args)
    const sim = await server.simulateTransaction(call, "" as any, {
      networkPassphrase: this.networkPassphrase,
    })
    if ((sim as any).error) {
      throw new Error(`Simulation error: ${(sim as any).error}`)
    }
    return (sim as any).results?.[0]?.retval as xdr.ScVal
  }

  private fieldVal(m: xdr.ScMapEntry[], name: string): xdr.ScVal | undefined {
    return m.find((e) => e.key().sym() === name)?.val()
  }

  private i128Val(v: xdr.ScVal | undefined): bigint {
    if (!v) return 0n
    const parts = v.i128()
    return parts ? BigInt(parts.lo().toString()) : 0n
  }

  async createDeposit(params: CreateDepositParams): Promise<string> {
    return this.buildTx(
      "createDeposit",
      address(params.account),
      address(params.glvAddress),
      i128(params.depositAmount),
    )
  }

  async createWithdrawal(params: CreateWithdrawalParams): Promise<string> {
    return this.buildTx(
      "createWithdrawal",
      address(params.account),
      address(params.glvAddress),
      i128(params.withdrawalAmount),
    )
  }

  async getGlvInfo(glvAddress: string): Promise<GlvInfo> {
    const ret = await this.simulateTx("getGlvInfo", address(glvAddress))
    const m = ret.map() ?? []
    return {
      glvAddress: this.fieldVal(m, "glv_address")?.str() ?? glvAddress,
      totalDeposits: this.i128Val(this.fieldVal(m, "total_deposits")),
      totalShares: this.i128Val(this.fieldVal(m, "total_shares")),
      sharePrice: this.i128Val(this.fieldVal(m, "share_price")),
      lastUpdatedAt: this.i128Val(this.fieldVal(m, "last_updated_at")),
    }
  }
}
