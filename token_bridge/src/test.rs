//! Tests for the TokenBridge contract.

#![cfg(test)]

extern crate std;

use soroban_sdk::{
    testutils::{Address as _, Ledger as _},
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

/// Restore the bridge contract's instance and code entries so the contract
/// stays invokable after large ledger-sequence jumps.
///
/// On the real network an archived instance blocks invocation entirely
/// (operators run a restore operation to bring it back); this mirrors that
/// restore for the test harness only. It deliberately never touches
/// `ContractData` entries, so the WBAL entries under test are left exactly
/// as the contract's own TTL policy left them.
fn restore_bridge_instance(env: &Env, client: &TokenBridgeContractClient) {
    use soroban_sdk::xdr::{ContractDataDurability, LedgerKey, LedgerKeyContractData, ScVal};
    use std::rc::Rc;

    // 4_096 is the test environment's default min_persistent_entry_ttl.
    let budget = env.host().budget_cloned();
    let live_until = env.ledger().sequence() + 4_096 - 1;
    let instance_key = Rc::new(LedgerKey::ContractData(LedgerKeyContractData {
        contract: (&client.address).into(),
        key: ScVal::LedgerKeyContractInstance,
        durability: ContractDataDurability::Persistent,
    }));

    env.host()
        .with_mut_storage(|storage| {
            let mut updates = std::vec::Vec::new();
            for (k, v) in storage.map.iter(&budget)? {
                let restore = k.as_ref() == instance_key.as_ref()
                    || matches!(k.as_ref(), LedgerKey::ContractCode(_));
                if restore {
                    if let Some((entry, _)) = v {
                        updates.push((k.clone(), Some((entry.clone(), Some(live_until)))));
                    }
                }
            }
            for (key, val) in updates {
                storage.map = storage.map.insert(key, val, &budget)?;
            }
            Ok(())
        })
        .unwrap();
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

// ---------------------------------------------------------------------------
// WBAL entry TTL management (dormant-balance archival regression)
//
// In the test environment a freshly written persistent entry lives until
// `ledger_sequence + min_persistent_entry_ttl - 1`, i.e. 4_095 ledgers from
// sequence 0. The tests below walk the ledger up to just before that expiry,
// let the contract refresh the WBAL entry's TTL through its normal read and
// write paths, then jump past the original expiry point — which traps if the
// entry was not refreshed, and returns the correct balance if it was.
// ---------------------------------------------------------------------------

#[test]
fn test_dormant_balance_survives_ttl_window_and_read_refreshes_ttl() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 1_000);

    client.wrap(&user, &600i128);
    assert_eq!(client.get_wrapped_balance(&user), 600);

    // Advance into the last stretch of the WBAL entry's initial lifetime.
    env.ledger().set_sequence_number(env.ledger().sequence() + 4_000);

    // A successful read must refresh the entry's TTL.
    assert_eq!(client.get_wrapped_balance(&user), 600);

    // Jump far past the point where the WBAL entry would have expired had
    // the read above not refreshed it, restore the contract itself into an
    // invokable state as a network operator would, then query again —
    // this must not trap.
    env.ledger().set_sequence_number(env.ledger().sequence() + 10_000);
    restore_bridge_instance(&env, &client);
    assert_eq!(client.get_wrapped_balance(&user), 600);

    // The refreshed read keeps the entry available for later operations too.
    env.ledger().set_sequence_number(env.ledger().sequence() + 100_000);
    restore_bridge_instance(&env, &client);
    assert_eq!(client.get_wrapped_balance(&user), 600);
}

#[test]
fn test_returning_holder_can_wrap_after_ttl_advancement() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 1_000);

    client.wrap(&user, &600i128);

    // Top up near the end of the initial entry lifetime: credit_wrapped
    // re-reads the balance before writing, so both its read and its write
    // must keep the entry alive.
    env.ledger().set_sequence_number(env.ledger().sequence() + 4_000);
    assert_eq!(client.wrap(&user, &100i128), 700);

    // Past the original expiry of the WBAL entry the holder wraps again;
    // this must not trap thanks to the earlier top-up's refresh.
    env.ledger().set_sequence_number(env.ledger().sequence() + 10_000);
    restore_bridge_instance(&env, &client);
    assert_eq!(client.wrap(&user, &100i128), 800);
    assert_eq!(client.get_wrapped_balance(&user), 800);
}

#[test]
fn test_returning_holder_can_unwrap_after_ttl_advancement() {
    let (env, client, admin, token, token_admin) = setup();
    client.initialize(&admin, &token);

    let user = Address::generate(&env);
    mint(&env, &token, &token_admin, &user, 2_000);

    client.wrap(&user, &2_000i128);

    // Unwrap near the end of the initial entry lifetime; the debit path
    // must refresh the entry's TTL after writing the new balance.
    env.ledger().set_sequence_number(env.ledger().sequence() + 4_000);
    assert_eq!(client.unwrap(&user, &500i128), 1_500);

    // Past the original expiry of the WBAL entry the holder unwraps again;
    // this must not trap thanks to the earlier unwrap's refresh.
    env.ledger().set_sequence_number(env.ledger().sequence() + 10_000);
    restore_bridge_instance(&env, &client);
    assert_eq!(client.unwrap(&user, &300i128), 1_200);
    assert_eq!(client.get_wrapped_balance(&user), 1_200);

    // The underlying payouts across both unwraps are correct.
    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&user), 800);
}

#[test]
fn test_get_wrapped_balance_for_unknown_holder_is_zero_without_ttl_extension() {
    let (env, client, admin, token, _token_admin) = setup();
    client.initialize(&admin, &token);

    // No WBAL entry exists for this holder: the default of zero must be
    // returned unchanged, with no extension attempt against a nonexistent
    // entry.
    let stranger = Address::generate(&env);
    assert_eq!(client.get_wrapped_balance(&stranger), 0);

    // Still zero after time passes and the contract is restored into an
    // invokable state — nothing changed semantics for the missing entry.
    env.ledger().set_sequence_number(env.ledger().sequence() + 10_000);
    restore_bridge_instance(&env, &client);
    assert_eq!(client.get_wrapped_balance(&stranger), 0);
}

