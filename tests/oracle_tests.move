#[test_only]
module yab::oracle_tests {
    use yab::oracle;

    #[test]
    fun test_first_call_skips_deviation_check() {
        oracle::validate_cached_price_for_test(0, 1_000_000, 1_000_000, 100_000_000, 100_000);
    }

    #[test]
    #[expected_failure(abort_code = 1, location = yab::oracle)]
    fun test_stale_price_aborts() {
        let now = 1_000_000u64;
        let feed_ts = now - 120;
        oracle::validate_cached_price_for_test(0, now, feed_ts, 100_000_000, 100_000);
    }

    #[test]
    #[expected_failure(abort_code = 2, location = yab::oracle)]
    fun test_price_spike_aborts() {
        oracle::validate_cached_price_for_test(100_000_000, 1_000_000, 1_000_000, 110_000_000, 100_000);
    }

    #[test]
    #[expected_failure(abort_code = 3, location = yab::oracle)]
    fun test_low_confidence_aborts() {
        let raw = 1_000_000u64;
        let conf = 200_000u64;
        oracle::validate_cached_price_for_test(0, 1_000_000, 1_000_000, raw, conf);
    }
}
