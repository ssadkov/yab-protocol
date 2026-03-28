# Deposits, `add_liquidity` mins, and USDC-only deposit

## Hyperion `EAMOUNT_*_TOO_LESS`

Hyperion’s `router_v3::add_liquidity_by_contract` enforces minimum amounts consumed per leg. In concentrated liquidity, **actual** amounts used often differ from “desired” inputs because of **curve math and rounding**. If the contract passes **slippage floors** derived as:

`min_x = amount_x_desired * (10000 - slip_bps) / 10000`

then small deposits can hit:

- **`EAMOUNT_B_TOO_LESS`** — token B (e.g. USDC) leg
- **`EAMOUNT_A_TOO_LESS`** — token A (e.g. WBTC) leg

This is **not** caused by changing `range_half_width_bps` alone; it appears when slip floors are tighter than what the pool can consume for a given tick range and price.

## What we changed in `vault`

1. **`vault::deposit` (WBTC-only)** and **`vault::deposit_dual`**  
   For the **`add_liquidity`** call, both **`min_a`** and **`min_b`** are set to **`0`**. The router still receives **`amount_a_desired`** / **`amount_b_desired`** as the **caps** to spend; zeros only relax **minimum consumed** checks so CLMM rounding does not revert. This matches the earlier intentional **`min_b = 0`** comment on the WBTC path and extends it to **`min_a`** after **`EAMOUNT_A_TOO_LESS`** appeared on small WBTC deposits.

2. **`vault::rebalance`**  
   **`min_b = 0`** for **`add_liquidity`** (already needed for **`EAMOUNT_B_TOO_LESS`**). **`min_a`** may still use **`max_swap_slippage_bps`**; if **`EAMOUNT_A_TOO_LESS`** appears, raise slippage via **`set_strategy_params`** or publish a build that also zeros **`min_a`** on rebalance.

3. **Unknown gauge / incentive tokens** in **`process_reward_assets`**  
   Non-pool assets are credited to **`treasury`** instead of aborting so **`rebalance`** can finish.

4. **`strategy::should_rebalance`**  
   BPS deviation uses **u128** intermediates so **`(diff * 10000)`** cannot overflow **u64** for corrupted or extreme **`center_price`**.

## `vault::deposit_usdc` (token B only)

**`deposit_usdc(user, vault_addr, token_b_in)`** lets a user add **only USDC** (pool **token B** metadata). Behavior mirrors **`deposit`** (WBTC-only) but **symmetric**:

- Pulls **`token_b_in`** from the user’s primary store for **token B**.
- Merges vault **`free_usdc`** (and **`free_btc`** on the A side for liquidity).
- Uses the same **`range_half_width_bps`** band and **`btc_ratio_bps`** as **`deposit`**.
- Swap split (symmetric to WBTC-only):  
  **`swap_amount_b = total_b * btc_ratio / 10000`** is swapped **B → A** via **`pool_v3::swap(..., false, true, ...)`** (same direction as USDC→WBTC in **`withdraw`** when swapping removed liquidity).
- **`add_liquidity_by_contract`** with **`min_a = min_b = 0`**.
- **Shares**: same economics as **`deposit_dual`** for the B leg — BTC-equivalent notional via **`usdc_raw_to_btc_raw_equiv`** (**6-dec** USDC raw → 8-dec WBTC-style raw: **`token_b_in * 10^10 / btc_price`**), then mint against **`yab_price`** (see `vault.move`).

**Minimums:** **`token_b_in >= MIN_DEPOSIT_TOKEN_B_DUAL`** when enforcement is on; after a B→A swap, **`MIN_POST_SWAP_TOKEN_A`** must be met on the resulting WBTC leg (see constants in `vault.move`).

**Naming:** The entry is called **`deposit_usdc`** for product clarity on mainnet WBTC/USDC; it still uses **`token_b_metadata`** from **`VaultState`** (any pool-ordered token B).

## Related

- [`README.md`](../README.md) — strategy params and rebalance overview  
- [`PYTH_ORACLE.md`](./PYTH_ORACLE.md) — oracle and Hermes  
- [`WITHDRAW_AND_CLAIM.md`](./WITHDRAW_AND_CLAIM.md) — withdraw and harvest  
