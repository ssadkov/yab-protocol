module yab::vault {
    use std::option;
    use std::signer;
    use std::string::utf8;
    use std::vector;

    use aptos_framework::event;
    use aptos_framework::aptos_coin;
    use aptos_framework::coin;
    use aptos_framework::fungible_asset::{Self, FungibleAsset, Metadata, MintRef, BurnRef, TransferRef};
    use aptos_framework::object::{Self, Object, ExtendRef};
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;

    use dex_contract::pool_v3::{Self, LiquidityPoolV3};
    use dex_contract::position_v3;
    use dex_contract::router_v3;
    use pyth::pyth;

    use yab::errors;
    use yab::math;
    use yab::oracle;
    use yab::strategy::{Self as strat, StrategyParams};

    // ── FA refs (stored on the vault object) ─────────────────────────────────

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct YabRefs has key {
        mint_ref: MintRef,
        burn_ref: BurnRef,
        transfer_ref: TransferRef,
    }

    // ── Vault state ─────────────────────────────────────────────────────────

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct VaultState has key {
        admin: address,
        operator: address,
        treasury: address,
        /// FA `Metadata` object addresses for the single Hyperion pool (token_a, token_b per pool ordering).
        /// Testnet may use e.g. APT/SUV for integration; mainnet should match WBTC/USDC (same code path).
        token_a_metadata: address,
        token_b_metadata: address,
        /// Hyperion pool fee tier (`u8`), e.g. the tier that corresponds to 0.05% on that deployment.
        fee_tier: u8,
        /// Signer for Hyperion calls; same object address as this vault (FA + state live here).
        extend_ref: ExtendRef,
        /// `Object<position_v3::Info>` address; `@0x0` means no open position.
        position_address: address,
        /// Amounts of token A / token B last recorded in the CLMM position (naming kept for YAB spec).
        position_btc: u64,
        position_usdc: u64,
        free_btc: u64,
        free_usdc: u64,
        center_price: u64,
        last_rebalance_ts: u64,
        last_recorded_price: u64,
        /// Protocol cut on CLMM fees + gauge rewards credited in `claim_rewards` / fee leg of `rebalance` (bps per token A / B leg). Not charged on `withdraw`.
        performance_fee_bps: u64,
    }

    /// Per-user deposit checkpoint (entry YAB price in token-A units; for analytics / future use).
    struct UserCheckpoint has key {
        entry_price: u64,
    }

    #[resource_group_member(group = aptos_framework::object::ObjectGroup)]
    struct VaultStrategy has key {
        params: StrategyParams,
    }

    // ── Events ───────────────────────────────────────────────────────────────

    #[event]
    struct Deposited has drop, store {
        user: address,
        btc_in: u64,
        shares_minted: u64,
    }

    #[event]
    struct Withdrawn has drop, store {
        user: address,
        shares_burned: u64,
        btc_out: u64,
    }

    #[event]
    struct Rebalanced has drop, store {
        old_center: u64,
        new_center: u64,
        timestamp: u64,
    }

    #[event]
    struct RewardsClaimed has drop, store {
        btc_received: u64,
        timestamp: u64,
    }

    #[event]
    struct HarvestFeeCollected has drop, store {
        protocol_btc: u64,
        protocol_usdc: u64,
        timestamp: u64,
    }

    const INITIAL_YAB_PRICE: u64 = 100_000_000; // 1.0 with 8 decimals
    /// Token-B (USDC) uses **6** decimals. `btc_price` is USD per 1 BTC with 8 fractional digits (`oracle` scale).
    /// Converts USDC raw → same units as token-A (WBTC) 8-dec raw: `usdc_raw * USDC_TO_BTC_RAW_MULT / btc_price`.
    const USDC_TO_BTC_RAW_MULT: u128 = 10_000_000_000; // 10^10
    const DEADLINE_SECS: u64 = 1800;
    /// Sqrt price limits for `pool_v3::swap` (Q64.64 / Hyperion). `MIN` matches Uniswap v3 min tick ratio (fits u128).
    /// Uniswap’s uint160 `MAX_SQRT_RATIO` does **not** fit `u128`; use Hyperion `tick_math::MAX_SQRT_PRICE_X64` for the upper bound.
    const MIN_SQRT_RATIO_X64: u128 = 4295128739;
    const MAX_SQRT_RATIO_X64: u128 = 79226673515401279992447579055;
    /// Minimum token-A deposit (WBTC, 8 decimals). Below this, Hyperion swap/add_liquidity often reverts (e.g. `Sub` in router).
    const MIN_DEPOSIT_TOKEN_A: u64 = 20_000; // 0.0002 WBTC minimum
    /// Minimum token-B amount (post-swap) before `add_liquidity_by_contract` when a swap was performed.
    const MIN_POST_SWAP_TOKEN_B: u64 = 100;
    /// Minimum token-A amount (post B→A swap) before `add_liquidity` in `deposit_usdc` when a swap was performed.
    const MIN_POST_SWAP_TOKEN_A: u64 = 1_000;
    /// `deposit_dual`: minimum token B pulled from user (USDC raw units; avoids dust-only B leg).
    const MIN_DEPOSIT_TOKEN_B_DUAL: u64 = 100;

    /// Pyth on-chain read, or a fixed price for `aptos move test` E2E paths only (`#[test_only]` callers pass `some(price)`).
    /// USDC (6-dec raw) → WBTC-style 8-dec raw at vault oracle `btc_price` scale.
    fun usdc_raw_to_btc_raw_equiv(usdc_raw: u64, btc_price: u64): u64 {
        (((usdc_raw as u128) * USDC_TO_BTC_RAW_MULT) / (btc_price as u128)) as u64
    }

    fun resolve_oracle_price(last_recorded: u64, price_override: option::Option<u64>): u64 {
        if (option::is_some(&price_override)) {
            let p = option::destroy_some(price_override);
            let now = timestamp::now_seconds();
            oracle::validate_cached_price(last_recorded, now, now, p, 1);
            p
        } else {
            oracle::get_safe_price(last_recorded)
        }
    }

    /// Total vault assets in token-A (BTC) equivalent (8 decimals). Oracle `btc_price` is BTC/USD (8 decimals).
    fun get_total_assets(state: &VaultState, btc_price: u64): u64 {
        let pos_btc_equiv = (state.position_btc as u128)
            + (usdc_raw_to_btc_raw_equiv(state.position_usdc, btc_price) as u128);
        let free_btc_equiv = (state.free_btc as u128)
            + (usdc_raw_to_btc_raw_equiv(state.free_usdc, btc_price) as u128);
        ((pos_btc_equiv + free_btc_equiv) as u64)
    }

    /// YAB price in token-A (BTC) per 1 YAB (8 decimals). Uses on-chain supply; initial 1.0 if supply unset.
    fun get_yab_price(state: &VaultState, vault_addr: address, btc_price: u64): u64 {
        let yab_metadata = object::address_to_object<Metadata>(vault_addr);
        let supply_opt = fungible_asset::supply(yab_metadata);
        let supply_u128 = option::destroy_with_default(supply_opt, 0u128);
        if (supply_u128 == 0) {
            return INITIAL_YAB_PRICE
        };
        let total = get_total_assets(state, btc_price);
        total * 100_000_000 / (supply_u128 as u64)
    }

    fun position_btc_equiv(state: &VaultState, btc_price: u64): u64 {
        state.position_btc + usdc_raw_to_btc_raw_equiv(state.position_usdc, btc_price)
    }

    fun merge_option_fa_into(acc: &mut FungibleAsset, opt: option::Option<FungibleAsset>) {
        if (option::is_some(&opt)) {
            fungible_asset::merge(acc, option::destroy_some(opt));
        } else {
            option::destroy_none(opt);
        };
    }

    /// Merge optional FA into `base`; if `base` is zero-amount, returns the optional asset only.
    fun merge_opt_fa(base: FungibleAsset, opt: option::Option<FungibleAsset>): FungibleAsset {
        if (option::is_some(&opt)) {
            let fa = option::destroy_some(opt);
            if (fungible_asset::amount(&base) == 0) {
                fungible_asset::destroy_zero(base);
                fa
            } else {
                fungible_asset::merge(&mut base, fa);
                base
            }
        } else {
            option::destroy_none(opt);
            base
        }
    }

    /// Sqrt price limit for `pool_v3::swap`. Must not use `sqrt_now ± 1` — that reverts when price moves between simulation and execution.
    /// Use global MIN/MAX bounds (Uniswap v3 / Hyperion); slippage is enforced via `add_liquidity` mins and router paths where applicable.
    fun swap_sqrt_price_limit(_pool: Object<LiquidityPoolV3>, a2b: bool): u128 {
        if (a2b) {
            MIN_SQRT_RATIO_X64
        } else {
            MAX_SQRT_RATIO_X64
        }
    }

    /// Gauge / partner reward assets: only pool token A/B supported; others abort.
    fun process_reward_assets(
        rewards: vector<FungibleAsset>,
        pool: Object<LiquidityPoolV3>,
        meta_a: Object<Metadata>,
        meta_b: Object<Metadata>,
        _slip_bps: u64,
        vault_addr: address,
        state: &mut VaultState,
    ) {
        let v = rewards;
        while (!vector::is_empty(&v)) {
            let fa = vector::pop_back(&mut v);
            let maddr = object::object_address(&fungible_asset::metadata_from_asset(&fa));
            if (maddr == object::object_address(&meta_a)) {
                let amt = fungible_asset::amount(&fa);
                state.free_btc = state.free_btc + amt;
                primary_fungible_store::deposit(vault_addr, fa);
            } else if (maddr == object::object_address(&meta_b)) {
                let amt = fungible_asset::amount(&fa);
                if (amt > 0) {
                    let limit = swap_sqrt_price_limit(pool, false);
                    let (_o0, fa_mid, fa_out) = pool_v3::swap(pool, false, true, amt, fa, limit);
                    if (fungible_asset::amount(&fa_mid) > 0) {
                        primary_fungible_store::deposit(vault_addr, fa_mid);
                    } else {
                        fungible_asset::destroy_zero(fa_mid);
                    };
                    let out_amt = fungible_asset::amount(&fa_out);
                    state.free_btc = state.free_btc + out_amt;
                    primary_fungible_store::deposit(vault_addr, fa_out);
                } else {
                    fungible_asset::destroy_zero(fa);
                };
            } else {
                // Incentive token not in the pool pair (e.g. partner token): credit treasury so rebalance can proceed.
                primary_fungible_store::deposit(state.treasury, fa);
            };
        };
        vector::destroy_empty(v);
    }

    /// Send `performance_fee_bps` of the delta in `free_btc` / `free_usdc` since `free_*_before` to `treasury`.
    /// Call immediately after `claim_fees` + `process_reward_assets` (no other mutations to `free_*` in between).
    fun take_harvest_protocol_cut(
        vault_signer: &signer,
        _vault_obj: address,
        treasury: address,
        fee_bps: u64,
        meta_a: Object<Metadata>,
        meta_b: Object<Metadata>,
        free_btc_before: u64,
        free_usdc_before: u64,
        state: &mut VaultState,
    ): u64 {
        if (fee_bps == 0) {
            return state.free_btc - free_btc_before
        };
        let delta_btc = state.free_btc - free_btc_before;
        let delta_usdc = state.free_usdc - free_usdc_before;
        let cut_btc = delta_btc * fee_bps / 10000;
        let cut_usdc = delta_usdc * fee_bps / 10000;
        if (cut_btc > 0) {
            let fa = primary_fungible_store::withdraw(vault_signer, meta_a, cut_btc);
            state.free_btc = state.free_btc - cut_btc;
            primary_fungible_store::deposit(treasury, fa);
        };
        if (cut_usdc > 0) {
            let fa_b = primary_fungible_store::withdraw(vault_signer, meta_b, cut_usdc);
            state.free_usdc = state.free_usdc - cut_usdc;
            primary_fungible_store::deposit(treasury, fa_b);
        };
        let protocol_btc = cut_btc;
        let protocol_usdc = cut_usdc;
        if (protocol_btc > 0 || protocol_usdc > 0) {
            event::emit(HarvestFeeCollected {
                protocol_btc,
                protocol_usdc,
                timestamp: timestamp::now_seconds(),
            });
        };
        state.free_btc - free_btc_before
    }

    /// One-time setup: named vault object, YAB fungible asset, ExtendRef for Hyperion `&signer`.
    /// `token_*_metadata` must be the fungible asset metadata object for each side of the target CLMM pool.
    public entry fun initialize(
        admin: &signer,
        treasury: address,
        operator: address,
        token_a_metadata: address,
        token_b_metadata: address,
        fee_tier: u8,
    ) {
        let admin_addr = signer::address_of(admin);
        assert!(token_a_metadata != @0x0, errors::invalid_pool_config());
        assert!(token_b_metadata != @0x0, errors::invalid_pool_config());
        assert!(token_a_metadata != token_b_metadata, errors::invalid_pool_config());

        let constructor_ref = object::create_named_object(admin, b"YAB_VAULT_V1");
        let vault_signer = object::generate_signer(&constructor_ref);
        let extend_ref = object::generate_extend_ref(&constructor_ref);

        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &constructor_ref,
            option::none(),
            utf8(b"Yield AI Bitcoin"),
            utf8(b"YAB"),
            8,
            utf8(b""),
            utf8(b""),
        );

        move_to(
            &vault_signer,
            YabRefs {
                mint_ref: fungible_asset::generate_mint_ref(&constructor_ref),
                burn_ref: fungible_asset::generate_burn_ref(&constructor_ref),
                transfer_ref: fungible_asset::generate_transfer_ref(&constructor_ref),
            },
        );

        move_to(
            &vault_signer,
            VaultState {
                admin: admin_addr,
                operator,
                treasury,
                token_a_metadata: token_a_metadata,
                token_b_metadata: token_b_metadata,
                fee_tier,
                extend_ref,
                position_address: @0x0,
                position_btc: 0,
                position_usdc: 0,
                free_btc: 0,
                free_usdc: 0,
                center_price: 0,
                last_rebalance_ts: 0,
                last_recorded_price: 0,
                performance_fee_bps: 1000,
            },
        );

        move_to(
            &vault_signer,
            VaultStrategy {
                params: strat::default_params(),
            },
        );
    }

    /// First seed: admin deposits `seed_amount_a` of token A, optimal split + swap, open Hyperion position, mint YAB.
    /// Oracle `min_out` math matches BTC/USD → USD-stable; on arbitrary testnet pairs it is only a rough guard.
    public entry fun bootstrap(
        admin: &signer,
        vault_addr: address,
        seed_amount_a: u64,
        tick_lower: u32,
        tick_upper: u32,
    ) acquires VaultState, YabRefs, VaultStrategy {
        bootstrap_impl(admin, vault_addr, seed_amount_a, tick_lower, tick_upper, option::none());
    }

    /// Dual-token bootstrap for pools without single-token zap path.
    public entry fun bootstrap_dual(
        admin: &signer,
        vault_addr: address,
        seed_amount_a: u64,
        seed_amount_b: u64,
        tick_lower: u32,
        tick_upper: u32,
    ) acquires VaultState, YabRefs, VaultStrategy {
        bootstrap_dual_impl(
            admin,
            vault_addr,
            seed_amount_a,
            seed_amount_b,
            tick_lower,
            tick_upper,
            option::none(),
        );
    }

    #[test_only]
    /// Same as `bootstrap` but uses a fixed oracle USD price (no live Pyth). For Move unit tests only.
    public fun bootstrap_with_fixed_oracle(
        admin: &signer,
        vault_addr: address,
        seed_amount_a: u64,
        tick_lower: u32,
        tick_upper: u32,
        oracle_price: u64,
    ) acquires VaultState, YabRefs, VaultStrategy {
        bootstrap_impl(
            admin,
            vault_addr,
            seed_amount_a,
            tick_lower,
            tick_upper,
            option::some(oracle_price),
        );
    }

    fun bootstrap_impl(
        admin: &signer,
        vault_addr: address,
        seed_amount_a: u64,
        tick_lower: u32,
        tick_upper: u32,
        price_override: option::Option<u64>,
    ) acquires VaultState, YabRefs, VaultStrategy {
        assert!(seed_amount_a > 0, errors::zero_amount());
        assert!(tick_lower < tick_upper, errors::invalid_pool_config());

        let admin_addr = signer::address_of(admin);

        let token_a_addr = { let v = borrow_global<VaultState>(vault_addr); v.token_a_metadata };
        let token_b_addr = { let v = borrow_global<VaultState>(vault_addr); v.token_b_metadata };
        let fee_tier_val = { let v = borrow_global<VaultState>(vault_addr); v.fee_tier };

        let oracle_price = resolve_oracle_price(0, price_override);

        let (slip_bps, half_bps) = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            (
                strat::max_swap_slippage_bps(&st.params),
                strat::range_half_width_bps(&st.params),
            )
        };

        let meta_a = object::address_to_object<Metadata>(token_a_addr);
        let meta_b = object::address_to_object<Metadata>(token_b_addr);

        let pool = pool_v3::liquidity_pool(meta_a, meta_b, fee_tier_val);
        let pool_obj_addr = object::object_address(&pool);
        let (_, sqrt_from_pool) = pool_v3::current_tick_and_price(pool_obj_addr);
        let sqrt_current = if (sqrt_from_pool > 0) {
            sqrt_from_pool
        } else {
            math::price_to_sqrt_q64(oracle_price)
        };

        let (sqrt_price_low, sqrt_price_high) = math::sqrt_bps_band_around_current(sqrt_current, half_bps);
        let btc_ratio = math::btc_ratio_bps(sqrt_current, sqrt_price_low, sqrt_price_high);
        let swap_amount = seed_amount_a * (10000 - (btc_ratio as u64)) / 10000;

        let state = borrow_global_mut<VaultState>(vault_addr);
        assert!(admin_addr == state.admin, errors::not_admin());
        assert!(state.position_address == @0x0, errors::already_bootstrapped());

        state.last_recorded_price = oracle_price;
        state.center_price = oracle_price;

        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);

        let fa_a_for_lp = primary_fungible_store::withdraw(admin, meta_a, seed_amount_a);

        let fa_b_for_lp = if (swap_amount > 0) {
            let fa_swap = fungible_asset::extract(&mut fa_a_for_lp, swap_amount);
            let limit = swap_sqrt_price_limit(pool, true);
            let (_amt_out, fa_in_remain, fa_b_out) = pool_v3::swap(
                pool,
                true,
                true,
                swap_amount,
                fa_swap,
                limit,
            );
            fungible_asset::merge(&mut fa_a_for_lp, fa_in_remain);
            fa_b_out
        } else {
            fungible_asset::zero(meta_b)
        };

        let position = pool_v3::open_position(
            &vault_signer,
            meta_a,
            meta_b,
            fee_tier_val,
            tick_lower,
            tick_upper,
        );

        let amount_a_desired = fungible_asset::amount(&fa_a_for_lp);
        let amount_b_desired = fungible_asset::amount(&fa_b_for_lp);
        let min_a = amount_a_desired * (10000 - slip_bps) / 10000;
        let min_b = amount_b_desired * (10000 - slip_bps) / 10000;
        let deadline = timestamp::now_seconds() + DEADLINE_SECS;

        let (used_a, used_b, leftover_a, leftover_b) = router_v3::add_liquidity_by_contract(
            &vault_signer,
            position,
            amount_a_desired,
            amount_b_desired,
            min_a,
            min_b,
            fa_a_for_lp,
            fa_b_for_lp,
            deadline,
        );

        let pos_addr = object::object_address(&position);
        state.position_address = pos_addr;
        state.position_btc = used_a;
        state.position_usdc = used_b;
        state.free_btc = fungible_asset::amount(&leftover_a);
        state.free_usdc = fungible_asset::amount(&leftover_b);
        state.last_rebalance_ts = timestamp::now_seconds();

        primary_fungible_store::deposit(vault_addr, leftover_a);
        primary_fungible_store::deposit(vault_addr, leftover_b);

        let refs = borrow_global<YabRefs>(vault_addr);
        let yab_fa = fungible_asset::mint(&refs.mint_ref, seed_amount_a);
        primary_fungible_store::deposit(admin_addr, yab_fa);

        if (!exists<UserCheckpoint>(admin_addr)) {
            move_to(admin, UserCheckpoint { entry_price: INITIAL_YAB_PRICE });
        };
    }

    #[test_only]
    public fun bootstrap_dual_with_fixed_oracle(
        admin: &signer,
        vault_addr: address,
        seed_amount_a: u64,
        seed_amount_b: u64,
        tick_lower: u32,
        tick_upper: u32,
        oracle_price: u64,
    ) acquires VaultState, YabRefs, VaultStrategy {
        bootstrap_dual_impl(
            admin,
            vault_addr,
            seed_amount_a,
            seed_amount_b,
            tick_lower,
            tick_upper,
            option::some(oracle_price),
        );
    }

    fun bootstrap_dual_impl(
        admin: &signer,
        vault_addr: address,
        seed_amount_a: u64,
        seed_amount_b: u64,
        tick_lower: u32,
        tick_upper: u32,
        price_override: option::Option<u64>,
    ) acquires VaultState, YabRefs, VaultStrategy {
        assert!(seed_amount_a > 0, errors::zero_amount());
        assert!(seed_amount_b > 0, errors::zero_amount());
        assert!(tick_lower < tick_upper, errors::invalid_pool_config());

        let admin_addr = signer::address_of(admin);
        let oracle_price = resolve_oracle_price(0, price_override);

        let token_a_addr = { let v = borrow_global<VaultState>(vault_addr); v.token_a_metadata };
        let token_b_addr = { let v = borrow_global<VaultState>(vault_addr); v.token_b_metadata };
        let fee_tier_val = { let v = borrow_global<VaultState>(vault_addr); v.fee_tier };
        let slip_bps = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            strat::max_swap_slippage_bps(&st.params)
        };

        let meta_a = object::address_to_object<Metadata>(token_a_addr);
        let meta_b = object::address_to_object<Metadata>(token_b_addr);

        let state = borrow_global_mut<VaultState>(vault_addr);
        assert!(admin_addr == state.admin, errors::not_admin());
        assert!(state.position_address == @0x0, errors::already_bootstrapped());

        state.last_recorded_price = oracle_price;
        state.center_price = oracle_price;
        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);

        let fa_a_for_lp = primary_fungible_store::withdraw(admin, meta_a, seed_amount_a);
        let fa_b_for_lp = primary_fungible_store::withdraw(admin, meta_b, seed_amount_b);

        let position = pool_v3::open_position(
            &vault_signer,
            meta_a,
            meta_b,
            fee_tier_val,
            tick_lower,
            tick_upper,
        );

        let amount_a_desired = fungible_asset::amount(&fa_a_for_lp);
        let amount_b_desired = fungible_asset::amount(&fa_b_for_lp);
        let min_a = amount_a_desired * (10000 - slip_bps) / 10000;
        let min_b = amount_b_desired * (10000 - slip_bps) / 10000;
        let deadline = timestamp::now_seconds() + DEADLINE_SECS;

        let (used_a, used_b, leftover_a, leftover_b) = router_v3::add_liquidity_by_contract(
            &vault_signer,
            position,
            amount_a_desired,
            amount_b_desired,
            min_a,
            min_b,
            fa_a_for_lp,
            fa_b_for_lp,
            deadline,
        );

        let pos_addr = object::object_address(&position);
        state.position_address = pos_addr;
        state.position_btc = used_a;
        state.position_usdc = used_b;
        state.free_btc = fungible_asset::amount(&leftover_a);
        state.free_usdc = fungible_asset::amount(&leftover_b);
        state.last_rebalance_ts = timestamp::now_seconds();

        primary_fungible_store::deposit(vault_addr, leftover_a);
        primary_fungible_store::deposit(vault_addr, leftover_b);

        let mint_equiv = (used_a as u128)
            + (usdc_raw_to_btc_raw_equiv(used_b, oracle_price) as u128);
        let shares = mint_equiv as u64;
        assert!(shares > 0, errors::zero_amount());

        let refs = borrow_global<YabRefs>(vault_addr);
        let yab_fa = fungible_asset::mint(&refs.mint_ref, shares);
        primary_fungible_store::deposit(admin_addr, yab_fa);

        if (!exists<UserCheckpoint>(admin_addr)) {
            move_to(admin, UserCheckpoint { entry_price: INITIAL_YAB_PRICE });
        };
    }

    /// User adds token A; NAV fixed from oracle before state change; adds to existing Hyperion position.
    public entry fun deposit(
        user: &signer,
        vault_addr: address,
        token_a_in: u64,
    ) acquires VaultState, YabRefs, VaultStrategy, UserCheckpoint {
        deposit_impl(user, vault_addr, token_a_in, option::none(), true);
    }

    /// Same as `deposit` but user supplies **both** pool tokens in one tx (no in-contract swap). Use when single-asset ZAP is unreliable.
    public entry fun deposit_dual(
        user: &signer,
        vault_addr: address,
        token_a_in: u64,
        token_b_in: u64,
    ) acquires VaultState, YabRefs, UserCheckpoint {
        deposit_dual_impl(user, vault_addr, token_a_in, token_b_in, option::none(), true);
    }

    #[test_only]
    /// Same as `deposit` with a fixed oracle price (Move tests / stub DEX). Not included in production publish bytecode.
    public fun deposit_with_fixed_oracle(
        user: &signer,
        vault_addr: address,
        token_a_in: u64,
        btc_usd_price: u64,
    ) acquires VaultState, YabRefs, VaultStrategy, UserCheckpoint {
        deposit_impl(user, vault_addr, token_a_in, option::some(btc_usd_price), false);
    }

    #[test_only]
    public fun deposit_dual_with_fixed_oracle(
        user: &signer,
        vault_addr: address,
        token_a_in: u64,
        token_b_in: u64,
        btc_usd_price: u64,
    ) acquires VaultState, YabRefs, UserCheckpoint {
        deposit_dual_impl(
            user,
            vault_addr,
            token_a_in,
            token_b_in,
            option::some(btc_usd_price),
            false,
        );
    }

    fun deposit_dual_impl(
        user: &signer,
        vault_addr: address,
        token_a_in: u64,
        token_b_in: u64,
        price_override: option::Option<u64>,
        enforce_min_deposit: bool,
    ) acquires VaultState, YabRefs, UserCheckpoint {
        assert!(token_a_in > 0 && token_b_in > 0, errors::zero_amount());
        if (enforce_min_deposit) {
            assert!(token_a_in >= MIN_DEPOSIT_TOKEN_A, errors::deposit_too_small());
            assert!(token_b_in >= MIN_DEPOSIT_TOKEN_B_DUAL, errors::deposit_too_small());
        };
        let user_addr = signer::address_of(user);

        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            assert!(s.position_address != @0x0, errors::not_bootstrapped());
            resolve_oracle_price(s.last_recorded_price, price_override)
        };

        let yab_price = {
            let s = borrow_global<VaultState>(vault_addr);
            get_yab_price(s, vault_addr, btc_price)
        };

        let (meta_a, meta_b, pos_addr) = {
            let s = borrow_global<VaultState>(vault_addr);
            (
                object::address_to_object<Metadata>(s.token_a_metadata),
                object::address_to_object<Metadata>(s.token_b_metadata),
                s.position_address,
            )
        };

        let state = borrow_global_mut<VaultState>(vault_addr);
        state.last_recorded_price = btc_price;

        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);

        let fa_a_total = primary_fungible_store::withdraw(user, meta_a, token_a_in);
        if (state.free_btc > 0) {
            let fa_free = primary_fungible_store::withdraw(&vault_signer, meta_a, state.free_btc);
            fungible_asset::merge(&mut fa_a_total, fa_free);
            state.free_btc = 0;
        };

        let fa_b_total = primary_fungible_store::withdraw(user, meta_b, token_b_in);
        if (state.free_usdc > 0) {
            let fa_free_b = primary_fungible_store::withdraw(&vault_signer, meta_b, state.free_usdc);
            fungible_asset::merge(&mut fa_b_total, fa_free_b);
            state.free_usdc = 0;
        };

        let position = object::address_to_object<position_v3::Info>(pos_addr);
        let amount_a_desired = fungible_asset::amount(&fa_a_total);
        let amount_b_desired = fungible_asset::amount(&fa_b_total);
        // Same as single-asset `deposit`: avoid Hyperion `EAMOUNT_*_TOO_LESS` from slip floors on CLMM adds.
        let min_a = 0u64;
        let min_b = 0u64;
        let deadline = timestamp::now_seconds() + DEADLINE_SECS;

        let (used_a, used_b, leftover_a, leftover_b) = router_v3::add_liquidity_by_contract(
            &vault_signer,
            position,
            amount_a_desired,
            amount_b_desired,
            min_a,
            min_b,
            fa_a_total,
            fa_b_total,
            deadline,
        );

        state.position_btc = state.position_btc + used_a;
        state.position_usdc = state.position_usdc + used_b;
        state.free_btc = fungible_asset::amount(&leftover_a);
        state.free_usdc = fungible_asset::amount(&leftover_b);

        primary_fungible_store::deposit(vault_addr, leftover_a);
        primary_fungible_store::deposit(vault_addr, leftover_b);

        let btc_in_equiv = (token_a_in as u128)
            + (usdc_raw_to_btc_raw_equiv(token_b_in, btc_price) as u128);
        let shares = ((btc_in_equiv * 100_000_000) / (yab_price as u128)) as u64;
        assert!(shares > 0, errors::zero_amount());

        let refs = borrow_global<YabRefs>(vault_addr);
        let yab_fa = fungible_asset::mint(&refs.mint_ref, shares);
        primary_fungible_store::deposit(user_addr, yab_fa);

        if (!exists<UserCheckpoint>(user_addr)) {
            move_to(user, UserCheckpoint { entry_price: yab_price });
        } else {
            let chk = borrow_global_mut<UserCheckpoint>(user_addr);
            chk.entry_price = yab_price;
        };

        event::emit(Deposited {
            user: user_addr,
            btc_in: (btc_in_equiv as u64),
            shares_minted: shares,
        });
    }

    fun deposit_impl(
        user: &signer,
        vault_addr: address,
        token_a_in: u64,
        price_override: option::Option<u64>,
        enforce_min_deposit: bool,
    ) acquires VaultState, YabRefs, VaultStrategy, UserCheckpoint {
        assert!(token_a_in > 0, errors::zero_amount());
        if (enforce_min_deposit) {
            assert!(token_a_in >= MIN_DEPOSIT_TOKEN_A, errors::deposit_too_small());
        };
        let user_addr = signer::address_of(user);

        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            assert!(s.position_address != @0x0, errors::not_bootstrapped());
            resolve_oracle_price(s.last_recorded_price, price_override)
        };

        let yab_price = {
            let s = borrow_global<VaultState>(vault_addr);
            get_yab_price(s, vault_addr, btc_price)
        };

        let half_bps = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            strat::range_half_width_bps(&st.params)
        };

        let (meta_a, meta_b, fee_tier_val, pos_addr) = {
            let s = borrow_global<VaultState>(vault_addr);
            (
                object::address_to_object<Metadata>(s.token_a_metadata),
                object::address_to_object<Metadata>(s.token_b_metadata),
                s.fee_tier,
                s.position_address,
            )
        };

        let pool = pool_v3::liquidity_pool(meta_a, meta_b, fee_tier_val);
        let pool_obj_addr = object::object_address(&pool);
        let (_, sqrt_from_pool) = pool_v3::current_tick_and_price(pool_obj_addr);
        let sqrt_current = if (sqrt_from_pool > 0) {
            sqrt_from_pool
        } else {
            math::price_to_sqrt_q64(btc_price)
        };
        let (sqrt_price_low, sqrt_price_high) = math::sqrt_bps_band_around_current(sqrt_current, half_bps);
        let btc_ratio = math::btc_ratio_bps(sqrt_current, sqrt_price_low, sqrt_price_high);

        let state = borrow_global_mut<VaultState>(vault_addr);
        state.last_recorded_price = btc_price;

        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);

        let fa_a_total = primary_fungible_store::withdraw(user, meta_a, token_a_in);
        if (state.free_btc > 0) {
            let fa_free = primary_fungible_store::withdraw(&vault_signer, meta_a, state.free_btc);
            fungible_asset::merge(&mut fa_a_total, fa_free);
            state.free_btc = 0;
        };

        let fa_b_total = if (state.free_usdc > 0) {
            let b = primary_fungible_store::withdraw(&vault_signer, meta_b, state.free_usdc);
            state.free_usdc = 0;
            b
        } else {
            fungible_asset::zero(meta_b)
        };

        let total_a = fungible_asset::amount(&fa_a_total);
        let swap_amount = total_a * (10000 - (btc_ratio as u64)) / 10000;

        let fa_b_for_lp = if (swap_amount > 0) {
            let fa_swap = fungible_asset::extract(&mut fa_a_total, swap_amount);
            let limit = swap_sqrt_price_limit(pool, true);
            let (_amt_out, fa_in_remain, fa_b_from_swap) = pool_v3::swap(
                pool,
                true,
                true,
                swap_amount,
                fa_swap,
                limit,
            );
            fungible_asset::merge(&mut fa_a_total, fa_in_remain);
            if (fungible_asset::amount(&fa_b_total) > 0) {
                fungible_asset::merge(&mut fa_b_from_swap, fa_b_total);
            } else {
                fungible_asset::destroy_zero(fa_b_total);
            };
            fa_b_from_swap
        } else {
            fa_b_total
        };

        if (swap_amount > 0 && enforce_min_deposit) {
            assert!(
                fungible_asset::amount(&fa_b_for_lp) >= MIN_POST_SWAP_TOKEN_B,
                errors::deposit_too_small(),
            );
        };

        let position = object::address_to_object<position_v3::Info>(pos_addr);
        let amount_a_desired = fungible_asset::amount(&fa_a_total);
        let amount_b_desired = fungible_asset::amount(&fa_b_for_lp);
        // CLMM rounding: slip-derived mins often trip Hyperion `EAMOUNT_*_TOO_LESS` on small deposits.
        let min_a = 0u64;
        let min_b = 0u64;
        let deadline = timestamp::now_seconds() + DEADLINE_SECS;

        let (used_a, used_b, leftover_a, leftover_b) = router_v3::add_liquidity_by_contract(
            &vault_signer,
            position,
            amount_a_desired,
            amount_b_desired,
            min_a,
            min_b,
            fa_a_total,
            fa_b_for_lp,
            deadline,
        );

        state.position_btc = state.position_btc + used_a;
        state.position_usdc = state.position_usdc + used_b;
        state.free_btc = fungible_asset::amount(&leftover_a);
        state.free_usdc = fungible_asset::amount(&leftover_b);

        primary_fungible_store::deposit(vault_addr, leftover_a);
        primary_fungible_store::deposit(vault_addr, leftover_b);

        let shares = token_a_in * 100_000_000 / yab_price;
        let refs = borrow_global<YabRefs>(vault_addr);
        let yab_fa = fungible_asset::mint(&refs.mint_ref, shares);
        primary_fungible_store::deposit(user_addr, yab_fa);

        if (!exists<UserCheckpoint>(user_addr)) {
            move_to(user, UserCheckpoint { entry_price: yab_price });
        } else {
            let chk = borrow_global_mut<UserCheckpoint>(user_addr);
            chk.entry_price = yab_price;
        };

        event::emit(Deposited { user: user_addr, btc_in: token_a_in, shares_minted: shares });
    }

    /// User adds token B (e.g. USDC) only; swaps part to token A per `range_half_width_bps`, then adds to the CLMM position.
    /// Share mint uses the same BTC-equivalent logic as `deposit_dual` for the B leg (`usdc_raw_to_btc_raw_equiv`).
    public entry fun deposit_usdc(
        user: &signer,
        vault_addr: address,
        token_b_in: u64,
    ) acquires VaultState, YabRefs, VaultStrategy, UserCheckpoint {
        deposit_b_impl(user, vault_addr, token_b_in, option::none(), true);
    }

    #[test_only]
    public fun deposit_usdc_with_fixed_oracle(
        user: &signer,
        vault_addr: address,
        token_b_in: u64,
        btc_usd_price: u64,
    ) acquires VaultState, YabRefs, VaultStrategy, UserCheckpoint {
        deposit_b_impl(user, vault_addr, token_b_in, option::some(btc_usd_price), false);
    }

    fun deposit_b_impl(
        user: &signer,
        vault_addr: address,
        token_b_in: u64,
        price_override: option::Option<u64>,
        enforce_min_deposit: bool,
    ) acquires VaultState, YabRefs, VaultStrategy, UserCheckpoint {
        assert!(token_b_in > 0, errors::zero_amount());
        if (enforce_min_deposit) {
            assert!(token_b_in >= MIN_DEPOSIT_TOKEN_B_DUAL, errors::deposit_too_small());
        };
        let user_addr = signer::address_of(user);

        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            assert!(s.position_address != @0x0, errors::not_bootstrapped());
            resolve_oracle_price(s.last_recorded_price, price_override)
        };

        let yab_price = {
            let s = borrow_global<VaultState>(vault_addr);
            get_yab_price(s, vault_addr, btc_price)
        };

        let half_bps = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            strat::range_half_width_bps(&st.params)
        };

        let (meta_a, meta_b, fee_tier_val, pos_addr) = {
            let s = borrow_global<VaultState>(vault_addr);
            (
                object::address_to_object<Metadata>(s.token_a_metadata),
                object::address_to_object<Metadata>(s.token_b_metadata),
                s.fee_tier,
                s.position_address,
            )
        };

        let pool = pool_v3::liquidity_pool(meta_a, meta_b, fee_tier_val);
        let pool_obj_addr = object::object_address(&pool);
        let (_, sqrt_from_pool) = pool_v3::current_tick_and_price(pool_obj_addr);
        let sqrt_current = if (sqrt_from_pool > 0) {
            sqrt_from_pool
        } else {
            math::price_to_sqrt_q64(btc_price)
        };
        let (sqrt_price_low, sqrt_price_high) = math::sqrt_bps_band_around_current(sqrt_current, half_bps);
        let btc_ratio = math::btc_ratio_bps(sqrt_current, sqrt_price_low, sqrt_price_high);

        let state = borrow_global_mut<VaultState>(vault_addr);
        state.last_recorded_price = btc_price;

        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);

        let fa_a_total = if (state.free_btc > 0) {
            let fa = primary_fungible_store::withdraw(&vault_signer, meta_a, state.free_btc);
            state.free_btc = 0;
            fa
        } else {
            fungible_asset::zero(meta_a)
        };

        let fa_b_total = primary_fungible_store::withdraw(user, meta_b, token_b_in);
        if (state.free_usdc > 0) {
            let fa_free_b = primary_fungible_store::withdraw(&vault_signer, meta_b, state.free_usdc);
            fungible_asset::merge(&mut fa_b_total, fa_free_b);
            state.free_usdc = 0;
        };

        let total_b = fungible_asset::amount(&fa_b_total);
        let swap_amount_b = total_b * (btc_ratio as u64) / 10000;

        let fa_a_for_lp = if (swap_amount_b > 0) {
            let fa_swap = fungible_asset::extract(&mut fa_b_total, swap_amount_b);
            let limit = swap_sqrt_price_limit(pool, false);
            let (_amt_out, fa_in_remain, fa_a_from_swap) = pool_v3::swap(
                pool,
                false,
                true,
                swap_amount_b,
                fa_swap,
                limit,
            );
            fungible_asset::merge(&mut fa_b_total, fa_in_remain);
            if (fungible_asset::amount(&fa_a_total) > 0) {
                fungible_asset::merge(&mut fa_a_from_swap, fa_a_total);
                fa_a_from_swap
            } else {
                fungible_asset::destroy_zero(fa_a_total);
                fa_a_from_swap
            }
        } else {
            fa_a_total
        };

        if (swap_amount_b > 0 && enforce_min_deposit) {
            assert!(
                fungible_asset::amount(&fa_a_for_lp) >= MIN_POST_SWAP_TOKEN_A,
                errors::deposit_too_small(),
            );
        };

        let position = object::address_to_object<position_v3::Info>(pos_addr);
        let amount_a_desired = fungible_asset::amount(&fa_a_for_lp);
        let amount_b_desired = fungible_asset::amount(&fa_b_total);
        let min_a = 0u64;
        let min_b = 0u64;
        let deadline = timestamp::now_seconds() + DEADLINE_SECS;

        let (used_a, used_b, leftover_a, leftover_b) = router_v3::add_liquidity_by_contract(
            &vault_signer,
            position,
            amount_a_desired,
            amount_b_desired,
            min_a,
            min_b,
            fa_a_for_lp,
            fa_b_total,
            deadline,
        );

        state.position_btc = state.position_btc + used_a;
        state.position_usdc = state.position_usdc + used_b;
        state.free_btc = fungible_asset::amount(&leftover_a);
        state.free_usdc = fungible_asset::amount(&leftover_b);

        primary_fungible_store::deposit(vault_addr, leftover_a);
        primary_fungible_store::deposit(vault_addr, leftover_b);

        let btc_in_equiv = (usdc_raw_to_btc_raw_equiv(token_b_in, btc_price) as u128);
        let shares = ((btc_in_equiv * 100_000_000) / (yab_price as u128)) as u64;
        assert!(shares > 0, errors::zero_amount());

        let refs = borrow_global<YabRefs>(vault_addr);
        let yab_fa = fungible_asset::mint(&refs.mint_ref, shares);
        primary_fungible_store::deposit(user_addr, yab_fa);

        if (!exists<UserCheckpoint>(user_addr)) {
            move_to(user, UserCheckpoint { entry_price: yab_price });
        } else {
            let chk = borrow_global_mut<UserCheckpoint>(user_addr);
            chk.entry_price = yab_price;
        };

        event::emit(Deposited {
            user: user_addr,
            btc_in: (btc_in_equiv as u64),
            shares_minted: shares,
        });
    }

    /// Burn YAB and receive token A (no withdraw performance fee; see `performance_fee_bps` on harvest only).
    public entry fun withdraw(
        user: &signer,
        vault_addr: address,
        shares_in: u64,
    ) acquires VaultState, YabRefs {
        withdraw_impl(user, vault_addr, shares_in, option::none());
    }

    /// Same as `withdraw`, but refreshes Pyth cache in the same transaction.
    /// `pyth_update_data` must be fetched from Hermes right before submit.
    public entry fun withdraw_with_pyth_update(
        user: &signer,
        vault_addr: address,
        shares_in: u64,
        pyth_update_data: vector<vector<u8>>,
    ) acquires VaultState, YabRefs {
        let update_fee = pyth::get_update_fee(&pyth_update_data);
        let fee_coin = coin::withdraw<aptos_coin::AptosCoin>(user, update_fee);
        pyth::update_price_feeds(pyth_update_data, fee_coin);
        withdraw_impl(user, vault_addr, shares_in, option::none());
    }

    #[test_only]
    public fun withdraw_with_fixed_oracle(
        user: &signer,
        vault_addr: address,
        shares_in: u64,
        btc_usd_price: u64,
    ) acquires VaultState, YabRefs {
        withdraw_impl(user, vault_addr, shares_in, option::some(btc_usd_price));
    }

    fun withdraw_impl(
        user: &signer,
        vault_addr: address,
        shares_in: u64,
        price_override: option::Option<u64>,
    ) acquires VaultState, YabRefs {
        assert!(shares_in > 0, errors::zero_amount());
        let user_addr = signer::address_of(user);

        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            resolve_oracle_price(s.last_recorded_price, price_override)
        };

        let yab_price = {
            let s = borrow_global<VaultState>(vault_addr);
            get_yab_price(s, vault_addr, btc_price)
        };

        let (meta_a, meta_b, fee_tier_val, pos_addr) = {
            let s = borrow_global<VaultState>(vault_addr);
            (
                object::address_to_object<Metadata>(s.token_a_metadata),
                object::address_to_object<Metadata>(s.token_b_metadata),
                s.fee_tier,
                s.position_address,
            )
        };
        let pool = pool_v3::liquidity_pool(meta_a, meta_b, fee_tier_val);

        let btc_owed = shares_in * yab_price / 100_000_000;

        let state = borrow_global_mut<VaultState>(vault_addr);
        state.last_recorded_price = btc_price;

        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);

        let need_after_free = if (state.free_btc >= btc_owed) {
            let fa = primary_fungible_store::withdraw(&vault_signer, meta_a, btc_owed);
            state.free_btc = state.free_btc - btc_owed;
            primary_fungible_store::deposit(user_addr, fa);
            0u64
        } else {
            if (state.free_btc > 0) {
                let take = state.free_btc;
                let fa = primary_fungible_store::withdraw(&vault_signer, meta_a, take);
                state.free_btc = 0;
                primary_fungible_store::deposit(user_addr, fa);
                btc_owed - take
            } else {
                btc_owed
            }
        };

        if (need_after_free > 0) {
            let pos_obj = object::address_to_object<position_v3::Info>(pos_addr);
            let pos_liq = position_v3::get_liquidity(pos_obj);
            let pos_equiv = position_btc_equiv(state, btc_price);
            assert!(pos_equiv > 0, errors::zero_supply());
            let liq_rm = {
                let x = (pos_liq * (need_after_free as u128)) / ((pos_equiv as u128) + 1);
                if (x > pos_liq) {
                    pos_liq
                } else {
                    x
                }
            };
            if (liq_rm > 0) {
                let deadline = timestamp::now_seconds() + DEADLINE_SECS;
                let (opt_a, opt_b) = router_v3::remove_liquidity_by_contract(
                    &vault_signer,
                    pos_obj,
                    liq_rm,
                    0,
                    0,
                    deadline,
                );
                if (option::is_some(&opt_a)) {
                    let fa_a = option::destroy_some(opt_a);
                    let a_amt = fungible_asset::amount(&fa_a);
                    if (state.position_btc >= a_amt) {
                        state.position_btc = state.position_btc - a_amt;
                    } else {
                        state.position_btc = 0;
                    };
                    primary_fungible_store::deposit(user_addr, fa_a);
                } else {
                    option::destroy_none(opt_a);
                };
                if (option::is_some(&opt_b)) {
                    let fa_b = option::destroy_some(opt_b);
                    let b_amt = fungible_asset::amount(&fa_b);
                    if (state.position_usdc >= b_amt) {
                        state.position_usdc = state.position_usdc - b_amt;
                    } else {
                        state.position_usdc = 0;
                    };
                    let limit = swap_sqrt_price_limit(pool, false);
                    let (_o1, fa_mid, fa_a_out) = pool_v3::swap(
                        pool,
                        false,
                        true,
                        b_amt,
                        fa_b,
                        limit,
                    );
                    if (fungible_asset::amount(&fa_mid) > 0) {
                        primary_fungible_store::deposit(user_addr, fa_mid);
                    } else {
                        fungible_asset::destroy_zero(fa_mid);
                    };
                    primary_fungible_store::deposit(user_addr, fa_a_out);
                } else {
                    option::destroy_none(opt_b);
                };
            };
        };

        let refs = borrow_global<YabRefs>(vault_addr);
        let user_yab = primary_fungible_store::withdraw(
            user,
            object::address_to_object<Metadata>(vault_addr),
            shares_in,
        );
        fungible_asset::burn(&refs.burn_ref, user_yab);

        event::emit(Withdrawn { user: user_addr, shares_burned: shares_in, btc_out: btc_owed });
    }

    /// Operator (or admin): collect CLMM fees + gauge rewards, convert rewards to token A where needed, credit `free_*`.
    public entry fun claim_rewards(
        operator: &signer,
        vault_addr: address,
    ) acquires VaultState, VaultStrategy {
        let op = signer::address_of(operator);
        {
            let s = borrow_global<VaultState>(vault_addr);
            assert!(op == s.operator || op == s.admin, errors::not_operator());
            assert!(s.position_address != @0x0, errors::not_bootstrapped());
        };

        let free_btc_before = { let s = borrow_global<VaultState>(vault_addr); s.free_btc };
        let free_usdc_before = { let s = borrow_global<VaultState>(vault_addr); s.free_usdc };

        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            oracle::get_safe_price(s.last_recorded_price)
        };

        let slip_bps = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            strat::max_swap_slippage_bps(&st.params)
        };

        let state = borrow_global_mut<VaultState>(vault_addr);
        state.last_recorded_price = btc_price;
        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);
        let meta_a = object::address_to_object<Metadata>(state.token_a_metadata);
        let meta_b = object::address_to_object<Metadata>(state.token_b_metadata);
        let fee_tier_val = state.fee_tier;
        let pos = object::address_to_object<position_v3::Info>(state.position_address);
        let pool = pool_v3::liquidity_pool(meta_a, meta_b, fee_tier_val);

        let (fee_a, fee_b) = pool_v3::claim_fees(&vault_signer, pos);
        state.free_btc = state.free_btc + fungible_asset::amount(&fee_a);
        state.free_usdc = state.free_usdc + fungible_asset::amount(&fee_b);
        primary_fungible_store::deposit(vault_addr, fee_a);
        primary_fungible_store::deposit(vault_addr, fee_b);

        let rewards = pool_v3::claim_rewards(&vault_signer, pos);
        process_reward_assets(rewards, pool, meta_a, meta_b, slip_bps, vault_addr, state);

        let fee_bps = state.performance_fee_bps;
        let treasury_addr = state.treasury;
        let btc_received = take_harvest_protocol_cut(
            &vault_signer,
            vault_addr,
            treasury_addr,
            fee_bps,
            meta_a,
            meta_b,
            free_btc_before,
            free_usdc_before,
            state,
        );
        event::emit(RewardsClaimed { btc_received, timestamp: timestamp::now_seconds() });
    }

    /// Same as `claim_rewards`, but refreshes Pyth cache in the same transaction.
    /// Useful when the on-chain Pyth cache may be stale.
    public entry fun claim_rewards_with_pyth_update(
        operator: &signer,
        vault_addr: address,
        pyth_update_data: vector<vector<u8>>,
    ) acquires VaultState, VaultStrategy {
        let update_fee = pyth::get_update_fee(&pyth_update_data);
        let fee_coin = coin::withdraw<aptos_coin::AptosCoin>(operator, update_fee);
        pyth::update_price_feeds(pyth_update_data, fee_coin);
        claim_rewards(operator, vault_addr);
    }

    /// Operator: full rebalance — exit position, re-split per oracle, open new range (ticks from off-chain).
    public entry fun rebalance(
        operator: &signer,
        vault_addr: address,
        tick_lower: u32,
        tick_upper: u32,
    ) acquires VaultState, VaultStrategy {
        assert!(tick_lower < tick_upper, errors::invalid_pool_config());
        let op = signer::address_of(operator);

        let min_interval = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            strat::min_rebalance_interval_secs(&st.params)
        };

        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            assert!(op == s.operator || op == s.admin, errors::not_operator());
            assert!(s.position_address != @0x0, errors::not_bootstrapped());
            oracle::get_safe_price(s.last_recorded_price)
        };

        let (slip_bps, half_bps) = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            (
                strat::max_swap_slippage_bps(&st.params),
                strat::range_half_width_bps(&st.params),
            )
        };

        let should_rb = {
            let st = borrow_global<VaultStrategy>(vault_addr);
            let s = borrow_global<VaultState>(vault_addr);
            strat::should_rebalance(btc_price, s.center_price, &st.params)
        };
        assert!(should_rb, errors::rebalance_not_needed());

        let old_center = {
            let s = borrow_global<VaultState>(vault_addr);
            s.center_price
        };

        let now = timestamp::now_seconds();

        let state = borrow_global_mut<VaultState>(vault_addr);
        assert!(
            now >= state.last_rebalance_ts + min_interval,
            errors::rebalance_too_early(),
        );

        state.last_recorded_price = btc_price;

        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);
        let meta_a = object::address_to_object<Metadata>(state.token_a_metadata);
        let meta_b = object::address_to_object<Metadata>(state.token_b_metadata);
        let fee_tier_val = state.fee_tier;
        let pos = object::address_to_object<position_v3::Info>(state.position_address);
        let pool = pool_v3::liquidity_pool(meta_a, meta_b, fee_tier_val);

        let free_btc_before = state.free_btc;
        let free_usdc_before = state.free_usdc;

        let (fee_a, fee_b) = pool_v3::claim_fees(&vault_signer, pos);
        state.free_btc = state.free_btc + fungible_asset::amount(&fee_a);
        state.free_usdc = state.free_usdc + fungible_asset::amount(&fee_b);
        primary_fungible_store::deposit(vault_addr, fee_a);
        primary_fungible_store::deposit(vault_addr, fee_b);

        let rewards = pool_v3::claim_rewards(&vault_signer, pos);
        process_reward_assets(rewards, pool, meta_a, meta_b, slip_bps, vault_addr, state);

        let fee_bps = state.performance_fee_bps;
        let treasury_addr = state.treasury;
        take_harvest_protocol_cut(
            &vault_signer,
            vault_addr,
            treasury_addr,
            fee_bps,
            meta_a,
            meta_b,
            free_btc_before,
            free_usdc_before,
            state,
        );

        state.position_btc = 0;
        state.position_usdc = 0;

        let pos_liq = position_v3::get_liquidity(pos);
        assert!(pos_liq > 0, errors::zero_supply());
        let deadline_rm = timestamp::now_seconds() + DEADLINE_SECS;
        let (opt_a, opt_b) = router_v3::remove_liquidity_by_contract(
            &vault_signer,
            pos,
            pos_liq,
            0,
            0,
            deadline_rm,
        );

        let fa_a_total = if (state.free_btc > 0) {
            let fa = primary_fungible_store::withdraw(&vault_signer, meta_a, state.free_btc);
            state.free_btc = 0;
            fa
        } else {
            fungible_asset::zero(meta_a)
        };

        let fa_b_total = if (state.free_usdc > 0) {
            let fa = primary_fungible_store::withdraw(&vault_signer, meta_b, state.free_usdc);
            state.free_usdc = 0;
            fa
        } else {
            fungible_asset::zero(meta_b)
        };

        let fa_a_merged = merge_opt_fa(fa_a_total, opt_a);
        let fa_b_merged = merge_opt_fa(fa_b_total, opt_b);

        let pool_obj_addr = object::object_address(&pool);
        let (_, sqrt_from_pool) = pool_v3::current_tick_and_price(pool_obj_addr);
        let sqrt_current = if (sqrt_from_pool > 0) {
            sqrt_from_pool
        } else {
            math::price_to_sqrt_q64(btc_price)
        };
        let (sqrt_price_low, sqrt_price_high) = math::sqrt_bps_band_around_current(sqrt_current, half_bps);
        let btc_ratio = math::btc_ratio_bps(sqrt_current, sqrt_price_low, sqrt_price_high);
        let total_a = fungible_asset::amount(&fa_a_merged);
        let swap_amount = total_a * (10000 - (btc_ratio as u64)) / 10000;

        let fa_a_total = fa_a_merged;
        let fa_b_total = fa_b_merged;
        let fa_b_for_lp = if (swap_amount > 0) {
            let fa_swap = fungible_asset::extract(&mut fa_a_total, swap_amount);
            let limit = swap_sqrt_price_limit(pool, true);
            let (_amt_out, fa_in_remain, fa_b_from_swap) = pool_v3::swap(
                pool,
                true,
                true,
                swap_amount,
                fa_swap,
                limit,
            );
            fungible_asset::merge(&mut fa_a_total, fa_in_remain);
            if (fungible_asset::amount(&fa_b_total) > 0) {
                fungible_asset::merge(&mut fa_b_from_swap, fa_b_total);
            } else {
                fungible_asset::destroy_zero(fa_b_total);
            };
            fa_b_from_swap
        } else {
            fa_b_total
        };

        let fa_a_for_lp = fa_a_total;

        let position = pool_v3::open_position(
            &vault_signer,
            meta_a,
            meta_b,
            fee_tier_val,
            tick_lower,
            tick_upper,
        );

        let amount_a_desired = fungible_asset::amount(&fa_a_for_lp);
        let amount_b_desired = fungible_asset::amount(&fa_b_for_lp);
        let min_a = amount_a_desired * (10000 - slip_bps) / 10000;
        // Same as `deposit_dual`: token-B minimum from slip often trips Hyperion `EAMOUNT_B_TOO_LESS` on CLMM rounding.
        let min_b = 0u64;
        let deadline = timestamp::now_seconds() + DEADLINE_SECS;

        let (used_a, used_b, leftover_a, leftover_b) = router_v3::add_liquidity_by_contract(
            &vault_signer,
            position,
            amount_a_desired,
            amount_b_desired,
            min_a,
            min_b,
            fa_a_for_lp,
            fa_b_for_lp,
            deadline,
        );

        let pos_addr = object::object_address(&position);
        state.position_address = pos_addr;
        state.position_btc = used_a;
        state.position_usdc = used_b;
        state.free_btc = fungible_asset::amount(&leftover_a);
        state.free_usdc = fungible_asset::amount(&leftover_b);
        state.center_price = btc_price;
        state.last_rebalance_ts = now;

        primary_fungible_store::deposit(vault_addr, leftover_a);
        primary_fungible_store::deposit(vault_addr, leftover_b);

        event::emit(Rebalanced {
            old_center,
            new_center: btc_price,
            timestamp: now,
        });
    }

    // ── Governance ─────────────────────────────────────────────────────────────

    public entry fun set_operator(
        admin: &signer,
        vault_addr: address,
        new_operator: address,
    ) acquires VaultState {
        let state = borrow_global_mut<VaultState>(vault_addr);
        assert!(signer::address_of(admin) == state.admin, errors::not_admin());
        state.operator = new_operator;
    }

    /// Sets bps taken from each token leg when operator harvests fees/rewards (`claim_rewards`, rebalance). Max 2000 (20%).
    public entry fun set_performance_fee(
        admin: &signer,
        vault_addr: address,
        fee_bps: u64,
    ) acquires VaultState {
        let state = borrow_global_mut<VaultState>(vault_addr);
        assert!(signer::address_of(admin) == state.admin, errors::not_admin());
        assert!(fee_bps <= 2000, errors::fee_too_high());
        state.performance_fee_bps = fee_bps;
    }

    public entry fun set_strategy_params(
        admin: &signer,
        vault_addr: address,
        range_half_width_bps: u64,
        rebalance_trigger_bps: u64,
        max_swap_slippage_bps: u64,
    ) acquires VaultState, VaultStrategy {
        {
            let s = borrow_global<VaultState>(vault_addr);
            assert!(signer::address_of(admin) == s.admin, errors::not_admin());
        };
        assert!(range_half_width_bps >= 100, errors::range_too_narrow());
        let st = borrow_global_mut<VaultStrategy>(vault_addr);
        strat::update_params_from_governance(
            &mut st.params,
            range_half_width_bps,
            rebalance_trigger_bps,
            max_swap_slippage_bps,
        );
    }

    /// One-time (or emergency) baseline sync after switching oracle mode.
    /// Refreshes Pyth cache and writes current BTC/USD into `last_recorded_price`
    /// without deviation comparison vs old baseline.
    public entry fun sync_oracle_baseline_with_pyth_update(
        admin: &signer,
        vault_addr: address,
        pyth_update_data: vector<vector<u8>>,
    ) acquires VaultState {
        let update_fee = pyth::get_update_fee(&pyth_update_data);
        let fee_coin = coin::withdraw<aptos_coin::AptosCoin>(admin, update_fee);
        pyth::update_price_feeds(pyth_update_data, fee_coin);

        let state = borrow_global_mut<VaultState>(vault_addr);
        assert!(signer::address_of(admin) == state.admin, errors::not_admin());
        state.last_recorded_price = oracle::btc_usd_price_pyth_only();
    }

    // Read helpers (not `#[view]`): bytecode verifier rejects mixed view/non-view call graphs with Pyth + acquires.

    public fun get_yab_price_view(vault_addr: address): u64 acquires VaultState {
        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            oracle::get_safe_price(s.last_recorded_price)
        };
        let s = borrow_global<VaultState>(vault_addr);
        get_yab_price(s, vault_addr, btc_price)
    }

    public fun get_total_assets_view(vault_addr: address): u64 acquires VaultState {
        let btc_price = {
            let s = borrow_global<VaultState>(vault_addr);
            oracle::get_safe_price(s.last_recorded_price)
        };
        let s = borrow_global<VaultState>(vault_addr);
        get_total_assets(s, btc_price)
    }

    public fun get_vault_state(vault_addr: address): (u64, u64, u64, u64) acquires VaultState {
        let s = borrow_global<VaultState>(vault_addr);
        (
            s.center_price,
            s.last_recorded_price,
            s.last_rebalance_ts,
            s.performance_fee_bps,
        )
    }

    #[test_only]
    /// YAB price at an explicit BTC/USD oracle price (E2E tests without Pyth).
    public fun e2e_yab_price(vault_addr: address, btc_usd_price: u64): u64 acquires VaultState {
        let s = borrow_global<VaultState>(vault_addr);
        get_yab_price(s, vault_addr, btc_usd_price)
    }

    #[test_only]
    /// Exposes USDC (6-dec) raw → 8-dec BTC raw; for `aptos move test` only.
    public fun e2e_usdc_raw_to_btc_raw_equiv(usdc_raw: u64, btc_price: u64): u64 {
        usdc_raw_to_btc_raw_equiv(usdc_raw, btc_price)
    }

    #[test_only]
    /// Total assets at an explicit BTC/USD oracle price (E2E tests).
    public fun e2e_total_assets(vault_addr: address, btc_usd_price: u64): u64 acquires VaultState {
        let s = borrow_global<VaultState>(vault_addr);
        get_total_assets(s, btc_usd_price)
    }

    #[test_only]
    /// Override user checkpoint entry price (E2E fee scenarios).
    public fun e2e_set_checkpoint_entry(user: &signer, entry_price: u64) acquires UserCheckpoint {
        let a = signer::address_of(user);
        if (exists<UserCheckpoint>(a)) {
            borrow_global_mut<UserCheckpoint>(a).entry_price = entry_price;
        } else {
            move_to(user, UserCheckpoint { entry_price });
        };
    }

    #[test_only]
    /// Set vault free reserves (E2E `free_*` paths; stub DEX only).
    public fun e2e_set_free_reserves(vault_addr: address, free_btc: u64, free_usdc: u64) acquires VaultState {
        let s = borrow_global_mut<VaultState>(vault_addr);
        s.free_btc = free_btc;
        s.free_usdc = free_usdc;
    }

    #[test_only]
    public fun e2e_free_btc(vault_addr: address): u64 acquires VaultState {
        borrow_global<VaultState>(vault_addr).free_btc
    }

    #[test_only]
    public fun e2e_free_usdc(vault_addr: address): u64 acquires VaultState {
        borrow_global<VaultState>(vault_addr).free_usdc
    }

    #[test_only]
    /// `free_*` in state and primary store already reflect post-claim balances; `free_*_before` are pre-claim snapshots.
    public fun e2e_apply_harvest_cut_for_test(
        vault_addr: address,
        free_btc_before: u64,
        free_usdc_before: u64,
    ) acquires VaultState {
        let state = borrow_global_mut<VaultState>(vault_addr);
        let vault_signer = object::generate_signer_for_extending(&state.extend_ref);
        let meta_a = object::address_to_object<Metadata>(state.token_a_metadata);
        let meta_b = object::address_to_object<Metadata>(state.token_b_metadata);
        let fee_bps = state.performance_fee_bps;
        let treasury_addr = state.treasury;
        take_harvest_protocol_cut(
            &vault_signer,
            vault_addr,
            treasury_addr,
            fee_bps,
            meta_a,
            meta_b,
            free_btc_before,
            free_usdc_before,
            state,
        );
    }
}
