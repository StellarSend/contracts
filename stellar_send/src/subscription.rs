//! Scheduled & recurring payments ("subscriptions").
//!
//! A payer creates a subscription describing a recipient, token, amount and
//! interval (in ledger-seconds).  Execution is *pull*-based: the payer must
//! grant this contract a token allowance (SEP-41 `approve`) large enough to
//! cover the payments it wants executed, since `execute_subscription` is
//! designed to be called by an untrusted keeper/cron job with no interactive
//! signature from the payer at execution time.  We therefore move funds with
//! `transfer_from` rather than `transfer`, exactly like a card-network
//! "pull" recurring charge.
//!
//! ## Bounding indefinite subscriptions (#23)
//!
//! A subscription with no cap runs forever, which risks becoming a
//! "forgotten" recurring charge the payer never explicitly agreed to stop.
//! `create_subscription` accepts two independent, optional bounds:
//!
//!   * `max_executions` — a hard ceiling on the total number of successful
//!     charges over the subscription's lifetime. Reaching it auto-deactivates
//!     the subscription (`active = false`), the same terminal state
//!     cancellation produces, so a capped-out subscription surfaces the
//!     familiar `SubscriptionInactive` on any further call.
//!   * `expiry_time` — a ledger timestamp past which `execute_subscription`
//!     refuses to run at all, independent of the execution count. Unlike
//!     `max_executions`, this does *not* auto-deactivate the subscription
//!     (matching `PaymentRequest.expiry`'s behaviour): every attempt past
//!     expiry gets the specific, informative `SubscriptionExpired` rather
//!     than a generic "inactive" once discovered.
//!
//! Both are `None`-able because an unbounded subscription is still a valid,
//! intentional choice (e.g. an indefinite payroll-style payment) — the payer
//! opts into a bound rather than having one imposed.
//!
//! ## Catch-up bursts are intentionally unchanged
//!
//! `execute_subscription` still advances `next_execution_time` by exactly
//! one `interval_seconds` per call rather than jumping to `now +
//! interval_seconds` (see the comment at the call site) — this is what
//! stops a late keeper call from silently drifting the cadence forward, a
//! real problem this design solves. Its accepted side effect: if a
//! subscription goes unexecuted for a long stretch, a keeper *can* call
//! `execute_subscription` back-to-back to "catch up" every missed interval,
//! each call transferring one full payment.
//!
//! We deliberately do not change that here. Disallowing catch-up (skipping
//! missed intervals instead) trades a burst-of-payments surprise for a
//! skipped-payment surprise — neither is strictly safer, and the module's
//! own anti-drift design already reflects a considered choice for the
//! former. What actually bounds the *damage* of a catch-up burst is
//! `max_executions`/`expiry_time` above: a subscription with a hard cap has
//! a hard ceiling on how much a burst can ever move, capped subscription or
//! not. See `test_execute_subscription_rapid_catch_up_multiple_calls` and
//! `test_execute_subscription_max_executions_bounds_catch_up_burst` for
//! what this means concretely. A future issue could still add a per-call
//! rate limit or a `catch_up: bool` opt-out if product requirements turn
//! out to want one; nothing here forecloses that.
//!
//! Storage
//! ───────
//! Instance:
//!   KEY_SUB_SEQ → u64 (global subscription id counter)
//! Persistent:
//!   (KEY_SUB, id) → Subscription

use soroban_sdk::{contractimpl, contracttype, token, Address, Env};

use crate::{
    StellarSendContract, StellarSendContractClient, StellarSendError, KEY_SUB, KEY_SUB_SEQ,
};

/// A recurring payment authorised by `payer`.
#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Subscription {
    pub payer: Address,
    pub recipient: Address,
    pub token: Address,
    /// Gross amount transferred on every execution (fee is deducted from this).
    pub amount: i128,
    /// Minimum number of seconds between two consecutive executions.
    pub interval_seconds: u64,
    /// Unix timestamp (ledger time) at which the subscription may next run.
    pub next_execution_time: u64,
    /// False once cancelled by the payer, or once `max_executions` has been
    /// reached; either way, a new subscription must be created instead of
    /// trying to re-activate this one.
    pub active: bool,
    /// Hard ceiling on total lifetime executions, or `None` for unbounded.
    /// Reaching this count sets `active = false`.
    pub max_executions: Option<u32>,
    /// Ledger timestamp past which `execute_subscription` refuses to run,
    /// or `None` for no expiry. Checked independently of `max_executions`.
    pub expiry_time: Option<u64>,
    /// Count of successful executions so far.
    pub executions_count: u32,
}

#[contractimpl]
impl StellarSendContract {
    /// Create a recurring payment.  `start_time` is the timestamp of the
    /// first allowed execution (may be in the past to allow immediate
    /// execution, or in the future to delay the first charge).
    ///
    /// * `max_executions` – Optional hard ceiling on total lifetime
    ///   executions (`Some(0)` is rejected as invalid — it could never run).
    ///   `None` means unbounded, same as omitting a cap entirely.
    /// * `expiry_time` – Optional ledger timestamp past which the
    ///   subscription can no longer execute, independent of
    ///   `max_executions`. Must be strictly after `start_time`, since an
    ///   earlier-or-equal expiry would make the subscription unable to ever
    ///   execute even once. `None` means no expiry.
    ///
    /// The payer must separately call `token.approve(payer, <this contract>,
    /// amount * N, expiration_ledger)` on the token contract so that future
    /// `execute_subscription` calls (which run without the payer's live
    /// signature) are authorised to move funds via `transfer_from`.
    ///
    /// Returns the new subscription id.
    #[allow(clippy::too_many_arguments)]
    pub fn create_subscription(
        env: Env,
        payer: Address,
        recipient: Address,
        token: Address,
        amount: i128,
        interval_seconds: u64,
        start_time: u64,
        max_executions: Option<u32>,
        expiry_time: Option<u64>,
    ) -> Result<u64, StellarSendError> {
        payer.require_auth();

        if amount <= 0 {
            return Err(StellarSendError::InvalidAmount);
        }
        if interval_seconds == 0 {
            return Err(StellarSendError::InvalidInterval);
        }
        if payer == recipient {
            return Err(StellarSendError::SelfPaymentNotAllowed);
        }
        if max_executions == Some(0) {
            return Err(StellarSendError::InvalidMaxExecutions);
        }
        if let Some(expiry) = expiry_time {
            if expiry <= start_time {
                return Err(StellarSendError::InvalidExpiry);
            }
        }

        let id = Self::next_sub_id(&env);
        let sub = Subscription {
            payer: payer.clone(),
            recipient: recipient.clone(),
            token: token.clone(),
            amount,
            interval_seconds,
            next_execution_time: start_time,
            active: true,
            max_executions,
            expiry_time,
            executions_count: 0,
        };

        env.storage().persistent().set(&(KEY_SUB, id), &sub);

        crate::events::emit_subscription_created(
            &env,
            id,
            &payer,
            &recipient,
            &token,
            amount,
            interval_seconds,
            start_time,
            max_executions,
            expiry_time,
        );

        Ok(id)
    }

    /// Cancel a subscription.  Only the payer may cancel.  Idempotent calls
    /// on an already-cancelled subscription return `SubscriptionInactive`.
    pub fn cancel_subscription(env: Env, id: u64) -> Result<(), StellarSendError> {
        let mut sub = Self::load_subscription(&env, id)?;
        sub.payer.require_auth();

        if !sub.active {
            return Err(StellarSendError::SubscriptionInactive);
        }

        sub.active = false;
        env.storage().persistent().set(&(KEY_SUB, id), &sub);

        crate::events::emit_subscription_cancelled(&env, id, &sub.payer);
        Ok(())
    }

    /// Execute a due subscription.  Callable by anyone (a keeper), because
    /// the payer already pre-authorised the token allowance at creation
    /// time.  Fails with `SubscriptionNotDue` if `next_execution_time` has
    /// not yet been reached, guarding against double-execution within a
    /// single interval. Fails with `SubscriptionExpired` if `expiry_time`
    /// has passed, checked independently of the normal due-time gate.
    ///
    /// On the execution that reaches `max_executions` (if set), the
    /// subscription is auto-deactivated the same way cancellation does —
    /// any further call returns `SubscriptionInactive`.
    pub fn execute_subscription(env: Env, id: u64) -> Result<i128, StellarSendError> {
        let mut sub = Self::load_subscription(&env, id)?;

        if !sub.active {
            return Err(StellarSendError::SubscriptionInactive);
        }

        let now = env.ledger().timestamp();
        if now < sub.next_execution_time {
            return Err(StellarSendError::SubscriptionNotDue);
        }
        if let Some(expiry) = sub.expiry_time {
            if now > expiry {
                return Err(StellarSendError::SubscriptionExpired);
            }
        }

        let config = Self::load_config(&env)?;
        let (fee_amount, net_amount) = Self::split_fee(sub.amount, config.fee_bps)?;

        let token_client = token::Client::new(&env, &sub.token);
        let spender = env.current_contract_address();

        if fee_amount > 0 {
            token_client.transfer_from(&spender, &sub.payer, &config.fee_collector, &fee_amount);
        }
        token_client.transfer_from(&spender, &sub.payer, &sub.recipient, &net_amount);

        // Advance the schedule by exactly one interval (not "now + interval")
        // so a late keeper call doesn't silently drift the cadence forward.
        // See the module doc comment for why an unbounded catch-up burst
        // this permits is left as-is and instead bounded by max_executions/
        // expiry_time rather than changed here.
        sub.next_execution_time = sub
            .next_execution_time
            .checked_add(sub.interval_seconds)
            .ok_or(StellarSendError::ArithmeticOverflow)?;

        sub.executions_count = sub
            .executions_count
            .checked_add(1)
            .ok_or(StellarSendError::ArithmeticOverflow)?;
        if let Some(max) = sub.max_executions {
            if sub.executions_count >= max {
                sub.active = false;
            }
        }

        env.storage().persistent().set(&(KEY_SUB, id), &sub);

        crate::events::emit_subscription_executed(
            &env,
            id,
            &sub.payer,
            &sub.recipient,
            net_amount,
            fee_amount,
            sub.next_execution_time,
            sub.executions_count,
            sub.active,
        );

        Ok(net_amount)
    }

    /// Fetch a subscription by id.
    pub fn get_subscription(env: Env, id: u64) -> Result<Subscription, StellarSendError> {
        Self::load_subscription(&env, id)
    }

    fn load_subscription(env: &Env, id: u64) -> Result<Subscription, StellarSendError> {
        env.storage()
            .persistent()
            .get(&(KEY_SUB, id))
            .ok_or(StellarSendError::SubscriptionNotFound)
    }

    fn next_sub_id(env: &Env) -> u64 {
        let seq: u64 = env.storage().instance().get(&KEY_SUB_SEQ).unwrap_or(0u64);
        let next = seq.wrapping_add(1);
        env.storage().instance().set(&KEY_SUB_SEQ, &next);
        next
    }
}
