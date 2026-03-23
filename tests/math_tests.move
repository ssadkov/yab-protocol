#[test_only]
module yab::math_tests {
    use yab::math;

    #[test]
    fun test_sqrt_u128_known_values() {
        assert!(math::sqrt_u128(0) == 0, 1);
        assert!(math::sqrt_u128(1) == 1, 2);
        assert!(math::sqrt_u128(4) == 2, 3);
        assert!(math::sqrt_u128(9) == 3, 4);
        assert!(math::sqrt_u128(100) == 10, 5);
        assert!(math::sqrt_u128(10000) == 100, 6);
    }

    #[test]
    fun test_btc_ratio_at_center_is_50pct() {
        let low: u128 = 100;
        let high: u128 = 200;
        let cur: u128 = 150;
        assert!(math::btc_ratio_bps(cur, low, high) == 5000, 1);
    }

    #[test]
    fun test_btc_ratio_at_upper_is_zero() {
        let low: u128 = 100;
        let high: u128 = 200;
        let cur: u128 = 200;
        assert!(math::btc_ratio_bps(cur, low, high) == 0, 1);
    }

    #[test]
    fun test_btc_ratio_at_lower_is_100pct() {
        let low: u128 = 100;
        let high: u128 = 200;
        let cur: u128 = 100;
        assert!(math::btc_ratio_bps(cur, low, high) == 10000, 1);
    }

    #[test]
    fun test_sqrt_bps_band_brackets_current() {
        let cur: u128 = 1_000_000_000_000_000_000;
        let (lo, hi) = math::sqrt_bps_band_around_current(cur, 500);
        assert!(lo < cur && cur < hi, 1);
        assert!(math::btc_ratio_bps(cur, lo, hi) == 5000, 2);
    }
}
