//! # Factory Contract
//!
//! Deploys and initializes `fee_collector`, `token_bridge`, and
//! `stellar_send` instances **atomically**, closing the front-runnable
//! `initialize()` window described in #58.
//!
//! ## The problem this solves
//!
//! On Soroban, deploying a contract's Wasm and calling its `initialize`
//! function are two independently-authorized steps. Between them, the new
//! contract's address is public and its code is already live and callable —
//! including its `initialize` function, whose only guard is "has this
//! already been called," not "is the caller the legitimate deployer."
//! Anyone watching the ledger for the deploy can race the real deployer's
//! own follow-up `initialize` call and permanently seize `admin`.
//!
//! The pinned `soroban-sdk` version (21.7.7) has neither `__constructor`
//! support nor any API for a contract to learn who deployed it — both were
//! ruled out after checking `soroban-sdk`'s actual source for this version
//! (see `deploy.rs`/`env.rs`: `Deployer` exposes only `deploy(wasm_hash)`,
//! and there is no `caller()`/`invoker()` accessor). So `fee_collector`,
//! `token_bridge`, and `stellar_send`'s own `initialize` functions cannot be
//! made to verify their caller — there is nothing in this SDK version for
//! them to check that against.
//!
//! ## The fix
//!
//! This factory deploys a child contract with
//! [`Deployer::with_current_contract`], which derives the child's address
//! from *this* factory contract's own address — no separate address needs to
//! authorize the deployment. It then immediately calls the child's
//! `initialize` via `env.invoke_contract` in the very same host invocation.
//! Because Soroban executes an entire invocation (including nested
//! cross-contract calls) as a single atomic unit, there is no point at which
//! an external actor can observe a deployed-but-uninitialized instance and
//! inject a competing call — the address has no code at all until the
//! moment this function deploys it, and it is already initialized by the
//! time this function returns. The race window is closed structurally, not
//! by a permission check.
//!
//! ## Residual scope
//!
//! `fee_collector::initialize`, `token_bridge::initialize`, and
//! `stellar_send::initialize` remain directly callable — the SDK gives them
//! no way to refuse it. An instance deployed *outside* this factory (a raw
//! `soroban contract deploy` followed by a separate `initialize` call) is
//! **not** protected and must not be treated as production-safe; see each
//! contract's own module doc comment. `scripts/deploy.sh` and this
//! workspace's README deployment walkthrough have been updated to go
//! through this factory exclusively.
//!
//! This factory's own `initialize` has the identical residual limitation as
//! any of the three contracts before this fix — it is unrecoverably
//! front-runnable in isolation. Its blast radius is narrower than the
//! original issue, though: winning that race only lets an attacker trigger
//! *future* deployments through a factory instance nobody will actually
//! point real funds at, rather than seizing control of an already-deployed,
//! already-in-use system contract. Deploying and initializing the factory
//! itself should still happen as the first, immediately-verified step of any
//! deployment run.

#![no_std]

use soroban_sdk::{
    contract, contractimpl, symbol_short, vec, Address, BytesN, Env, IntoVal, Symbol, Val,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_ADMIN: Symbol = symbol_short!("ADMIN");
const KEY_INIT: Symbol = symbol_short!("INIT");

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

#[soroban_sdk::contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum FactoryError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct Factory;

#[contractimpl]
impl Factory {
    // -----------------------------------------------------------------------
    // Lifecycle
    // -----------------------------------------------------------------------

    /// Initialize the factory. `admin` authorizes every `deploy_*` call.
    ///
    /// Like every contract in this workspace, this function itself is not
    /// caller-restricted (see the module doc comment) — deploy and
    /// initialize the factory as one immediately-verified operational step.
    pub fn initialize(env: Env, admin: Address) -> Result<(), FactoryError> {
        if env.storage().instance().has(&KEY_INIT) {
            return Err(FactoryError::AlreadyInitialized);
        }
        admin.require_auth();

        env.storage().instance().set(&KEY_ADMIN, &admin);
        env.storage().instance().set(&KEY_INIT, &true);
        Ok(())
    }

    /// Return the factory admin.
    pub fn get_admin(env: Env) -> Result<Address, FactoryError> {
        Self::assert_initialized(&env)?;
        env.storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(FactoryError::NotInitialized)
    }

    // -----------------------------------------------------------------------
    // Atomic deploy + initialize
    // -----------------------------------------------------------------------

    /// Deploy and atomically initialize a `fee_collector` instance.
    ///
    /// `contract_admin`/`treasury` are forwarded to `fee_collector::initialize`
    /// unchanged; they need not equal this factory's own `admin`.
    pub fn deploy_fee_collector(
        env: Env,
        salt: BytesN<32>,
        wasm_hash: BytesN<32>,
        contract_admin: Address,
        treasury: Address,
    ) -> Result<Address, FactoryError> {
        let admin = Self::require_factory_admin(&env)?;

        let address = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        let init_args: soroban_sdk::Vec<Val> =
            vec![&env, contract_admin.into_val(&env), treasury.into_val(&env)];
        let _: () = env.invoke_contract(&address, &Symbol::new(&env, "initialize"), init_args);

        env.events().publish(
            (symbol_short!("deployed"), symbol_short!("fee_coll")),
            (admin, address.clone()),
        );
        Ok(address)
    }

    /// Deploy and atomically initialize a `token_bridge` instance.
    pub fn deploy_token_bridge(
        env: Env,
        salt: BytesN<32>,
        wasm_hash: BytesN<32>,
        contract_admin: Address,
        underlying_token: Address,
    ) -> Result<Address, FactoryError> {
        let admin = Self::require_factory_admin(&env)?;

        let address = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        let init_args: soroban_sdk::Vec<Val> = vec![
            &env,
            contract_admin.into_val(&env),
            underlying_token.into_val(&env),
        ];
        let _: () = env.invoke_contract(&address, &Symbol::new(&env, "initialize"), init_args);

        env.events().publish(
            (symbol_short!("deployed"), symbol_short!("tok_bdg")),
            (admin, address.clone()),
        );
        Ok(address)
    }

    /// Deploy and atomically initialize a `stellar_send` instance.
    ///
    /// `fee_collector` must already be a deployed (and, for a production
    /// rollout, factory-deployed) `fee_collector` address, per this
    /// workspace's documented deploy order.
    pub fn deploy_stellar_send(
        env: Env,
        salt: BytesN<32>,
        wasm_hash: BytesN<32>,
        contract_admin: Address,
        fee_bps: u32,
        fee_collector: Address,
    ) -> Result<Address, FactoryError> {
        let admin = Self::require_factory_admin(&env)?;

        let address = env.deployer().with_current_contract(salt).deploy(wasm_hash);

        let init_args: soroban_sdk::Vec<Val> = vec![
            &env,
            contract_admin.into_val(&env),
            fee_bps.into_val(&env),
            fee_collector.into_val(&env),
        ];
        let _: () = env.invoke_contract(&address, &Symbol::new(&env, "initialize"), init_args);

        env.events().publish(
            (symbol_short!("deployed"), symbol_short!("s_send")),
            (admin, address.clone()),
        );
        Ok(address)
    }

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn assert_initialized(env: &Env) -> Result<(), FactoryError> {
        if !env.storage().instance().has(&KEY_INIT) {
            return Err(FactoryError::NotInitialized);
        }
        Ok(())
    }

    /// Load the factory admin and require its authorization for the call in
    /// progress. Shared by every `deploy_*` function so only the factory's
    /// own admin can trigger new deployments through it.
    fn require_factory_admin(env: &Env) -> Result<Address, FactoryError> {
        Self::assert_initialized(env)?;
        let admin: Address = env
            .storage()
            .instance()
            .get(&KEY_ADMIN)
            .ok_or(FactoryError::NotInitialized)?;
        admin.require_auth();
        Ok(admin)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
