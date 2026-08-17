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

#[test]
fn test_rejected_wrap_does_not_credit_wrapped_balance() {
    let (env, client, _admin, fee_token) = setup_fee_token();

    let user = Address::generate(&env);
    fee_token.mint(&user, &1_000);

    let _ = client.try_wrap(&user, &1_000i128);

    // The rejected wrap must not have credited anything, even though the
    // pre-fix bug would have credited the full requested 1_000.
    assert_eq!(client.get_wrapped_balance(&user), 0);
}

#[test]
fn test_rejected_wrap_rolls_back_the_underlying_transfer() {
    let (env, client, _admin, fee_token) = setup_fee_token();

    let user = Address::generate(&env);
    fee_token.mint(&user, &1_000);

    let _ = client.try_wrap(&user, &1_000i128);

    // Result::Err from a contract entry point rolls back the whole
    // invocation atomically in Soroban — the transfer that already ran
    // before the mismatch was detected is reverted along with the
    // rejected credit, so the user doesn't lose the fee-shortfall amount
    // (900) to a contract balance nobody's wrapped-balance ledger
    // accounts for.
    assert_eq!(fee_token.balance(&user), 1_000);
    assert_eq!(fee_token.balance(&client.address), 0);
}

#[test]
fn test_one_users_fee_on_transfer_wrap_cannot_drain_the_pool_for_another_user() {
    // Reproduces the issue's cross-user blast radius, adapted to the
    // "reject outright" policy this fix chose (the issue's requirements
    // explicitly name this as one of two acceptable policies, the other
    // being "credit only the measured amount"). Under reject-outright,
    // the scenario changes shape: instead of user A's wrap silently
    // under-funding the pool and later trapping honest user B's unwrap,
    // A's wrap now fails cleanly up front — so the shared pool for this
    // token can never become funded by anyone, honest or not, and B's
    // wrap of the same misbehaving token fails the exact same way B
    // would have needed A's under-funding to even attempt exploiting.
    // No path exists anymore for one user's fee-on-transfer deposit to
    // leave a shortfall a different, honest user's unwrap could fall
    // into (#54).
    let (env, client, _admin, fee_token) = setup_fee_token();

    let alice = Address::generate(&env);
    let bob = Address::generate(&env);
    fee_token.mint(&alice, &1_000);
    fee_token.mint(&bob, &500);

    // Alice's wrap — pre-fix, this would have silently under-funded the
    // shared pool by 100 (10% of 1_000) while crediting her the full
    // 1_000 in her wrapped-balance ledger.
    let alice_result = client.try_wrap(&alice, &1_000i128);
    assert_eq!(
        alice_result,
        Err(Ok(TokenBridgeError::UnderlyingTransferShortfall))
    );

    // Bob's wrap of the same token — also rejected, for the same reason.
    let bob_result = client.try_wrap(&bob, &500i128);
    assert_eq!(
        bob_result,
        Err(Ok(TokenBridgeError::UnderlyingTransferShortfall))
    );

    // The pool was never funded by either of them.
    assert_eq!(fee_token.balance(&client.address), 0);
    assert_eq!(client.get_wrapped_balance(&alice), 0);
    assert_eq!(client.get_wrapped_balance(&bob), 0);

    // Both users' own tokens are untouched (the rejected transfers rolled
    // back), and any unwrap attempt fails on the caller's own empty
    // ledger entry — a normal, expected InsufficientWrappedBalance, never
    // a trap caused by a pool another user drained.
    assert_eq!(fee_token.balance(&alice), 1_000);
    assert_eq!(fee_token.balance(&bob), 500);
    assert_eq!(
        client.try_unwrap(&bob, &500i128),
        Err(Ok(TokenBridgeError::InsufficientWrappedBalance))
    );
}
