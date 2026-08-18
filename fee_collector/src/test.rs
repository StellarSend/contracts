//! Tests for the FeeCollector contract.

#![cfg(test)]

use soroban_sdk::{
    testutils::{Address as _, Ledger as _, storage::Persistent as _},
    token::{Client as TokenClient, StellarAssetClient},
    Address, Env,
};

use crate::{FeeCollectorContract, FeeCollectorContractClient, FeeCollectorError};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn setup() -> (
    Env,
    FeeCollectorContractClient<'static>,
    Address, // admin
    Address, // treasury
    Address, // token
    Address, // token_admin
) {
    let env = Env::default();
    env.mock_all_auths();

    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);

    let contract_id = env.register_contract(None, FeeCollectorContract);
    let client = FeeCollectorContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    (env, client, admin, treasury, token, token_admin)
}

fn mint(env: &Env, token: &Address, admin: &Address, to: &Address, amount: i128) {
    StellarAssetClient::new(env, token).mint(to, &amount);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn test_initialize() {
    let (env, client, admin, treasury, _token, _token_admin) = setup();
    client.initialize(&admin, &treasury);

    assert_eq!(client.get_admin(), admin);
    assert_eq!(client.get_treasury(), treasury);
}

#[test]
fn test_initialize_already_initialized() {
    let (env, client, admin, treasury, _token, _token_admin) = setup();
    client.initialize(&admin, &treasury);

    let result = client.try_initialize(&admin, &treasury);
    assert_eq!(result, Err(Ok(FeeCollectorError::AlreadyInitialized)));
}

#[test]
fn test_collect_fee_updates_total() {
    let (env, client, admin, treasury, token, token_admin) = setup();
    client.initialize(&admin, &treasury);

    let contract_id = client.address.clone();
    // Simulate StellarSend depositing the fee.
    mint(&env, &token, &token_admin, &contract_id, 100);

    client.collect_fee(&token, &100i128);
    assert_eq!(client.get_total_collected(&token), 100);

    mint(&env, &token, &token_admin, &contract_id, 50);
    client.collect_fee(&token, &50i128);
    assert_eq!(client.get_total_collected(&token), 150);
}

#[test]
fn test_get_balance_reflects_token_balance() {
    let (env, client, admin, treasury, token, token_admin) = setup();
    client.initialize(&admin, &treasury);

    let contract_id = client.address.clone();
    mint(&env, &token, &token_admin, &contract_id, 500);

    assert_eq!(client.get_balance(&token), 500);
}

#[test]
fn test_withdraw_sends_tokens_to_recipient() {
    let (env, client, admin, treasury, token, token_admin) = setup();
    client.initialize(&admin, &treasury);

    let contract_id = client.address.clone();
    mint(&env, &token, &token_admin, &contract_id, 300);
    client.collect_fee(&token, &300i128);

    let recipient = Address::generate(&env);
    client.withdraw(&token, &200i128, &recipient);

    let token_client = TokenClient::new(&env, &token);
    assert_eq!(token_client.balance(&recipient), 200);
    assert_eq!(token_client.balance(&contract_id), 100);
}

#[test]
fn test_withdraw_invalid_amount() {
    let (env, client, admin, treasury, token, _token_admin) = setup();
    client.initialize(&admin, &treasury);

    let recipient = Address::generate(&env);
    let result = client.try_withdraw(&token, &0i128, &recipient);
    assert_eq!(result, Err(Ok(FeeCollectorError::InvalidAmount)));
}

#[test]
fn test_collect_fee_invalid_amount() {
    let (env, client, admin, treasury, token, _token_admin) = setup();
    client.initialize(&admin, &treasury);

    let result = client.try_collect_fee(&token, &0i128);
    assert_eq!(result, Err(Ok(FeeCollectorError::InvalidAmount)));
}

#[test]
fn test_set_treasury() {
    let (env, client, admin, treasury, _token, _token_admin) = setup();
    client.initialize(&admin, &treasury);

    let new_treasury = Address::generate(&env);
    client.set_treasury(&new_treasury);
    assert_eq!(client.get_treasury(), new_treasury);
}

#[test]
fn test_get_total_collected_starts_at_zero() {
    let (env, client, admin, treasury, token, _token_admin) = setup();
    client.initialize(&admin, &treasury);
    assert_eq!(client.get_total_collected(&token), 0);
}

#[test]
fn test_not_initialized_errors() {
    let env = Env::default();
    env.mock_all_auths();

    let contract_id = env.register_contract(None, FeeCollectorContract);
    let client = FeeCollectorContractClient::new(&env, &contract_id);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    let result = client.try_collect_fee(&token, &10i128);
    assert_eq!(result, Err(Ok(FeeCollectorError::NotInitialized)));
}

// ---------------------------------------------------------------------------
// TTL tests
// ---------------------------------------------------------------------------

/// Demonstrates that `collect_fee` extends the TTL of the `(KEY_TOTAL,
/// token)` persistent entry on every write, so the running total remains
/// readable — via both `get_total_collected` and `get_total_collected_opt` —
/// after enough ledgers have elapsed that the entry would have gone stale
/// without the TTL-extension fix.
///
/// Strategy
/// ────────
/// Rather than relying on an archived-entry error to prove the fix works
/// (which in soroban-sdk v21 also archives the contract instance, making
/// further calls impossible), this test uses `get_ttl` directly to verify
/// that the entry's TTL was extended to `TOTAL_TTL_TARGET` by `collect_fee`,
/// not just to the bare `min_persistent_entry_ttl`.
///
/// Steps:
/// 1. Set `min_persistent_entry_ttl = 5_000` and a large `max_entry_ttl`.
///    New persistent entries (including KEY_TOTAL) start at TTL = 4_999.
/// 2. Call `collect_fee` to write the entry; the `extend_ttl` inside it
///    should bump the TTL up to `TOTAL_TTL_TARGET` (2_073_600).
/// 3. Verify via `env.as_contract` + `get_ttl` that the TTL equals
///    `TOTAL_TTL_TARGET`, not 4_999 — direct proof the extension ran.
/// 4. Advance the ledger by `ADVANCE` ledgers; confirm via `as_contract`
///    that the TTL decayed by exactly `ADVANCE` and is still above
///    `TOTAL_TTL_THRESHOLD` — the entry is alive and well past what
///    the un-extended TTL would have been.
/// 5. Verify the public API (`get_total_collected` + `get_total_collected_opt`)
///    also returns the correct value, confirming end-to-end correctness.
#[test]
fn test_total_collected_ttl_extended_across_ledgers() {
    use crate::{KEY_TOTAL, TOTAL_TTL_TARGET, TOTAL_TTL_THRESHOLD};

    // ── Environment setup ────────────────────────────────────────────────
    // A moderate min_persistent_entry_ttl chosen so that it's clearly
    // distinct from TOTAL_TTL_TARGET: without extend_ttl entries would have
    // a TTL of INITIAL_TTL_SETTING - 1 = 4_999; our fix sets it to
    // TOTAL_TTL_TARGET = 2_073_600.
    const INITIAL_TTL_SETTING: u32 = 5_000;
    // Ledger advance: enough to decay past INITIAL_TTL_SETTING and
    // prove the entry is alive purely because of extend_ttl.
    const ADVANCE: u32 = 10_000; // > INITIAL_TTL_SETTING, << TOTAL_TTL_TARGET

    let env = Env::default();
    env.mock_all_auths();

    env.ledger().with_mut(|li| {
        li.sequence_number = 100_000;
        li.min_persistent_entry_ttl = INITIAL_TTL_SETTING;
        // max_entry_ttl must accommodate TOTAL_TTL_TARGET (2_073_600).
        li.max_entry_ttl = 3_000_000;
    });

    // ── Contract + token setup ───────────────────────────────────────────
    let admin = Address::generate(&env);
    let treasury = Address::generate(&env);
    let contract_id = env.register_contract(None, FeeCollectorContract);
    let client = FeeCollectorContractClient::new(&env, &contract_id);
    client.initialize(&admin, &treasury);

    let token_admin = Address::generate(&env);
    let token_id = env.register_stellar_asset_contract_v2(token_admin.clone());
    let token = token_id.address();

    // ── Step 1: collect fee and verify TTL was set to TOTAL_TTL_TARGET ───
    mint(&env, &token, &token_admin, &client.address, 1_000);
    client.collect_fee(&token, &1_000i128);

    // Public API sanity check.
    assert_eq!(client.get_total_collected(&token), 1_000);
    assert_eq!(client.get_total_collected_opt(&token), Some(1_000i128));

    // The critical assertion: the TTL must equal TOTAL_TTL_TARGET, not the
    // bare `min_persistent_entry_ttl - 1 = 4_999`. If extend_ttl wasn't
    // called, this would be 4_999.
    let total_key = (KEY_TOTAL, token.clone());
    env.as_contract(&contract_id, || {
        let ttl = env.storage().persistent().get_ttl(&total_key);
        assert_eq!(
            ttl,
            TOTAL_TTL_TARGET,
            "TTL immediately after collect_fee must be TOTAL_TTL_TARGET \
             ({TOTAL_TTL_TARGET}), not bare min_persistent_entry_ttl - 1 \
             ({} - 1). Got: {ttl}",
            INITIAL_TTL_SETTING,
        );
    });

    // Also extend the instance's TTL so it survives the ledger advance
    // below (the instance is a separate persistent entry that collect_fee
    // doesn't touch; we extend it here so the contract remains callable
    // after we advance the ledger).
    env.as_contract(&contract_id, || {
        env.storage()
            .instance()
            .extend_ttl(INITIAL_TTL_SETTING, ADVANCE * 2);
    });

    // ── Step 2: advance the ledger past the un-extended TTL ──────────────
    // Without extend_ttl the KEY_TOTAL entry would have TTL = 4_999 and
    // would be archived after 5_000 ledgers. We advance by ADVANCE = 10_000,
    // which is well past that. The entry must still be alive.
    env.ledger().with_mut(|li| {
        li.sequence_number = 100_000 + ADVANCE;
    });

    // ── Step 3: verify the entry is still alive with a decayed TTL ───────
    env.as_contract(&contract_id, || {
        // Entry must be present and hold the correct value.
        let stored: Option<i128> = env.storage().persistent().get(&total_key);
        assert_eq!(
            stored,
            Some(1_000i128),
            "KEY_TOTAL entry must still be Some(1000) after {ADVANCE} ledgers; \
             without the extend_ttl fix it would have been archived after \
             {} ledgers",
            INITIAL_TTL_SETTING,
        );

        // Remaining TTL must have decayed by exactly ADVANCE, and must
        // still be far above TOTAL_TTL_THRESHOLD.
        let expected_ttl = TOTAL_TTL_TARGET - ADVANCE;
        let ttl_after = env.storage().persistent().get_ttl(&total_key);
        assert_eq!(
            ttl_after,
            expected_ttl,
            "TTL after {ADVANCE} ledgers must be TOTAL_TTL_TARGET - ADVANCE \
             ({TOTAL_TTL_TARGET} - {ADVANCE} = {expected_ttl}). Got: {ttl_after}",
        );
        assert!(
            ttl_after > TOTAL_TTL_THRESHOLD,
            "remaining TTL ({ttl_after}) must still exceed TOTAL_TTL_THRESHOLD \
             ({TOTAL_TTL_THRESHOLD})",
        );
    });

    // ── Step 4: public API still works after the advance ─────────────────
    assert_eq!(
        client.get_total_collected(&token),
        1_000,
        "get_total_collected must return 1000, not 0, after {ADVANCE} ledgers",
    );
    assert_eq!(
        client.get_total_collected_opt(&token),
        Some(1_000i128),
        "get_total_collected_opt must return Some(1000), not None, \
         after {ADVANCE} ledgers",
    );

    // ── Step 5: second collect_fee accumulates and re-extends the TTL ────
    mint(&env, &token, &token_admin, &client.address, 500);
    client.collect_fee(&token, &500i128);
    assert_eq!(client.get_total_collected(&token), 1_500);
    assert_eq!(client.get_total_collected_opt(&token), Some(1_500i128));
}
