//! Tests for the TokenBridge contract.

#![cfg(test)]

use soroban_sdk::{
    testutils::Address as _,
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

use crate::{
    test_fee_token::{FeeOnTransferToken, FeeOnTransferTokenClient},
    TokenBridgeContract, TokenBridgeContractClient, TokenBridgeError,
};

fn setup_fee_token() -> (
    Env,
    TokenBridgeContractClient<'static>,
    Address, // admin
    FeeOnTransferTokenClient<'static>,
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let fee_token_id = env.register_contract(None, FeeOnTransferToken);
    let fee_token = FeeOnTransferTokenClient::new(&env, &fee_token_id);

    let contract_id = env.register_contract(None, TokenBridgeContract);
    let client = TokenBridgeContractClient::new(&env, &contract_id);
    client.initialize(&admin, &fee_token_id);

    (env, client, admin, fee_token)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup() -> (
    Env,
    TokenBridgeContractClient<'static>,
    Address, // admin
    Address, // underlying token address
    Address, // token_admin
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    let contract_id = env.register_contract(None, TokenBridgeContract);
    let client = TokenBridgeContractClient::new(&env, &contract_id);

    (env, client, admin, token, token_admin)
}

fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let (env, client, admin, token, _token_admin) = setup();
    client.initialize(&admin, &token);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_underlying_token(), token);
}

#[test]
fn test_initialize_already_initialized() {
    let (env, client, admin, token, _token_admin) = setup();
    client.initialize(&admin, &token);

    let result = client.try_initialize(&admin, &token);
    assert_eq!(result, Err(Ok(TokenBridgeError::AlreadyInitialized)));
}

#[test]
fn test_wrap_credits_balance() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 1_000);

    let new_bal = client.wrap(&user, &600i128);
    assert_eq!(new_bal, 600);
    assert_eq!(client.get_wrapped_balance(&user), 600);

    // Underlying token should now be in the bridge contract.
    let bridge_id = client.address.clone();
    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&bridge_id), 600);
    assert_eq!(token_client.balance(&user), 400);
}

#[test]
fn test_wrap_invalid_amount() {
    let (env, client, admin, token, _token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    let result = client.try_wrap(&user, &0i128);
    assert_eq!(result, Err(Ok(TokenBridgeError::InvalidAmount)));
}

#[test]
fn test_unwrap_returns_underlying() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 1_000);

    client.wrap(&user, &1_000i128);
    assert_eq!(client.get_wrapped_balance(&user), 1_000);

    let remaining_wrapped = client.unwrap(&user, &400i128);
    assert_eq!(remaining_wrapped, 600);
    assert_eq!(client.get_wrapped_balance(&user), 600);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&user), 400);
}

#[test]
fn test_unwrap_insufficient_balance() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 100);
    client.wrap(&user, &100i128);

    let result = client.try_unwrap(&user, &200i128);
    assert_eq!(result, Err(Ok(TokenBridgeError::InsufficientWrappedBalance)));
}

#[test]
fn test_unwrap_invalid_amount() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 100);
    client.wrap(&user, &100i128);

    let result = client.try_unwrap(&user, &0i128);
    assert_eq!(result, Err(Ok(TokenBridgeError::InvalidAmount)));
}

#[test]
fn test_wrap_and_unwrap_full_cycle() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 5_000);

    // Wrap all.
    client.wrap(&user, &5_000i128);
    assert_eq!(client.get_wrapped_balance(&user), 5_000);

    // Partially unwrap.
    client.unwrap(&user, &2_000i128);
    assert_eq!(client.get_wrapped_balance(&user), 3_000);

    // Unwrap remainder.
    client.unwrap(&user, &3_000i128);
    assert_eq!(client.get_wrapped_balance(&user), 0);

    // All underlying tokens returned.
    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&user), 5_000);
}

#[test]
fn test_multiple_users_isolated_balances() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);

    mint(&env, &token, &token_admin, &alice, 1_000);
    mint(&env, &token, &token_admin, &bob, 2_000);

    client.wrap(&alice, &1_000i128);
    client.wrap(&bob, &2_000i128);

    assert_eq!(client.get_wrapped_balance(&alice), 1_000);
    assert_eq!(client.get_wrapped_balance(&bob), 2_000);

    client.unwrap(&alice, &1_000i128);
    assert_eq!(client.get_wrapped_balance(&alice), 0);
    // Bob's balance untouched.
    assert_eq!(client.get_wrapped_balance(&bob), 2_000);
}

#[test]
fn test_not_initialized_errors() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, TokenBridgeContract);
    let client = TokenBridgeContractClient::new(&env, &contract_id);

    let user = Address::generate(&env);
    let result = client.try_wrap(&user, &100i128);
    assert_eq!(result, Err(Ok(TokenBridgeError::NotInitialized)));
}

// ---------------------------------------------------------------------------
// Fee-on-transfer underlying token (#54)
// ---------------------------------------------------------------------------

#[test]
fn test_wrap_rejects_fee_on_transfer_underlying_shortfall() {
    let (env, client, _admin, fee_token) = setup_fee_token();

    let user = Address::generate(&env);
    fee_token.mint(&user, &1_000);

    // FeeOnTransferToken deducts 10%, so the contract only actually
    // receives 900 of the requested 1_000 — must be rejected, not
    // silently credited as if the full amount arrived.
    let result = client.try_wrap(&user, &1_000i128);
    assert_eq!(
        result,
        Err(Ok(TokenBridgeError::UnderlyingTransferShortfall))
    );
}
