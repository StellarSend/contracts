//! Split / batch payments — one sender fans a single token out to many
//! recipients in a single contract invocation.
//!
//! **Atomicity choice**: batches are all-or-nothing.  We validate every leg
//! up front (positive amount, no self-payment) before moving any funds, and
//! rely on the fact that a Soroban host transaction is atomic: if any
//! individual `token.transfer` traps (e.g. insufficient balance on a later
//! leg), the whole invocation — including earlier transfers in the same
//! batch — is rolled back by the host. There is no partial-success mode;
//! callers that want best-effort/skip-on-failure semantics should submit
//! individual `send_payment` calls instead.

use soroban_sdk::{contractimpl, token, Address, Env, Vec};

use crate::{PaymentRecord, StellarSendContract, StellarSendContractClient, StellarSendError};

#[contractimpl]
impl StellarSendContract {
    /// Send `token` from `from` to every `(recipient, amount)` pair in
    /// `payments`, deducting the protocol fee from each leg exactly as
    /// `send_payment` would.  Returns one `PaymentRecord` per leg, in the
    /// same order as the input.
    ///
    /// Reverts entirely (no legs applied) if `payments` is empty, if any
    /// amount is not positive, or if any transfer fails — see module docs
    /// for the atomicity rationale.
    pub fn send_batch_payment(
        env: Env,
        from: Address,
        token: Address,
        payments: Vec<(Address, i128)>,
    ) -> Result<Vec<PaymentRecord>, StellarSendError> {
        from.require_auth();

        if payments.is_empty() {
            return Err(StellarSendError::EmptyBatch);
        }

        let config = Self::load_config(&env)?;

        // Validate every leg before touching any balance.
        for (recipient, amount) in payments.iter() {
            if amount <= 0 {
                return Err(StellarSendError::InvalidAmount);
            }
            if recipient == from {
                return Err(StellarSendError::SelfPaymentNotAllowed);
            }
        }

        let mut records: Vec<PaymentRecord> = Vec::new(&env);
        let mut total_net: i128 = 0;
        let mut total_fee: i128 = 0;

        // Pass 1: Build records and save to storage
        for (recipient, amount) in payments.iter() {
            let (fee_amount, net_amount) = Self::split_fee(amount, config.fee_bps)?;

            let seq = Self::next_seq(&env, &from);
            let record = PaymentRecord {
                from: from.clone(),
                to: recipient.clone(),
                token: token.clone(),
                net_amount,
                fee_amount,
                memo: soroban_sdk::String::from_str(&env, "batch_payment"),
                ledger: env.ledger().sequence(),
            };
            env.storage().persistent().set(&(from.clone(), seq), &record);

            total_net = total_net
                .checked_add(net_amount)
                .ok_or(StellarSendError::ArithmeticOverflow)?;
            total_fee = total_fee
                .checked_add(fee_amount)
                .ok_or(StellarSendError::ArithmeticOverflow)?;

            records.push_back(record);
        }

        let token_client = token::Client::new(&env, &token);

        // Pass 2: Execute transfers and emit events
        for record in records.iter() {
            if record.fee_amount > 0 {
                token_client.transfer(&from, &config.fee_collector, &record.fee_amount);
            }
            token_client.transfer(&from, &record.to, &record.net_amount);

            crate::events::emit_batch_leg_sent(&env, &from, &record.to, &token, record.net_amount, record.fee_amount);
        }

        crate::events::emit_batch_payment_completed(
            &env,
            &from,
            &token,
            records.len(),
            total_net,
            total_fee,
        );

        Ok(records)
    }
}
