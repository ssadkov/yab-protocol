#[test_only]
module yab::vault_e2e_tests {
    use aptos_framework::account;
    use aptos_framework::fungible_asset::{Self, Metadata, MintRef};
    use aptos_framework::object;
    use aptos_framework::primary_fungible_store;
    use aptos_framework::timestamp;
    use std::option;
    use std::signer;
    use std::string::utf8;

    use yab::vault;

    const VAULT_SEED: vector<u8> = b"YAB_VAULT_V1";

    const ORACLE_PX: u64 = 100_000_000;

    /// Primary-store-enabled FA with a high max supply for E2E mints.
    const SEED_A: u64 = 25;
    const DEP_SMALL: u64 = 5;
    /// User deposit size so performance-fee math (integer btc) does not round fee to zero.
    const DEP_FOR_PERF_FEE: u64 = 50;

    fun vault_object_address(admin_addr: address): address {
        object::create_object_address(&admin_addr, VAULT_SEED)
    }

    const TREASURY_ADDR: address = @0xE011;
    const OPERATOR_ADDR: address = @0xE012;

    /// Tokens must use `create_primary_store_enabled_fungible_asset` so `primary_fungible_store::deposit` works
    /// (DeriveRefPod on metadata). `create_fungible_asset` test helper does not add DeriveRefPod.
    fun setup_two_tokens_and_vault(
        creator_a: &signer,
        creator_b: &signer,
        admin: &signer,
        framework: &signer,
    ): (address, address, MintRef) {
        timestamp::set_time_has_started_for_testing(framework);

        let cref_a = object::create_named_object(creator_a, b"E2E_TOKEN_A");
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &cref_a,
            option::some(1_000_000u128),
            utf8(b"TEST_A"),
            utf8(b"A"),
            8,
            utf8(b""),
            utf8(b""),
        );
        let mint_a = fungible_asset::generate_mint_ref(&cref_a);
        let ma = object::address_from_constructor_ref(&cref_a);

        let cref_b = object::create_named_object(creator_b, b"E2E_TOKEN_B");
        primary_fungible_store::create_primary_store_enabled_fungible_asset(
            &cref_b,
            option::some(1_000_000u128),
            utf8(b"TEST_B"),
            utf8(b"B"),
            8,
            utf8(b""),
            utf8(b""),
        );
        let mb = object::address_from_constructor_ref(&cref_b);

        let _meta_a = object::address_to_object<Metadata>(ma);
        let _meta_b = object::address_to_object<Metadata>(mb);
        // Hyperion git interface has no dex-local test stubs; pool/position views return empty handles for tests.

        let admin_addr = signer::address_of(admin);
        account::create_account_for_test(admin_addr);
        vault::initialize(admin, TREASURY_ADDR, OPERATOR_ADDR, ma, mb, 1);
        (ma, mb, mint_a)
    }

    /// Mint token A into the vault primary store and mirror `VaultState.free_*` (for withdraw tests).
    fun fund_vault_free_a(vault_addr: address, mint_ref: &MintRef, free_btc: u64) {
        let fa = fungible_asset::mint(mint_ref, free_btc);
        primary_fungible_store::deposit(vault_addr, fa);
        vault::e2e_set_free_reserves(vault_addr, free_btc, 0);
    }

    #[test(creator_a = @0xCA01, creator_b = @0xCA02, admin = @0xAD01, framework = @0x1)]
    fun test_deposit_mints_correct_shares(
        creator_a: &signer,
        creator_b: &signer,
        admin: &signer,
        framework: &signer,
    ) {
        let (_ma, _mb, mint_a) = setup_two_tokens_and_vault(creator_a, creator_b, admin, framework);
        let admin_addr = signer::address_of(admin);
        let va = vault_object_address(admin_addr);
        let fa0 = fungible_asset::mint(&mint_a, SEED_A);
        primary_fungible_store::deposit(admin_addr, fa0);
        vault::bootstrap_with_fixed_oracle(admin, va, SEED_A, 100, 20000, ORACLE_PX);
        let yab_meta = object::address_to_object<Metadata>(va);
        let yab_after_boot = primary_fungible_store::balance(admin_addr, yab_meta);
        assert!(yab_after_boot == SEED_A, 1);
        let px = ORACLE_PX;
        let yp = vault::e2e_yab_price(va, px);
        let deposit_in = 10u64;
        let fa1 = fungible_asset::mint(&mint_a, deposit_in);
        primary_fungible_store::deposit(admin_addr, fa1);
        vault::deposit_with_fixed_oracle(admin, va, deposit_in, px);
        let expected_shares = deposit_in * 100_000_000 / yp;
        let yab_total = primary_fungible_store::balance(admin_addr, yab_meta);
        assert!(yab_total == SEED_A + expected_shares, 2);
    }

    #[test(creator_a = @0xCA21, creator_b = @0xCA22, admin = @0xAD21, user = @0xB521, framework = @0x1)]
    fun test_withdraw_returns_correct_btc_full(
        creator_a: &signer,
        creator_b: &signer,
        admin: &signer,
        user: &signer,
        framework: &signer,
    ) {
        let (ma, _mb, mint_a) = setup_two_tokens_and_vault(creator_a, creator_b, admin, framework);
        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);
        account::create_account_for_test(user_addr);
        let va = vault_object_address(admin_addr);
        let fa0 = fungible_asset::mint(&mint_a, SEED_A);
        primary_fungible_store::deposit(admin_addr, fa0);
        vault::bootstrap_with_fixed_oracle(admin, va, SEED_A, 100, 20000, ORACLE_PX);
        let dep = 8u64;
        let fa_u = fungible_asset::mint(&mint_a, dep);
        primary_fungible_store::deposit(user_addr, fa_u);
        let px = ORACLE_PX;
        vault::deposit_with_fixed_oracle(user, va, dep, px);
        let yab_meta = object::address_to_object<Metadata>(va);
        let meta_a = object::address_to_object<Metadata>(ma);
        let share_bal = primary_fungible_store::balance(user_addr, yab_meta);
        let yp = vault::e2e_yab_price(va, px);
        let expected_btc = share_bal * yp / 100_000_000;
        let btc_before = primary_fungible_store::balance(user_addr, meta_a);
        vault::withdraw_with_fixed_oracle(user, va, share_bal, px);
        let btc_after = primary_fungible_store::balance(user_addr, meta_a);
        assert!(btc_after - btc_before == expected_btc, 1);
    }

    #[test(creator_a = @0xCA31, creator_b = @0xCA32, admin = @0xAD31, user = @0xB531, framework = @0x1)]
    fun test_performance_fee_on_profit_mints_to_treasury(
        creator_a: &signer,
        creator_b: &signer,
        admin: &signer,
        user: &signer,
        framework: &signer,
    ) {
        let (_ma, _mb, mint_a) = setup_two_tokens_and_vault(creator_a, creator_b, admin, framework);
        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);
        account::create_account_for_test(user_addr);
        account::create_account_for_test(TREASURY_ADDR);
        let va = vault_object_address(admin_addr);
        let fa0 = fungible_asset::mint(&mint_a, SEED_A);
        primary_fungible_store::deposit(admin_addr, fa0);
        vault::bootstrap_with_fixed_oracle(admin, va, SEED_A, 100, 20000, ORACLE_PX);
        let fa_u = fungible_asset::mint(&mint_a, DEP_FOR_PERF_FEE);
        primary_fungible_store::deposit(user_addr, fa_u);
        vault::deposit_with_fixed_oracle(user, va, DEP_FOR_PERF_FEE, ORACLE_PX);
        vault::e2e_set_checkpoint_entry(user, 1);
        let yab_meta = object::address_to_object<Metadata>(va);
        let shares = primary_fungible_store::balance(user_addr, yab_meta);
        let treas_before = primary_fungible_store::balance(TREASURY_ADDR, yab_meta);
        vault::withdraw_with_fixed_oracle(user, va, shares, ORACLE_PX);
        let treas_after = primary_fungible_store::balance(TREASURY_ADDR, yab_meta);
        assert!(treas_after > treas_before, 1);
    }

    #[test(creator_a = @0xCA41, creator_b = @0xCA42, admin = @0xAD41, user = @0xB541, framework = @0x1)]
    fun test_no_fee_when_at_loss(
        creator_a: &signer,
        creator_b: &signer,
        admin: &signer,
        user: &signer,
        framework: &signer,
    ) {
        let (_ma, _mb, mint_a) = setup_two_tokens_and_vault(creator_a, creator_b, admin, framework);
        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);
        account::create_account_for_test(user_addr);
        account::create_account_for_test(TREASURY_ADDR);
        let va = vault_object_address(admin_addr);
        let fa0 = fungible_asset::mint(&mint_a, SEED_A);
        primary_fungible_store::deposit(admin_addr, fa0);
        vault::bootstrap_with_fixed_oracle(admin, va, SEED_A, 100, 20000, ORACLE_PX);
        let fa_u = fungible_asset::mint(&mint_a, DEP_SMALL);
        primary_fungible_store::deposit(user_addr, fa_u);
        vault::deposit_with_fixed_oracle(user, va, DEP_SMALL, ORACLE_PX);
        vault::e2e_set_checkpoint_entry(user, 200_000_000);
        let yab_meta = object::address_to_object<Metadata>(va);
        let shares = primary_fungible_store::balance(user_addr, yab_meta);
        let treas_before = primary_fungible_store::balance(TREASURY_ADDR, yab_meta);
        vault::withdraw_with_fixed_oracle(user, va, shares, ORACLE_PX);
        let treas_after = primary_fungible_store::balance(TREASURY_ADDR, yab_meta);
        assert!(treas_after == treas_before, 1);
    }

    #[test(creator_a = @0xCA51, creator_b = @0xCA52, admin = @0xAD51, user = @0xB551, framework = @0x1)]
    fun test_deposit_uses_free_reserves(
        creator_a: &signer,
        creator_b: &signer,
        admin: &signer,
        user: &signer,
        framework: &signer,
    ) {
        let (_ma, _mb, mint_a) = setup_two_tokens_and_vault(creator_a, creator_b, admin, framework);
        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);
        account::create_account_for_test(user_addr);
        let va = vault_object_address(admin_addr);
        let fa0 = fungible_asset::mint(&mint_a, SEED_A);
        primary_fungible_store::deposit(admin_addr, fa0);
        vault::bootstrap_with_fixed_oracle(admin, va, SEED_A, 100, 20000, ORACLE_PX);
        fund_vault_free_a(va, &mint_a, 10);
        assert!(vault::e2e_free_btc(va) == 10, 1);
        let fa_u = fungible_asset::mint(&mint_a, DEP_SMALL);
        primary_fungible_store::deposit(user_addr, fa_u);
        vault::deposit_with_fixed_oracle(user, va, DEP_SMALL, ORACLE_PX);
        // Stub `add_liquidity_by_contract` returns (0,0,fa_a,fa_b): nothing is "used" on-chain, so free_* stay as full leftovers.
        assert!(vault::e2e_free_btc(va) == 10 + DEP_SMALL, 2);
    }

    #[test(creator_a = @0xCA61, creator_b = @0xCA62, admin = @0xAD61, user = @0xB561, framework = @0x1)]
    fun test_free_reserves_used_first_on_withdraw(
        creator_a: &signer,
        creator_b: &signer,
        admin: &signer,
        user: &signer,
        framework: &signer,
    ) {
        let (ma, _mb, mint_a) = setup_two_tokens_and_vault(creator_a, creator_b, admin, framework);
        let admin_addr = signer::address_of(admin);
        let user_addr = signer::address_of(user);
        account::create_account_for_test(user_addr);
        let va = vault_object_address(admin_addr);
        let fa0 = fungible_asset::mint(&mint_a, SEED_A);
        primary_fungible_store::deposit(admin_addr, fa0);
        vault::bootstrap_with_fixed_oracle(admin, va, SEED_A, 100, 20000, ORACLE_PX);
        let fa_u = fungible_asset::mint(&mint_a, DEP_SMALL);
        primary_fungible_store::deposit(user_addr, fa_u);
        vault::deposit_with_fixed_oracle(user, va, DEP_SMALL, ORACLE_PX);
        fund_vault_free_a(va, &mint_a, 30);
        let yab_meta = object::address_to_object<Metadata>(va);
        let meta_a = object::address_to_object<Metadata>(ma);
        let shares = primary_fungible_store::balance(user_addr, yab_meta);
        let yp = vault::e2e_yab_price(va, ORACLE_PX);
        let owed = shares * yp / 100_000_000;
        let free_before = vault::e2e_free_btc(va);
        assert!(free_before >= owed, 1);
        let bal_before = primary_fungible_store::balance(user_addr, meta_a);
        vault::withdraw_with_fixed_oracle(user, va, shares, ORACLE_PX);
        let bal_after = primary_fungible_store::balance(user_addr, meta_a);
        assert!(bal_after - bal_before == owed, 2);
        assert!(vault::e2e_free_btc(va) == free_before - owed, 3);
    }
}
