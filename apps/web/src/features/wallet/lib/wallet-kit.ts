import { StellarWalletsKit } from "@creit.tech/stellar-wallets-kit/sdk"
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils"
import { Networks } from "@creit.tech/stellar-wallets-kit/types"
import { NETWORK } from "@/app/config/network"

const kitNetwork =
  NETWORK.name === "mainnet" ? Networks.PUBLIC : Networks.TESTNET

StellarWalletsKit.init({
  modules: defaultModules(),
  network: kitNetwork,
})
