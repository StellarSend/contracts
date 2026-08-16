#![cfg(test)]
use soroban_sdk::{contract, contractimpl, Address, Env};
use crate::StellarSendContractClient;

#[contract]
pub struct MockReentrantToken;

#[contractimpl]
impl MockReentrantToken {
    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        // Just mock
    }
}
