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
        let (center, last_rec, last_rb, fee) = vault::get_vault_state(va);
        assert!(center == 0, 1);
        assert!(last_rec == 0, 2);
        assert!(last_rb == 0, 3);
        assert!(fee == 1000, 4);
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
}
