#!/usr/bin/env bash
# Deploys the StellarSend contract system through the `factory` contract.
#
# `factory` deploys and initializes each of `fee_collector`, `token_bridge`,
# and `stellar_send` atomically within a single host invocation, so there is
# no ledger state where a deployed-but-uninitialized instance is observable
# and front-runnable (#58). Do not deploy these three contracts any other
# way — a raw `stellar contract deploy` followed by a separate `initialize`
# call is exactly the race #58 describes.
#
# Usage:
#   export STELLAR_NETWORK=testnet
#   export STELLAR_RPC_URL=https://soroban-testnet.stellar.org
#   export STELLAR_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
#   export STELLAR_ACCOUNT=<your source identity/secret key>
#   bash scripts/deploy.sh [treasury_address] [underlying_token_address]
#
# `treasury_address` and `underlying_token_address` default to
# STELLAR_ACCOUNT's own address if not given, matching a simple single-key
# testnet setup; pass real addresses for anything beyond local testing.

set -euo pipefail

: "${STELLAR_NETWORK:?Set STELLAR_NETWORK (testnet|mainnet)}"
: "${STELLAR_RPC_URL:?Set STELLAR_RPC_URL}"
: "${STELLAR_NETWORK_PASSPHRASE:?Set STELLAR_NETWORK_PASSPHRASE}"
: "${STELLAR_ACCOUNT:?Set STELLAR_ACCOUNT to your deploying identity}"

ADMIN_ADDRESS="$(stellar keys address "$STELLAR_ACCOUNT")"
TREASURY_ADDRESS="${1:-$ADMIN_ADDRESS}"
UNDERLYING_TOKEN_ADDRESS="${2:-$ADMIN_ADDRESS}"

invoke() {
  stellar contract invoke \
    --source-account "$STELLAR_ACCOUNT" \
    --network "$STELLAR_NETWORK" \
    --id "$1" \
    -- "${@:2}"
}

echo "Building contracts..."
stellar contract build --package factory
stellar contract build --package fee_collector
stellar contract build --package token_bridge
stellar contract build --package stellar_send

WASM_DIR="target/wasm32v1-none/release"

echo "Uploading Wasm hashes..."
FEE_COLLECTOR_HASH="$(stellar contract upload --source-account "$STELLAR_ACCOUNT" --network "$STELLAR_NETWORK" --wasm "$WASM_DIR/fee_collector.wasm")"
TOKEN_BRIDGE_HASH="$(stellar contract upload --source-account "$STELLAR_ACCOUNT" --network "$STELLAR_NETWORK" --wasm "$WASM_DIR/token_bridge.wasm")"
STELLAR_SEND_HASH="$(stellar contract upload --source-account "$STELLAR_ACCOUNT" --network "$STELLAR_NETWORK" --wasm "$WASM_DIR/stellar_send.wasm")"

# Deploying and initializing the factory itself is still two separate
# top-level steps, unlike the three contracts it deploys — see factory's
# module doc comment for why that residual window is narrower and accepted.
echo "Deploying and initializing factory..."
FACTORY_ID="$(stellar contract deploy --source-account "$STELLAR_ACCOUNT" --network "$STELLAR_NETWORK" --wasm "$WASM_DIR/factory.wasm")"
invoke "$FACTORY_ID" initialize --admin "$ADMIN_ADDRESS"

echo "Deploying fee_collector via factory (atomic deploy + init)..."
FEE_COLLECTOR_ID="$(invoke "$FACTORY_ID" deploy_fee_collector \
  --salt 0000000000000000000000000000000000000000000000000000000000000001 \
  --wasm_hash "$FEE_COLLECTOR_HASH" \
  --contract_admin "$ADMIN_ADDRESS" \
  --treasury "$TREASURY_ADDRESS")"

echo "Deploying token_bridge via factory (atomic deploy + init)..."
TOKEN_BRIDGE_ID="$(invoke "$FACTORY_ID" deploy_token_bridge \
  --salt 0000000000000000000000000000000000000000000000000000000000000002 \
  --wasm_hash "$TOKEN_BRIDGE_HASH" \
  --contract_admin "$ADMIN_ADDRESS" \
  --underlying_token "$UNDERLYING_TOKEN_ADDRESS")"

echo "Deploying stellar_send via factory (atomic deploy + init)..."
STELLAR_SEND_ID="$(invoke "$FACTORY_ID" deploy_stellar_send \
  --salt 0000000000000000000000000000000000000000000000000000000000000003 \
  --wasm_hash "$STELLAR_SEND_HASH" \
  --contract_admin "$ADMIN_ADDRESS" \
  --fee_bps 100 \
  --fee_collector "$FEE_COLLECTOR_ID")"

echo
echo "Deployment complete:"
echo "  factory:        $FACTORY_ID"
echo "  fee_collector:  $FEE_COLLECTOR_ID"
echo "  token_bridge:   $TOKEN_BRIDGE_ID"
echo "  stellar_send:   $STELLAR_SEND_ID"
