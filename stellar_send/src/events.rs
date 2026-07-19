use soroban_sdk::{symbol_short, Address, Env, String};

// ---------------------------------------------------------------------------
// PaymentSent — emitted after a successful direct payment
// ---------------------------------------------------------------------------

/// Publish a `PaymentSent` event.
///
/// Topics : ["payment_sent", from, to]
/// Data   : (token, net_amount, fee_amount, memo)
pub fn emit_payment_sent(
    env: &Env,
    from: &Address,
    to: &Address,
    token: &Address,
    net_amount: i128,
    fee_amount: i128,
    memo: &String,
) {
    let topics = (symbol_short!("pay_sent"), from.clone(), to.clone());
    let data = (token.clone(), net_amount, fee_amount, memo.clone());
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------------
// PathPaymentSent — emitted after a successful DEX-routed payment
// ---------------------------------------------------------------------------

/// Publish a `PathPaymentSent` event.
///
/// Topics : ["path_sent", from, to]
/// Data   : (send_token, send_amount, dest_token, dest_amount, fee_amount)
pub fn emit_path_payment_sent(
    env: &Env,
    from: &Address,
    to: &Address,
    send_token: &Address,
    send_amount: i128,
    dest_token: &Address,
    dest_amount: i128,
    fee_amount: i128,
) {
    let topics = (symbol_short!("path_sent"), from.clone(), to.clone());
    let data = (
        send_token.clone(),
        send_amount,
        dest_token.clone(),
        dest_amount,
        fee_amount,
    );
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------------
// FeeUpdated — emitted when admin changes the fee
// ---------------------------------------------------------------------------

/// Publish a `FeeUpdated` event.
///
/// Topics : ["fee_updated"]
/// Data   : (old_fee_bps, new_fee_bps)
pub fn emit_fee_updated(env: &Env, old_fee_bps: u32, new_fee_bps: u32) {
    let topics = (symbol_short!("fee_upd"),);
    let data = (old_fee_bps, new_fee_bps);
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------------
// Subscriptions
// ---------------------------------------------------------------------------

/// Topics : ["sub_new", payer, recipient]
/// Data   : (id, token, amount, interval_seconds, next_execution_time,
///           max_executions, expiry_time)
#[allow(clippy::too_many_arguments)]
pub fn emit_subscription_created(
    env: &Env,
    id: u64,
    payer: &Address,
    recipient: &Address,
    token: &Address,
    amount: i128,
    interval_seconds: u64,
    next_execution_time: u64,
    max_executions: Option<u32>,
    expiry_time: Option<u64>,
) {
    let topics = (symbol_short!("sub_new"), payer.clone(), recipient.clone());
    let data = (
        id,
        token.clone(),
        amount,
        interval_seconds,
        next_execution_time,
        max_executions,
        expiry_time,
    );
    env.events().publish(topics, data);
}

/// Topics : ["sub_cncl", payer]
/// Data   : (id,)
pub fn emit_subscription_cancelled(env: &Env, id: u64, payer: &Address) {
    let topics = (symbol_short!("sub_cncl"), payer.clone());
    env.events().publish(topics, (id,));
}

/// Topics : ["sub_exec", payer, recipient]
/// Data   : (id, net_amount, fee_amount, next_execution_time,
///           executions_count, still_active)
#[allow(clippy::too_many_arguments)]
pub fn emit_subscription_executed(
    env: &Env,
    id: u64,
    payer: &Address,
    recipient: &Address,
    net_amount: i128,
    fee_amount: i128,
    next_execution_time: u64,
    executions_count: u32,
    still_active: bool,
) {
    let topics = (symbol_short!("sub_exec"), payer.clone(), recipient.clone());
    let data = (
        id,
        net_amount,
        fee_amount,
        next_execution_time,
        executions_count,
        still_active,
    );
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------------
// Batch payments
// ---------------------------------------------------------------------------

/// Emitted once per leg of a batch payment (reuses the same shape as a
/// regular `PaymentSent` event so downstream indexers need no special case).
///
/// Topics : ["batch_leg", from, to]
/// Data   : (token, net_amount, fee_amount)
pub fn emit_batch_leg_sent(
    env: &Env,
    from: &Address,
    to: &Address,
    token: &Address,
    net_amount: i128,
    fee_amount: i128,
) {
    let topics = (symbol_short!("batch_leg"), from.clone(), to.clone());
    let data = (token.clone(), net_amount, fee_amount);
    env.events().publish(topics, data);
}

/// Aggregate event emitted once after every leg of a batch has settled.
///
/// Topics : ["batch_ok", from]
/// Data   : (token, leg_count, total_net, total_fee)
pub fn emit_batch_payment_completed(
    env: &Env,
    from: &Address,
    token: &Address,
    leg_count: u32,
    total_net: i128,
    total_fee: i128,
) {
    let topics = (symbol_short!("batch_ok"), from.clone());
    let data = (token.clone(), leg_count, total_net, total_fee);
    env.events().publish(topics, data);
}

// ---------------------------------------------------------------------------
// Payment requests / invoicing
// ---------------------------------------------------------------------------

/// Topics : ["req_new", requester]
/// Data   : (id, token, amount, expiry)
pub fn emit_payment_request_created(
    env: &Env,
    id: u64,
    requester: &Address,
    token: &Address,
    amount: i128,
    expiry: u64,
) {
    let topics = (symbol_short!("req_new"), requester.clone());
    let data = (id, token.clone(), amount, expiry);
    env.events().publish(topics, data);
}

/// Topics : ["req_fill", requester, payer]
/// Data   : (id, net_amount, fee_amount)
pub fn emit_payment_request_fulfilled(
    env: &Env,
    id: u64,
    requester: &Address,
    payer: &Address,
    net_amount: i128,
    fee_amount: i128,
) {
    let topics = (symbol_short!("req_fill"), requester.clone(), payer.clone());
    let data = (id, net_amount, fee_amount);
    env.events().publish(topics, data);
}

/// Topics : ["req_cncl", requester]
/// Data   : (id,)
pub fn emit_payment_request_cancelled(env: &Env, id: u64, requester: &Address) {
    let topics = (symbol_short!("req_cncl"), requester.clone());
    env.events().publish(topics, (id,));
}
