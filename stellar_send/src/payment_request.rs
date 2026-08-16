//! Payment requests / invoicing.
//!
//! A "requester" (e.g. a merchant) creates a request describing what they
//! want to be paid.  Anyone (or, if `payer` is set, only that address) can
//! then fulfil it before `expiry`.  Fulfilment reuses the same fee-splitting
//! logic as `send_payment` so invoiced payments are treated identically to
//! direct payments for accounting purposes.
//!
//! Storage
//! ───────
//! Instance:
//!   KEY_REQ_SEQ → u64 (global request id counter)
//! Persistent:
//!   (KEY_REQ, id) → PaymentRequest

use soroban_sdk::{contractimpl, contracttype, token, Address, Env, String};

use crate::{
    StellarSendContract, StellarSendContractClient, StellarSendError, KEY_REQ, KEY_REQ_SEQ,
};

/// State machine: Open → Fulfilled | Cancelled.
#[contracttype]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PaymentRequestStatus {
    Open,
    Fulfilled,
    Cancelled,
}

/// An invoice created by `requester`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct PaymentRequest {
    pub requester: Address,
    /// If set, only this address may fulfil the request.
    pub payer: Option<Address>,
    pub token: Address,
    pub amount: i128,
    pub memo: String,
    /// Ledger timestamp after which the request can no longer be fulfilled.
    pub expiry: u64,
    pub status: PaymentRequestStatus,
}

#[contractimpl]
impl StellarSendContract {
    /// Create a payment request ("invoice").  Returns the request id.
    ///
    /// * `payer`  – Optional address restriction; `None` means anyone may pay.
    /// * `expiry` – Must be a ledger timestamp strictly in the future.
    pub fn create_payment_request(
        env: Env,
        requester: Address,
        payer: Option<Address>,
        token: Address,
        amount: i128,
        memo: String,
        expiry: u64,
    ) -> Result<u64, StellarSendError> {
        requester.require_auth();

        if amount <= 0 {
            return Err(StellarSendError::InvalidAmount);
        }
        if expiry <= env.ledger().timestamp() {
            return Err(StellarSendError::InvalidExpiry);
        }
        if let Some(p) = &payer {
            if *p == requester {
                return Err(StellarSendError::SelfPaymentNotAllowed);
            }
        }

        let id = Self::next_req_id(&env);
        let request = PaymentRequest {
            requester: requester.clone(),
            payer,
            token: token.clone(),
            amount,
            memo,
            expiry,
            status: PaymentRequestStatus::Open,
        };
        env.storage().persistent().set(&(KEY_REQ, id), &request);

        crate::events::emit_payment_request_created(&env, id, &requester, &token, amount, expiry);
        Ok(id)
    }

    /// Fulfil an open, non-expired payment request.  The protocol fee is
    /// deducted exactly as in `send_payment`; the requester receives the
    /// net amount.
    pub fn fulfill_payment_request(
        env: Env,
        request_id: u64,
        payer: Address,
    ) -> Result<i128, StellarSendError> {
        payer.require_auth();

        let mut request = Self::load_request(&env, request_id)?;

        match request.status {
            PaymentRequestStatus::Fulfilled => {
                return Err(StellarSendError::RequestAlreadyFulfilled)
            }
            PaymentRequestStatus::Cancelled => return Err(StellarSendError::RequestCancelled),
            PaymentRequestStatus::Open => {}
        }
        if env.ledger().timestamp() > request.expiry {
            return Err(StellarSendError::RequestExpired);
        }
        if let Some(expected_payer) = &request.payer {
            if *expected_payer != payer {
                return Err(StellarSendError::WrongPayer);
            }
        }

        let config = Self::load_config(&env)?;
        let (fee_amount, net_amount) = Self::split_fee(request.amount, config.fee_bps)?;

        request.status = PaymentRequestStatus::Fulfilled;
        env.storage().persistent().set(&(KEY_REQ, request_id), &request);

        let token_client = token::Client::new(&env, &request.token);
        if fee_amount > 0 {
            token_client.transfer(&payer, &config.fee_collector, &fee_amount);
        }
        token_client.transfer(&payer, &request.requester, &net_amount);

        crate::events::emit_payment_request_fulfilled(
            &env,
            request_id,
            &request.requester,
            &payer,
            net_amount,
            fee_amount,
        );

        Ok(net_amount)
    }

    /// Cancel an open payment request.  Only the original requester may do
    /// this; a fulfilled request cannot be cancelled retroactively.
    pub fn cancel_payment_request(env: Env, request_id: u64) -> Result<(), StellarSendError> {
        let mut request = Self::load_request(&env, request_id)?;
        request.requester.require_auth();

        match request.status {
            PaymentRequestStatus::Fulfilled => {
                return Err(StellarSendError::RequestAlreadyFulfilled)
            }
            PaymentRequestStatus::Cancelled => return Err(StellarSendError::RequestCancelled),
            PaymentRequestStatus::Open => {}
        }

        request.status = PaymentRequestStatus::Cancelled;
        env.storage()
            .persistent()
            .set(&(KEY_REQ, request_id), &request);

        crate::events::emit_payment_request_cancelled(&env, request_id, &request.requester);
        Ok(())
    }

    /// Fetch a payment request by id.
    pub fn get_payment_request(
        env: Env,
        request_id: u64,
    ) -> Result<PaymentRequest, StellarSendError> {
        Self::load_request(&env, request_id)
    }

    fn load_request(env: &Env, id: u64) -> Result<PaymentRequest, StellarSendError> {
        env.storage()
            .persistent()
            .get(&(KEY_REQ, id))
            .ok_or(StellarSendError::RequestNotFound)
    }

    fn next_req_id(env: &Env) -> u64 {
        let seq: u64 = env.storage().instance().get(&KEY_REQ_SEQ).unwrap_or(0u64);
        let next = seq.wrapping_add(1);
        env.storage().instance().set(&KEY_REQ_SEQ, &next);
        next
    }
}
