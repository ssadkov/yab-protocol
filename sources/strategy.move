module yab::strategy {
    use yab::math;

    /// u64::MAX as u128 — cap for oracle USD lane before casting to `u64` for `price_to_sqrt_q64`.
    const MAX_U64_AS_U128: u128 = 18446744073709551615;

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

    #[test_only]
    /// Same as `default_params` but with a custom half-width (for unit tests).
    public fun default_params_with_range_half_width(range_half_width_bps: u64): StrategyParams {
        StrategyParams {
            range_half_width_bps,
            min_rebalance_interval_secs: 1800,
            rebalance_trigger_bps: 400,
            max_swap_slippage_bps: 30,
            dust_reinvest_threshold_bps: 10,
        }
    }

    /// Convert oracle USD (u128 lane) to sqrt; cap at u64::MAX so `price_high = cur + half` never overflows u64.
    fun sqrt_price_from_usd_price(price: u128): u128 {
        let capped = if (price > MAX_U64_AS_U128) {
            MAX_U64_AS_U128
        } else {
            price
        };
        math::price_to_sqrt_q64(capped as u64)
    }

    /// Target range around oracle USD price. Tick fields are placeholders until `price_to_tick` + pool tick spacing land.
    public fun get_target_range(
        current_price_usd: u64,
        params: &StrategyParams,
    ): Range {
        let cur = (current_price_usd as u128);
        let half = cur * (params.range_half_width_bps as u128) / 10000;
        assert!(half <= cur, 0); // range_half_width_bps must be <= 10000
        let price_low = cur - half;
        let price_high = cur + half;
        Range {
            tick_lower: 0,
            tick_upper: 0,
            sqrt_price_low: sqrt_price_from_usd_price(price_low),
            sqrt_price_high: sqrt_price_from_usd_price(price_high),
        }
    }

    public fun range_sqrt_price_low(r: &Range): u128 {
        r.sqrt_price_low
    }

    public fun range_sqrt_price_high(r: &Range): u128 {
        r.sqrt_price_high
    }

    public fun max_swap_slippage_bps(params: &StrategyParams): u64 {
        params.max_swap_slippage_bps
    }

    public fun range_half_width_bps(params: &StrategyParams): u64 {
        params.range_half_width_bps
    }

    public fun min_rebalance_interval_secs(params: &StrategyParams): u64 {
        params.min_rebalance_interval_secs
    }

    /// Governance: update range width, rebalance trigger, and swap slippage; other fields unchanged.
    public fun update_params_from_governance(
        params: &mut StrategyParams,
        range_half_width_bps: u64,
        rebalance_trigger_bps: u64,
        max_swap_slippage_bps: u64,
    ) {
        params.range_half_width_bps = range_half_width_bps;
        params.rebalance_trigger_bps = rebalance_trigger_bps;
        params.max_swap_slippage_bps = max_swap_slippage_bps;
    }

    /// Returns true when |current - center| / center >= trigger (BPS). If `center_price == 0`, returns true.
    /// Uses u128 for the BPS ratio so `(diff * 10000)` cannot overflow u64 for extreme `center_price` values.
    public fun should_rebalance(
        current_price: u64,
        center_price: u64,
        params: &StrategyParams,
    ): bool {
        if (center_price == 0) {
            return true
        };
        let deviation_bps = if (current_price > center_price) {
            ((current_price - center_price) as u128) * 10000u128 / (center_price as u128)
        } else {
            ((center_price - current_price) as u128) * 10000u128 / (center_price as u128)
        };
        deviation_bps >= (params.rebalance_trigger_bps as u128)
    }
}
