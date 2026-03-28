#[test_only]
module yab::vault_tests {
    use aptos_framework::object;
    use std::signer;

    use yab::vault;

    const VAULT_SEED: vector<u8> = b"YAB_VAULT_V1";

    fun vault_object_address(admin_addr: address): address {
        object::create_object_address(&admin_addr, VAULT_SEED)
    }

    fun setup_vault(admin: &signer) {
        let treasury = @0xF00;
        let operator = @0x0AE;
        let token_a = @0xA000000000000000000000000000000000000000000000000000000000000001;
        let token_b = @0xB000000000000000000000000000000000000000000000000000000000000002;
        vault::initialize(admin, treasury, operator, token_a, token_b, 5);
    }

    #[test(admin = @0xAAD)]
    fun test_get_vault_state_after_init(admin: &signer) {
        let admin_addr = signer::address_of(admin);
        setup_vault(admin);
        let va = vault_object_address(admin_addr);
        let (center, last_rec, last_rb, perf_bps) = vault::get_vault_state(va);
        assert!(center == 0, 1);
        assert!(last_rec == 0, 2);
        assert!(last_rb == 0, 3);
        assert!(perf_bps == 1000, 4);
    }

    #[test(admin = @0xAAD)]
    fun test_set_operator_happy(admin: &signer) {
        setup_vault(admin);
        let va = vault_object_address(signer::address_of(admin));
        vault::set_operator(admin, va, @0xBEEF);
    }

    #[test(admin = @0xAAD)]
    fun test_set_performance_fee_at_cap(admin: &signer) {
        setup_vault(admin);
        let va = vault_object_address(signer::address_of(admin));
        vault::set_performance_fee(admin, va, 2000);
        let (_, _, _, fee) = vault::get_vault_state(va);
        assert!(fee == 2000, 1);
    }

    #[test(admin = @0xAAD)]
    fun test_set_strategy_params_happy(admin: &signer) {
        setup_vault(admin);
        let va = vault_object_address(signer::address_of(admin));
        vault::set_strategy_params(admin, va, 500, 400, 25);
    }

    #[test(admin = @0xAAD, attacker = @0xBAD)]
    #[expected_failure(abort_code = 10, location = yab::vault)]
    fun test_set_operator_rejects_non_admin(admin: &signer, attacker: &signer) {
        setup_vault(admin);
        let va = vault_object_address(signer::address_of(admin));
        vault::set_operator(attacker, va, @0xBEEF);
    }

    #[test(admin = @0xAAD)]
    #[expected_failure(abort_code = 31, location = yab::vault)]
    fun test_set_performance_fee_max(admin: &signer) {
        setup_vault(admin);
        let va = vault_object_address(signer::address_of(admin));
        vault::set_performance_fee(admin, va, 2001);
    }

    #[test(admin = @0xAAD)]
    #[expected_failure(abort_code = 30, location = yab::vault)]
    fun test_set_strategy_params_range_too_narrow(admin: &signer) {
        setup_vault(admin);
        let va = vault_object_address(signer::address_of(admin));
        vault::set_strategy_params(admin, va, 99, 400, 30);
    }

    // 6-dec USDC raw * 10^10 / btc_price (spot check, mainnet oracle scale).
    #[test]
    fun test_usdc_raw_to_btc_raw_equiv_scale() {
        let btc_px: u64 = 6686227436716;
        let one_usdc: u64 = 1_000_000;
        let out = vault::e2e_usdc_raw_to_btc_raw_equiv(one_usdc, btc_px);
        assert!(out == 1495, 1);
    }

    // When `btc_a_raw * btc_price` is divisible by 10^10, BTC→USDC→BTC is exact.
    #[test]
    fun test_btc_usdc_btc_roundtrip_exact() {
        let btc_price: u64 = 10_000_000_000; // 1e10 — exercises same divisor as USDC_TO_BTC_RAW_MULT
        let btc_a: u64 = 12_345_678;
        let usdc = vault::e2e_btc_raw_to_usdc_raw(btc_a, btc_price);
        let back = vault::e2e_usdc_raw_to_btc_raw_equiv(usdc, btc_price);
        assert!(back == btc_a, 1);
    }

    // USDC→BTC→USDC never exceeds the starting USDC (truncating divisions).
    #[test]
    fun test_usdc_btc_usdc_roundtrip_bounded() {
        let btc_px: u64 = 6686227436716;
        let usdc_in: u64 = 1_000_000;
        let btc_mid = vault::e2e_usdc_raw_to_btc_raw_equiv(usdc_in, btc_px);
        let usdc_out = vault::e2e_btc_raw_to_usdc_raw(btc_mid, btc_px);
        assert!(usdc_out <= usdc_in, 1);
        assert!(usdc_out > 0, 2);
    }

    // Pairs with `test_usdc_raw_to_btc_raw_equiv_scale`: 1495 token-A raw ↔ sub-1-USDC at that oracle.
    #[test]
    fun test_btc_raw_to_usdc_raw_inverse_scale() {
        let btc_px: u64 = 6686227436716;
        let btc_a: u64 = 1495;
        let usdc = vault::e2e_btc_raw_to_usdc_raw(btc_a, btc_px);
        assert!(usdc == 999_591, 1);
    }
}
