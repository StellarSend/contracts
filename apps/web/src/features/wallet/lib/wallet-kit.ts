import {
  StellarWalletsKit,
  WalletNetwork,
  FreighterModule,
} from "@creit.tech/stellar-wallets-kit"
import { NETWORK } from "@/app/config/network"

export const walletKit = new StellarWalletsKit({
  network:
    NETWORK.name === "mainnet" ? WalletNetwork.PUBLIC : WalletNetwork.TESTNET,
  selectedWalletId: "freighter",
  modules: [new FreighterModule()],
})
