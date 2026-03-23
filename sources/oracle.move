module yab::oracle {
    use yab::errors;

    // MOCK_ORACLE — replace with Pyth before mainnet deployment.

    /// Fixed BTC/USD price (8 decimals, same scale as production oracle reads).
    // Tuned for current APT/SUV testnet pool so strategy range math remains in-bounds during bootstrap.
    const MOCK_BTC_USD: u64 = 10_978_008_776_339_308_900;

    // Governance can later move these into VaultConfig.
    const MAX_PRICE_AGE_SECS: u64 = 60;
    const MAX_DEVIATION_BPS: u64 = 500; // 5% max move vs last recorded
    const MAX_CONF_BPS: u64 = 100; // 1% max confidence / price ratio

    /// Staleness, deviation spike, and confidence checks on cached fields (`raw` = positive magnitude).
    /// Used by vault test overrides and unit tests; production path uses `get_safe_price`.
    public fun validate_cached_price(
        last_recorded_price: u64,
        now_secs: u64,
        feed_timestamp_secs: u64,
        raw: u64,
        conf: u64,
    ) {
        let age = now_secs - feed_timestamp_secs;
        assert!(age <= MAX_PRICE_AGE_SECS, errors::stale_price());
        assert!(raw > 0, errors::zero_amount());
        if (last_recorded_price > 0) {
            let delta = if (raw > last_recorded_price) {
                (raw - last_recorded_price) * 10000 / last_recorded_price
            } else {
                (last_recorded_price - raw) * 10000 / last_recorded_price
            };
            assert!(delta <= MAX_DEVIATION_BPS, errors::price_spike());
        };
        let conf_ratio = conf * 10000 / raw;
        assert!(conf_ratio <= MAX_CONF_BPS, errors::low_confidence());
    }

    #[test_only]
    /// Unit-test hook for the same rules as production oracle validation (no chain oracle).
    public fun validate_cached_price_for_test(
        last_recorded_price: u64,
        now_secs: u64,
        feed_timestamp_secs: u64,
        raw: u64,
        conf: u64,
    ) {
        validate_cached_price(last_recorded_price, now_secs, feed_timestamp_secs, raw, conf);
    }

    /// Returns a fixed mock BTC/USD price. Ignores `last_recorded_price` (no deviation guard in mock).
    public fun get_safe_price(_last_recorded_price: u64): u64 {
        MOCK_BTC_USD
    }
}
