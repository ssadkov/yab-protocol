module yab::oracle {
    use pyth::i64 as pyth_i64;
    use pyth::price;
    use pyth::price_identifier;
    use pyth::pyth;
    use aptos_framework::timestamp;
    use yab::errors;

    // Governance can later move these into VaultConfig.
    const MAX_PRICE_AGE_SECS: u64 = 60;
    const MAX_DEVIATION_BPS: u64 = 500; // 5% max move vs last recorded
    const MAX_CONF_BPS: u64 = 100; // 1% max confidence / price ratio

    /// Pyth BTC/USD price feed id (32 bytes). Same feed on Aptos mainnet and testnet.
    const BTC_USD_FEED: vector<u8> =
        x"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

    /// Returns BTC/USD price using Pyth's published mantissa (see Pyth `Price` expo).
    /// Callers must update Pyth VAAs on-chain before reads (on-demand model).
    public fun get_safe_price(last_recorded_price: u64): u64 {
        let feed_id = price_identifier::from_byte_vec(BTC_USD_FEED);
        let price_obj = pyth::get_price_unsafe(feed_id);

        // Guard 1: staleness (oracle policy; stricter than Pyth default if desired)
        let age = timestamp::now_seconds() - price::get_timestamp(&price_obj);
        assert!(age <= MAX_PRICE_AGE_SECS, errors::stale_price());

        let price_i64 = price::get_price(&price_obj);
        let raw = pyth_i64::get_magnitude_if_positive(&price_i64);
        assert!(raw > 0, errors::zero_amount());

        // Guard 2: deviation vs last recorded (skip when last_recorded_price == 0)
        if (last_recorded_price > 0) {
            let delta = if (raw > last_recorded_price) {
                (raw - last_recorded_price) * 10000 / last_recorded_price
            } else {
                (last_recorded_price - raw) * 10000 / last_recorded_price
            };
            assert!(delta <= MAX_DEVIATION_BPS, errors::price_spike());
        };

        // Guard 3: confidence band vs price
        let conf = price::get_conf(&price_obj);
        let conf_ratio = conf * 10000 / raw;
        assert!(conf_ratio <= MAX_CONF_BPS, errors::low_confidence());

        raw
    }
}
