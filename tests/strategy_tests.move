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
}
