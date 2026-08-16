use soroban_sdk::{symbol_short, Env, Symbol};

const KEY_REENTRANCY_LOCK: Symbol = symbol_short!("REENTRANT");

pub struct ReentrancyGuard<'a> {
    env: &'a Env,
}

impl<'a> ReentrancyGuard<'a> {
    pub fn new(env: &'a Env) -> Self {
        let is_locked: bool = env.storage().instance().get(&KEY_REENTRANCY_LOCK).unwrap_or(false);
        if is_locked {
            panic!("Reentrancy detected");
        }
        env.storage().instance().set(&KEY_REENTRANCY_LOCK, &true);
        Self { env }
    }
}

impl<'a> Drop for ReentrancyGuard<'a> {
    fn drop(&mut self) {
        self.env.storage().instance().set(&KEY_REENTRANCY_LOCK, &false);
    }
}
