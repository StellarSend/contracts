use soroban_sdk::contracterror;

/// Errors that can be returned by the StellarSend contract.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum StellarSendError {
    /// The contract has already been initialized.
    AlreadyInitialized = 1,
    /// The contract has not been initialized yet.
    NotInitialized = 2,
    /// The caller is not the admin.
    Unauthorized = 3,
    /// The amount specified is zero or negative.
    InvalidAmount = 4,
    /// The fee in basis points exceeds 10 000 (100%).
    InvalidFeeBps = 5,
    /// The sender's token balance is insufficient to cover amount + fee.
    InsufficientBalance = 6,
    /// The path payment did not produce the required minimum destination amount.
    SlippageExceeded = 7,
    /// The payment path provided is empty or malformed.
    InvalidPath = 8,
    /// Arithmetic overflow occurred during fee / amount calculation.
    ArithmeticOverflow = 9,
    /// The fee-collector address stored in config is invalid.
    InvalidFeeCollector = 10,

    // -- Subscriptions --------------------------------------------------
    /// The subscription id does not exist.
    SubscriptionNotFound = 11,
    /// The subscription has already been cancelled.
    SubscriptionInactive = 12,
    /// `execute_subscription` was called before `next_execution_time`.
    SubscriptionNotDue = 13,
    /// The interval between recurring executions must be positive.
    InvalidInterval = 14,
    /// A recurring/self payment was attempted (payer == recipient).
    SelfPaymentNotAllowed = 15,

    // -- Batch payments ---------------------------------------------------
    /// A batch payment call contained no payment legs.
    EmptyBatch = 16,

    // -- Payment requests -------------------------------------------------
    /// The payment request id does not exist.
    RequestNotFound = 17,
    /// The payment request has already been fulfilled.
    RequestAlreadyFulfilled = 18,
    /// The payment request has been cancelled by the requester.
    RequestCancelled = 19,
    /// The payment request's expiry ledger timestamp has passed.
    RequestExpired = 20,
    /// `expiry` must be a timestamp in the future.
    InvalidExpiry = 21,
    /// The request restricts payment to a specific payer and the caller
    /// does not match it.
    WrongPayer = 22,

    // -- Subscription caps (#23) -----------------------------------------
    /// `max_executions` was set to `Some(0)`, which could never execute.
    InvalidMaxExecutions = 23,
    /// The subscription's `expiry_time` has passed.
    SubscriptionExpired = 24,

    // -- Payment records (#25) --------------------------------------------
    // Next available discriminant at the time this was added: 23 and 24
    // were already claimed by #23's merged PR (subscription caps), so this
    // is 25, not the 23 the issue's own text speculated might still be
    // free — coordinate here first if adding another variant concurrently.
    /// `get_payment_record` found no record for the given `(from, seq)`
    /// key. Distinct from `NotInitialized`: the contract itself is fully
    /// initialized, this specific record just doesn't exist (wrong
    /// sequence number, or querying before the transaction that would
    /// have created it has confirmed).
    PaymentRecordNotFound = 25,
}
