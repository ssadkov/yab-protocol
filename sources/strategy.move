module yab::strategy {
    use yab::math;

    /// Hyperion CLMM range; ticks are u32 to match `pool_v3::open_position` (fill via pool tick math later).
    struct Range has copy, drop, store {
        tick_lower: u32,
        tick_upper: u32,
        sqrt_price_low: u128,
        sqrt_price_high: u128,
    }

    /// Tunable strategy parameters (stored in the vault).
    struct StrategyParams has copy, drop, store {
        /// Half-width of range in BPS of current price (e.g. 500 = ±5%)
        range_half_width_bps: u64,
        /// Minimum seconds since last rebalance (anti-spam)
        min_rebalance_interval_secs: u64,
        /// Deviation from center that triggers rebalance (BPS)
        rebalance_trigger_bps: u64,
        /// Max slippage on internal swaps (BPS)
        max_swap_slippage_bps: u64,
        /// Dust threshold: reinvest free reserves if above this BPS of TVL
        dust_reinvest_threshold_bps: u64,
    }

    /// Default conservative BTC/USDC band (~±5%).
    public fun default_params(): StrategyParams {
        StrategyParams {
            range_half_width_bps: 500,
            min_rebalance_interval_secs: 1800,
            rebalance_trigger_bps: 400,
            max_swap_slippage_bps: 30,
            dust_reinvest_threshold_bps: 10,
        }
    }

    /// Target range around oracle USD price. Tick fields are placeholders until `price_to_tick` + pool tick spacing land.
    public fun get_target_range(
        current_price_usd: u64,
        params: &StrategyParams,
    ): Range {
        let cur = (current_price_usd as u128);
        let half = cur * (params.range_half_width_bps as u128) / 10000;
        assert!(half <= cur, 0); // range_half_width_bps must be < 10000
        let price_low = cur - half;
        let price_high = cur + half;
        Range {
            tick_lower: 0,
            tick_upper: 0,
            sqrt_price_low: math::price_to_sqrt_q64(price_low as u64),
            sqrt_price_high: math::price_to_sqrt_q64(price_high as u64),
        }
    }

    /// Returns true when |current - center| / center >= trigger (BPS). If `center_price == 0`, returns true.
    public fun should_rebalance(
        current_price: u64,
        center_price: u64,
        params: &StrategyParams,
    ): bool {
        if (center_price == 0) {
            return true
        };
        let deviation = if (current_price > center_price) {
            (current_price - center_price) * 10000 / center_price
        } else {
            (center_price - current_price) * 10000 / center_price
        };
        deviation >= params.rebalance_trigger_bps
    }
}
