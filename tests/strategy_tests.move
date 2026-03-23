#[test_only]
module yab::strategy_tests {
    use yab::strategy::{Self as strat};

    #[test]
    fun test_should_rebalance_when_center_zero() {
        let p = strat::default_params();
        assert!(strat::should_rebalance(100, 0, &p), 1);
    }

    #[test]
    fun test_should_rebalance_when_deviation_ge_trigger() {
        let p = strat::default_params();
        let center = 100_000_000u64;
        let trigger_bps = 400u64;
        let current = center + center * trigger_bps / 10000 + 1;
        assert!(strat::should_rebalance(current, center, &p), 1);
    }

    #[test]
    fun test_should_not_rebalance_when_inside_band() {
        let p = strat::default_params();
        let center = 100_000_000u64;
        let trigger_bps = 400u64;
        let current = center + center * (trigger_bps - 1) / 10000;
        assert!(!strat::should_rebalance(current, center, &p), 1);
    }

    // Wide band (10000 bps) with large oracle: price_high can exceed u64::MAX without capping in get_target_range.
    #[test]
    fun test_get_target_range_max_bps_large_oracle_no_abort() {
        let p = strat::default_params_with_range_half_width(10000);
        let _r = strat::get_target_range(10978008776339308900u64, &p);
    }
}
