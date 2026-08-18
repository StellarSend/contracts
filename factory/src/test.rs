//! Tests for the Factory contract.
//!
//! The atomic-deploy tests exercise the real `fee_collector`/`token_bridge`/
//! `stellar_send` Wasm (imported below via `contractimport!`), not a stub —
//! proving the actual cross-contract `initialize` call this factory relies
//! on for #58's fix. Build them first:
//!
//! ```bash
//! stellar contract build --package fee_collector
//! stellar contract build --package token_bridge
//! stellar contract build --package stellar_send
//! ```
//!
//! then `cargo test -p factory`. (Plain `cargo build --target
//! wasm32-unknown-unknown` also produces a `.wasm`, but the raw
//! `call_indirect` encoding modern Rust toolchains emit for that target
//! isn't accepted by this workspace's pinned `soroban-env-host` version's
//! Wasm validator — `stellar contract build`'s `wasm32v1-none` target and
//! post-processing avoid this. Use it for any Wasm this workspace's test
//! suite or deploy tooling needs to load.)

#![cfg(test)]

use soroban_sdk::{testutils::Address as _, Address, BytesN, Env};

use crate::{Factory, FactoryClient, FactoryError};

mod fee_collector_wasm {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/fee_collector.wasm");
}
mod token_bridge_wasm {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/token_bridge.wasm");
}
mod stellar_send_wasm {
    soroban_sdk::contractimport!(file = "../target/wasm32v1-none/release/stellar_send.wasm");
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup() -> (Env, FactoryClient<'static>, Address) {
    let env = Env::default();
    // Plain `mock_all_auths` only authorizes an address if `require_auth`
    // for it appears in the *root* invocation. Here `contract_admin.
    // require_auth()` runs inside the deployed child's `initialize`, one
    // level below `deploy_fee_collector`'s own root call — a "non-root"
    // authorization the plain mock rejects even though it's exactly the
    // legitimate shape every `deploy_*` call has.
    env.mock_all_auths_allowing_non_root_auth();

    let admin = Address::generate(&env);
    let factory_id = env.register_contract(None, Factory);
    let client = FactoryClient::new(&env, &factory_id);
    client.initialize(&admin);

    (env, client, admin)
}

fn salt(env: &Env, tag: u8) -> BytesN<32> {
    let mut bytes = [0u8; 32];
    bytes[31] = tag;
    BytesN::from_array(env, &bytes)
}

// ---------------------------------------------------------------------------
// Factory lifecycle
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let (_, client, admin) = setup();
    assert_eq!(client.get_admin(), admin);
}

#[test]
fn test_initialize_already_initialized() {
    let (_, client, admin) = setup();
    let result = client.try_initialize(&admin);
    assert_eq!(result, Err(Ok(FactoryError::AlreadyInitialized)));
}

#[test]
fn test_deploy_without_admin_auth_rejected() {
    // Mirrors this workspace's existing convention (see
    // stellar_send::test::test_unauthorized_send_rejected) for testing a
    // require_auth() guard: mock no auths at all, so the stored factory
    // admin's authorization can never be satisfied.
    let (env, client, admin) = setup();
    env.mock_auths(&[]);

    let wasm_hash = env
        .deployer()
        .upload_contract_wasm(fee_collector_wasm::WASM);
    let treasury = Address::generate(&env);

    let result = client.try_deploy_fee_collector(&salt(&env, 1), &wasm_hash, &admin, &treasury);
    assert!(
        result.is_err(),
        "deploy_fee_collector must fail without the factory admin's authorization"
    );
}

// ---------------------------------------------------------------------------
// fee_collector — atomic deploy + init (#58)
// ---------------------------------------------------------------------------

#[test]
fn test_deploy_fee_collector_is_already_initialized() {
    let (env, client, _factory_admin) = setup();
    let wasm_hash = env
        .deployer()
        .upload_contract_wasm(fee_collector_wasm::WASM);

    let contract_admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let address =
        client.deploy_fee_collector(&salt(&env, 1), &wasm_hash, &contract_admin, &treasury);

    let fc_client = fee_collector_wasm::Client::new(&env, &address);
    assert_eq!(fc_client.get_admin(), contract_admin);
    assert_eq!(fc_client.get_treasury(), treasury);
}

#[test]
fn test_deploy_fee_collector_cannot_be_reinitialized() {
    // The structural, no-front-run-window guarantee: a second initialize
    // call against the factory-deployed address — attempted by anyone,
    // authorized or not, since mock_all_auths() is still in effect here —
    // fails, proving the factory's own call already consumed the one
    // legitimate initialize slot atomically with the deploy.
    let (env, client, _factory_admin) = setup();
    let wasm_hash = env
        .deployer()
        .upload_contract_wasm(fee_collector_wasm::WASM);

    let contract_admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let address =
        client.deploy_fee_collector(&salt(&env, 1), &wasm_hash, &contract_admin, &treasury);

    let attacker = Address::generate(&env);
    let fc_client = fee_collector_wasm::Client::new(&env, &address);
    let result = fc_client.try_initialize(&attacker, &attacker);
    assert!(
        result.is_err(),
        "initialize must reject a second call regardless of caller, since the \
         factory's atomic deploy already initialized this address"
    );
}

// ---------------------------------------------------------------------------
// token_bridge — atomic deploy + init (#58)
// ---------------------------------------------------------------------------

#[test]
fn test_deploy_token_bridge_is_already_initialized() {
    let (env, client, _factory_admin) = setup();
    let wasm_hash = env.deployer().upload_contract_wasm(token_bridge_wasm::WASM);

    let contract_admin = Address::generate(&env);
    let underlying_token = Address::generate(&env);

    let address = client.deploy_token_bridge(
        &salt(&env, 2),
        &wasm_hash,
        &contract_admin,
        &underlying_token,
    );

    let attacker = Address::generate(&env);
    let tb_client = token_bridge_wasm::Client::new(&env, &address);
    let result = tb_client.try_initialize(&attacker, &attacker);
    assert!(
        result.is_err(),
        "token_bridge initialize must reject a second call after the factory's atomic deploy"
    );
}

// ---------------------------------------------------------------------------
// stellar_send — atomic deploy + init (#58)
// ---------------------------------------------------------------------------

#[test]
fn test_deploy_stellar_send_is_already_initialized() {
    let (env, client, _factory_admin) = setup();
    let fc_wasm_hash = env
        .deployer()
        .upload_contract_wasm(fee_collector_wasm::WASM);
    let ss_wasm_hash = env.deployer().upload_contract_wasm(stellar_send_wasm::WASM);

    let contract_admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let fee_collector_address =
        client.deploy_fee_collector(&salt(&env, 3), &fc_wasm_hash, &contract_admin, &treasury);

    let address = client.deploy_stellar_send(
        &salt(&env, 4),
        &ss_wasm_hash,
        &contract_admin,
        &100u32,
        &fee_collector_address,
    );

    let attacker = Address::generate(&env);
    let ss_client = stellar_send_wasm::Client::new(&env, &address);
    let result = ss_client.try_initialize(&attacker, &100u32, &fee_collector_address);
    assert!(
        result.is_err(),
        "stellar_send initialize must reject a second call after the factory's atomic deploy"
    );
}
