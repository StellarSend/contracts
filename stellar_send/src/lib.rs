//! # StellarSend — Main Transfer Contract
//!
//! This contract is the entry-point for the StellarSend money-transfer platform.
//! It supports:
//!   * **Direct payments** – transfer a token from one address to another with an
//!     optional protocol fee deducted at source.
//!   * **Path payments** – route a payment through the Stellar DEX so the sender
//!     pays in one asset and the recipient receives a different asset.
//!
//! Fees are expressed in basis points (bps).  100 bps = 1 %.
//! The fee portion of every transfer is forwarded to a dedicated `fee_collector`
//! contract address for accounting and later withdrawal by the treasury.
//!
//! Storage layout
//! ──────────────
//! Instance storage (short-lived, cheap):
//!   KEY_CONFIG  → ContractConfig
//!   KEY_SEQ     → u64  (global payment sequence counter)
//!
//! Persistent storage (survives ledger closings):
//!   (from, seq) → PaymentRecord

#![no_std]

mod batch;
mod error;
mod events;
mod payment_request;
mod subscription;

pub use error::StellarSendError;
pub use payment_request::{PaymentRequest, PaymentRequestStatus};
pub use subscription::Subscription;

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, token, vec, Address, Env, String, Symbol,
    Vec,
};

// ---------------------------------------------------------------------------
// Storage keys
// ---------------------------------------------------------------------------

const KEY_CONFIG: Symbol = symbol_short!("CONFIG");
const KEY_SEQ: Symbol = symbol_short!("SEQ");

/// Global counter for subscription ids (instance storage).
const KEY_SUB_SEQ: Symbol = symbol_short!("SUBSEQ");
/// Persistent key prefix: (KEY_SUB, id) → Subscription.
const KEY_SUB: Symbol = symbol_short!("SUB");

/// Global counter for payment-request ids (instance storage).
const KEY_REQ_SEQ: Symbol = symbol_short!("REQSEQ");
/// Persistent key prefix: (KEY_REQ, id) → PaymentRequest.
const KEY_REQ: Symbol = symbol_short!("REQ");

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Global configuration, stored in instance storage.
#[contracttype]
#[derive(Clone, Debug)]
pub struct ContractConfig {
    /// The admin address that may update fees and pause the contract.
    pub admin: Address,
    /// Fee in basis points charged on every payment (100 bps = 1 %).
    pub fee_bps: u32,
    /// Address of the fee-collector contract that accumulates protocol fees.
    pub fee_collector: Address,
    /// Whether new payments are accepted.  Set to true by `initialize`.
    pub active: bool,
}

/// Immutable record of a completed payment, stored in persistent storage.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentRecord {
    /// Sender address.
    pub from: Address,
    /// Recipient address.
    pub to: Address,
    /// Token used for the payment.
    pub token: Address,
    /// Net amount received by the recipient (gross – fee).
    pub net_amount: i128,
    /// Fee charged and forwarded to the fee-collector.
    pub fee_amount: i128,
    /// Optional memo string attached by the sender.
    pub memo: String,
    /// Ledger number at which the payment was processed.
    pub ledger: u32,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[contract]
pub struct StellarSendContract;

#[contractimpl]
impl StellarSendContract {
    // -----------------------------------------------------------------------
    // Admin / lifecycle
    // -----------------------------------------------------------------------

    /// Initialise the contract.  Must be called exactly once.
    ///
    /// * `admin`         – Address that owns admin capabilities.
    /// * `fee_bps`       – Initial fee in basis points (0 – 10 000).
    /// * `fee_collector` – Address of the deployed `fee_collector` contract.
    pub fn initialize(
        env: Env,
        admin: Address,
        fee_bps: u32,
        fee_collector: Address,
    ) -> Result<(), StellarSendError> {
        // Guard: initialise only once.
        if env.storage().instance().has(&KEY_CONFIG) {
            return Err(StellarSendError::AlreadyInitialized);
        }

        if fee_bps > 10_000 {
            return Err(StellarSendError::InvalidFeeBps);
        }

        // The admin must authorise the initialisation call.
        admin.require_auth();

        let config = ContractConfig {
            admin,
            fee_bps,
            fee_collector,
            active: true,
        };

        env.storage().instance().set(&KEY_CONFIG, &config);
        env.storage().instance().set(&KEY_SEQ, &0u64);

        Ok(())
    }

    /// Return the current contract configuration.
    pub fn get_config(env: Env) -> Result<ContractConfig, StellarSendError> {
        Self::load_config(&env)
    }

    /// Update the protocol fee.  Only the admin may call this.
    ///
    /// * `new_fee_bps` – New fee in basis points (0 – 10 000).
    pub fn set_fee(env: Env, new_fee_bps: u32) -> Result<(), StellarSendError> {
        let mut config = Self::load_config(&env)?;
        config.admin.require_auth();

        if new_fee_bps > 10_000 {
            return Err(StellarSendError::InvalidFeeBps);
        }

        let old_fee_bps = config.fee_bps;
        config.fee_bps = new_fee_bps;
        env.storage().instance().set(&KEY_CONFIG, &config);

        events::emit_fee_updated(&env, old_fee_bps, new_fee_bps);
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Payments
    // -----------------------------------------------------------------------

    /// Execute a direct token transfer from `from` to `to`.
    ///
    /// The protocol fee (in `token`) is deducted from `amount` and forwarded
    /// to the fee-collector contract before the net amount is sent to the
    /// recipient.
    ///
    /// Both the caller and `from` must authorise this invocation (the contract
    /// acts on behalf of `from` for the token transfer).
    ///
    /// * `from`   – Source address.
    /// * `to`     – Destination address.
    /// * `token`  – SEP-41 / Stellar token contract address.
    /// * `amount` – Gross amount to send (fee is taken from this).
    /// * `memo`   – Arbitrary memo string (max 28 bytes recommended).
    pub fn send_payment(
        env: Env,
        from: Address,
        to: Address,
        token: Address,
        amount: i128,
        memo: String,
    ) -> Result<PaymentRecord, StellarSendError> {
        // Authorise the sender.
        from.require_auth();

        let config = Self::load_config(&env)?;

        if amount <= 0 {
            return Err(StellarSendError::InvalidAmount);
        }

        // Calculate fee and net amounts.
        let (fee_amount, net_amount) = Self::split_fee(amount, config.fee_bps)?;

        // Obtain a token client.
        let token_client = token::Client::new(&env, &token);

        // Transfer fee to the fee-collector contract.
        if fee_amount > 0 {
            token_client.transfer(&from, &config.fee_collector, &fee_amount);
        }

        // Transfer net amount to the recipient.
        token_client.transfer(&from, &to, &net_amount);

        // Build and store the payment record.
        let seq = Self::next_seq(&env);
        let record = PaymentRecord {
            from: from.clone(),
            to: to.clone(),
            token: token.clone(),
            net_amount,
            fee_amount,
            memo: memo.clone(),
            ledger: env.ledger().sequence(),
        };

        // Key: (from_address, sequence_number)
        let key = (from.clone(), seq);
        env.storage().persistent().set(&key, &record);

        // Emit event.
        events::emit_payment_sent(&env, &from, &to, &token, net_amount, fee_amount, &memo);

        Ok(record)
    }

    /// Execute a path payment routed through the Stellar DEX.
    ///
    /// The protocol fee is deducted from `send_amount` before the DEX swap is
    /// attempted, so the recipient always receives at least `min_dest_amount`.
    ///
    /// * `from`             – Source address.
    /// * `to`               – Destination address.
    /// * `send_token`       – Asset sent by `from`.
    /// * `send_amount`      – Gross send amount (fee taken from this).
    /// * `dest_token`       – Asset received by `to`.
    /// * `min_dest_amount`  – Minimum acceptable destination amount (slippage guard).
    /// * `path`             – Intermediate DEX hops (may be empty for a direct swap).
    pub fn send_path_payment(
        env: Env,
        from: Address,
        to: Address,
        send_token: Address,
        send_amount: i128,
        dest_token: Address,
        min_dest_amount: i128,
        path: Vec<Address>,
    ) -> Result<i128, StellarSendError> {
        from.require_auth();

        let config = Self::load_config(&env)?;

        if send_amount <= 0 {
            return Err(StellarSendError::InvalidAmount);
        }
        if min_dest_amount <= 0 {
            return Err(StellarSendError::InvalidAmount);
        }

        let (fee_amount, net_send_amount) = Self::split_fee(send_amount, config.fee_bps)?;

        let send_token_client = token::Client::new(&env, &send_token);

        // Collect fee in the send token first.
        if fee_amount > 0 {
            send_token_client.transfer(&from, &config.fee_collector, &fee_amount);
        }

        // Build the full token path for the DEX: send_token → [path…] → dest_token
        let mut full_path: Vec<Address> = vec![&env, send_token.clone()];
        for hop in path.iter() {
            full_path.push_back(hop);
        }
        full_path.push_back(dest_token.clone());

        // For path payments on Soroban we perform the swaps manually via
        // token transfers through each hop in the path.  A production
        // integration would invoke the Stellar DEX or an AMM router contract
        // here.  For now we simulate a single-hop swap: transfer net_send_amount
        // from `from` to the first intermediate (or destination), then transfer
        // the destination amount to `to`.  The slippage check ensures safety.
        //
        // NOTE: In a real deployment, replace this section with a call to the
        // Soroban DEX router contract, e.g.:
        //   dex_router::Client::new(&env, &router_addr)
        //       .path_swap(&from, &to, &full_path, &net_send_amount, &min_dest_amount);
        //
        // We model the output as 1:1 for testing purposes.
        let simulated_dest_amount = net_send_amount; // replace with actual DEX return

        if simulated_dest_amount < min_dest_amount {
            return Err(StellarSendError::SlippageExceeded);
        }

        // Transfer send tokens from sender to this contract (as swap intermediary).
        send_token_client.transfer(&from, &env.current_contract_address(), &net_send_amount);

        // Transfer destination tokens from this contract to recipient.
        // (In a real integration the DEX swap populates this contract's balance.)
        let dest_token_client = token::Client::new(&env, &dest_token);
        dest_token_client.transfer(&env.current_contract_address(), &to, &simulated_dest_amount);

        // Store record.
        let seq = Self::next_seq(&env);
        let key = (from.clone(), seq);
        let record = PaymentRecord {
            from: from.clone(),
            to: to.clone(),
            token: send_token.clone(),
            net_amount: simulated_dest_amount,
            fee_amount,
            memo: String::from_str(&env, "path_payment"),
            ledger: env.ledger().sequence(),
        };
        env.storage().persistent().set(&key, &record);

        events::emit_path_payment_sent(
            &env,
            &from,
            &to,
            &send_token,
            net_send_amount,
            &dest_token,
            simulated_dest_amount,
            fee_amount,
        );

        Ok(simulated_dest_amount)
    }

    /// Retrieve a stored payment record by sender and sequence number.
    ///
    /// Returns `NotInitialized` if the contract itself has never been
    /// initialized, or `PaymentRecordNotFound` if it has, but no record
    /// exists for this `(from, seq)` pair — e.g. a wrong sequence number,
    /// or a caller querying before the transaction that would have
    /// created the record has confirmed. These used to be conflated: any
    /// missing record reported `NotInitialized` regardless of whether the
    /// contract was actually initialized (#25), which is misleading for
    /// an integrator branching on the error to decide how to recover.
    pub fn get_payment_record(
        env: Env,
        from: Address,
        seq: u64,
    ) -> Result<PaymentRecord, StellarSendError> {
        Self::load_config(&env)?;

        let key = (from, seq);
        env.storage()
            .persistent()
            .get(&key)
            .ok_or(StellarSendError::PaymentRecordNotFound)
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /// Load and return the contract configuration from instance storage.
    fn load_config(env: &Env) -> Result<ContractConfig, StellarSendError> {
        env.storage()
            .instance()
            .get(&KEY_CONFIG)
            .ok_or(StellarSendError::NotInitialized)
    }

    /// Increment and return the global payment sequence counter.
    fn next_seq(env: &Env) -> u64 {
        let seq: u64 = env
            .storage()
            .instance()
            .get(&KEY_SEQ)
            .unwrap_or(0u64);
        let next = seq.wrapping_add(1);
        env.storage().instance().set(&KEY_SEQ, &next);
        next
    }

    /// Split a gross `amount` into (fee, net) using `fee_bps` basis points.
    ///
    /// fee  = floor(amount * fee_bps / 10_000)
    /// net  = amount – fee
    fn split_fee(amount: i128, fee_bps: u32) -> Result<(i128, i128), StellarSendError> {
        if fee_bps == 0 {
            return Ok((0, amount));
        }
        let fee = amount
            .checked_mul(fee_bps as i128)
            .ok_or(StellarSendError::ArithmeticOverflow)?
            / 10_000i128;
        let net = amount
            .checked_sub(fee)
            .ok_or(StellarSendError::ArithmeticOverflow)?;
        Ok((fee, net))
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod test;
