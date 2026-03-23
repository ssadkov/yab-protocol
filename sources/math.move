module yab::math {
    /// Integer square root (Babylonian method).
    public fun sqrt_u128(x: u128): u128 {
        if (x == 0) {
            return 0
        };
        let z = (x + 1) / 2;
        let y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        };
        y
    }

    /// Optimal BTC fraction to add to the position for the current sqrt price.
    /// All inputs are sqrt prices in Q64.64 (see pool / oracle integration).
    /// Returns ratio in basis points (0–10000).
    ///
    /// Build `[sqrt_low, sqrt_high]` in **pool sqrt space** (same as `pool_v3::current_tick_and_price`).
    /// Multiplicative ±`half_width_bps` on `sqrt_current` so `btc_ratio_bps` always has
    /// `sqrt_low <= sqrt_current <= sqrt_high` (oracle-derived sqrt is not comparable to pool sqrt).
    public fun sqrt_bps_band_around_current(sqrt_current: u128, half_width_bps: u64): (u128, u128) {
        assert!(sqrt_current > 0, 0);
        assert!(half_width_bps <= 10000, 0);
        let lo = sqrt_current * (10000u128 - (half_width_bps as u128)) / 10000;
        let hi = sqrt_current * (10000u128 + (half_width_bps as u128)) / 10000;
        (lo, hi)
    }

    /// Formula: (sqrt_high - sqrt_current) / (sqrt_high - sqrt_low)
    public fun btc_ratio_bps(
        sqrt_current: u128,
        sqrt_low: u128,
        sqrt_high: u128,
    ): u64 {
        assert!(sqrt_current >= sqrt_low && sqrt_current <= sqrt_high, 0);
        let numerator = sqrt_high - sqrt_current;
        let denominator = sqrt_high - sqrt_low;
        if (denominator == 0) {
            return 0
        };
        let ratio = numerator * 10000 / denominator;
        if (ratio > 10000) {
            10000
        } else {
            ratio as u64
        }
    }

    /// Convert USD price (8 decimals, e.g. satoshi-style units) to approximate Q64.64 sqrt price.
    /// This is a placeholder; align with Hyperion pool math before production.
    public fun price_to_sqrt_q64(price_usd: u64): u128 {
        let p128 = (price_usd as u128);
        sqrt_u128(p128) << 32
    }
}
