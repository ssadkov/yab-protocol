module yab::oracle {
    use aptos_framework::timestamp;
    use pyth::i64 as pyth_i64;
    use pyth::price;
    use pyth::price_identifier;
    use pyth::pyth;
    use yab::errors;

    /// BTC/USD feed id (same on Aptos mainnet / testnet for this feed).
    /// https://docs.pyth.network/price-feeds/price-feeds
    const BTC_USD_FEED_ID: vector<u8> =
        x"e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43";

    /// Governance can later move these into VaultConfig.
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

    /// Returns BTC/USD in vault units: USD per 1 BTC with 8 fractional digits (same as legacy mock scale).
    /// Reads Pyth on-chain cache (must be updated via Hermes / `update_price_feeds` in the same tx or recently).
    public fun get_safe_price(last_recorded_price: u64): u64 {
        let (raw, conf, ts) = read_pyth_btc_usd_checked();
        let now = timestamp::now_seconds();
        validate_cached_price(last_recorded_price, now, ts, raw, conf);
        raw
    }

    // --- Public views for off-chain verification (CLI / TS SDK `view`) ---
    // `btc_usd_price_safe`: same path as get_safe_price (Pyth freshness + vault guards).
    #[view]
    public fun btc_usd_price_safe(last_recorded_price: u64): u64 {
        get_safe_price(last_recorded_price)
    }

    // `btc_usd_price_pyth_only`: vault-scale price; YAB deviation/confidence guards not applied; Pyth stale check still applies.
    #[view]
    public fun btc_usd_price_pyth_only(): u64 {
        let (raw, _conf, _ts) = read_pyth_btc_usd_checked();
        raw
    }

    // `btc_usd_snapshot_unsafe`: raw cache snapshot for debugging (price_8dec, conf_8dec, publish_time_secs, age_secs).
    #[view]
    public fun btc_usd_snapshot_unsafe(): (u64, u64, u64, u64) {
        let id = price_identifier::from_byte_vec(BTC_USD_FEED_ID);
        let p = pyth::get_price_unsafe(id);
        let price_i64 = price::get_price(&p);
        assert!(!pyth_i64::get_is_negative(&price_i64), errors::zero_amount());
        let mag = pyth_i64::get_magnitude_if_positive(&price_i64);
        let expo = price::get_expo(&p);
        let raw = normalize_pyth_to_usd_8decimals(mag, expo);
        let conf_mag = price::get_conf(&p);
        let conf_n = normalize_pyth_to_usd_8decimals(conf_mag, expo);
        let ts = price::get_timestamp(&p);
        let now = timestamp::now_seconds();
        let age = if (now >= ts) {
            now - ts
        } else {
            0
        };
        (raw, conf_n, ts, age)
    }

    // Returns Pyth BTC/USD feed id bytes (Hermes / integrators).
    #[view]
    public fun btc_usd_feed_id(): vector<u8> {
        BTC_USD_FEED_ID
    }

    // Returns (max_age_secs, max_deviation_bps, max_conf_bps).
    #[view]
    public fun safety_params(): (u64, u64, u64) {
        (MAX_PRICE_AGE_SECS, MAX_DEVIATION_BPS, MAX_CONF_BPS)
    }

    // --- Internal ---

    fun read_pyth_btc_usd_checked(): (u64, u64, u64) {
        let id = price_identifier::from_byte_vec(BTC_USD_FEED_ID);
        let p = pyth::get_price(id);
        extract_normalized(&p)
    }

    fun extract_normalized(p: &price::Price): (u64, u64, u64) {
        let price_i64 = price::get_price(p);
        assert!(!pyth_i64::get_is_negative(&price_i64), errors::zero_amount());
        let mag = pyth_i64::get_magnitude_if_positive(&price_i64);
        let expo = price::get_expo(p);
        let raw = normalize_pyth_to_usd_8decimals(mag, expo);
        let conf_mag = price::get_conf(p);
        let conf_n = normalize_pyth_to_usd_8decimals(conf_mag, expo);
        let ts = price::get_timestamp(p);
        (raw, conf_n, ts)
    }

    /// Converts Pyth `magnitude * 10^expo` (USD per BTC) to vault fixed-point: USD * 10^8 per 1 BTC.
    fun normalize_pyth_to_usd_8decimals(magnitude: u64, expo: pyth_i64::I64): u64 {
        let neg = pyth_i64::get_is_negative(&expo);
        let expo_abs = if (neg) {
            pyth_i64::get_magnitude_if_negative(&expo)
        } else {
            pyth_i64::get_magnitude_if_positive(&expo)
        };
        if (neg) {
            if (expo_abs <= 8) {
                let t = (8u64 - expo_abs) as u8;
                let f = pow10_u64(t);
                magnitude * f
            } else {
                let t = (expo_abs - 8u64) as u8;
                let f = pow10_u64(t);
                magnitude / f
            }
        } else {
            let t = (8u64 + expo_abs) as u8;
            assert!(t <= 18, errors::price_spike());
            let f = pow10_u64(t);
            magnitude * f
        }
    }

    /// 10^n for n in 0..=18 (Pyth BTC/USD expo is typically -8).
    fun pow10_u64(n: u8): u64 {
        if (n == 0) {
            1
        } else if (n == 1) {
            10
        } else if (n == 2) {
            100
        } else if (n == 3) {
            1_000
        } else if (n == 4) {
            10_000
        } else if (n == 5) {
            100_000
        } else if (n == 6) {
            1_000_000
        } else if (n == 7) {
            10_000_000
        } else if (n == 8) {
            100_000_000
        } else if (n == 9) {
            1_000_000_000
        } else if (n == 10) {
            10_000_000_000
        } else if (n == 11) {
            100_000_000_000
        } else if (n == 12) {
            1_000_000_000_000
        } else if (n == 13) {
            10_000_000_000_000
        } else if (n == 14) {
            100_000_000_000_000
        } else if (n == 15) {
            1_000_000_000_000_000
        } else if (n == 16) {
            10_000_000_000_000_000
        } else if (n == 17) {
            100_000_000_000_000_000
        } else if (n == 18) {
            1_000_000_000_000_000_000
        } else {
            assert!(false, errors::price_spike());
            0
        }
    }
}
