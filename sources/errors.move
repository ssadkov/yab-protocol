module yab::errors {
    // oracle
    const E_STALE_PRICE: u64 = 1;
    const E_PRICE_SPIKE: u64 = 2;
    const E_LOW_CONFIDENCE: u64 = 3;
    // auth
    const E_NOT_ADMIN: u64 = 10;
    const E_NOT_OPERATOR: u64 = 11;
    // vault state
    const E_ZERO_AMOUNT: u64 = 20;
    const E_INSUFFICIENT_SHARES: u64 = 21;
    const E_ZERO_SUPPLY: u64 = 22;
    const E_REBALANCE_NOT_NEEDED: u64 = 23;
    const E_REBALANCE_TOO_EARLY: u64 = 24;
    const E_INVALID_SLIPPAGE: u64 = 25;
    const E_ALREADY_BOOTSTRAPPED: u64 = 26; // bootstrap() called twice
    const E_INVALID_POOL_CONFIG: u64 = 27; // metadata addresses / pool config
    const E_NOT_BOOTSTRAPPED: u64 = 28; // deposit before bootstrap / no position
    const E_DEPOSIT_TOO_SMALL: u64 = 29; // below DEX / pool rounding minimums
    // strategy
    const E_RANGE_TOO_NARROW: u64 = 30;
    const E_FEE_TOO_HIGH: u64 = 31;
    const E_UNSUPPORTED_TOKEN: u64 = 32;

    // Constants are module-private in this language edition; use these getters from other modules.
    public fun stale_price(): u64 { E_STALE_PRICE }
    public fun price_spike(): u64 { E_PRICE_SPIKE }
    public fun low_confidence(): u64 { E_LOW_CONFIDENCE }
    public fun not_admin(): u64 { E_NOT_ADMIN }
    public fun not_operator(): u64 { E_NOT_OPERATOR }
    public fun zero_amount(): u64 { E_ZERO_AMOUNT }
    public fun insufficient_shares(): u64 { E_INSUFFICIENT_SHARES }
    public fun zero_supply(): u64 { E_ZERO_SUPPLY }
    public fun rebalance_not_needed(): u64 { E_REBALANCE_NOT_NEEDED }
    public fun rebalance_too_early(): u64 { E_REBALANCE_TOO_EARLY }
    public fun invalid_slippage(): u64 { E_INVALID_SLIPPAGE }
    public fun already_bootstrapped(): u64 { E_ALREADY_BOOTSTRAPPED }
    public fun invalid_pool_config(): u64 { E_INVALID_POOL_CONFIG }
    public fun not_bootstrapped(): u64 { E_NOT_BOOTSTRAPPED }
    public fun deposit_too_small(): u64 { E_DEPOSIT_TOO_SMALL }
    public fun range_too_narrow(): u64 { E_RANGE_TOO_NARROW }
    public fun fee_too_high(): u64 { E_FEE_TOO_HIGH }
    public fun unsupported_token(): u64 { E_UNSUPPORTED_TOKEN }
}
