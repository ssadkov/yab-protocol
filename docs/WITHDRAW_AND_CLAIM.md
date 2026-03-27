# Withdraw, harvest (`claim_rewards`), and `rebalance` fee leg — behavior and how to test (mainnet)

Module package: `0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b`  
Example vault object: `0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c`

---

## `withdraw` — any user with YAB

**Who:** the user (holder of YAB), **not** the operator.

**What it does:**

1. Reads **oracle** price (`oracle::get_safe_price`) and updates `last_recorded_price`.
2. Computes **YAB NAV** in token-A terms (`get_yab_price` — WBTC-equivalent per 1 YAB).
3. **No protocol fee on withdraw:** `performance_fee_bps` is **not** applied here. Users are not charged a profit-based fee at exit; `UserCheckpoint` may still be updated on deposit for off-chain / future use.
4. **Payout asset:** users always receive **token A (WBTC)** on withdrawal, not USDC.
5. **Order of funding the payout:**
   - First: **`free_btc`** (vault’s idle WBTC).
   - If not enough: **proportional removal** from the Hyperion position (`remove_liquidity_by_contract`), then any USDC returned is **swapped toward token A** inside the pool and sent to the user.
6. **Burn:** the user’s **`shares_in`** YAB is burned from their primary store.

**Entry:**

```text
vault::withdraw(user, vault_addr, shares_in)
```

**Events:** `Withdrawn { user, shares_burned, btc_out }` (`btc_out` is WBTC sent to the user before gas).

**Testing (CLI sketch):**

```bash
# Replace SHARES with YAB amount to burn (same decimals as YAB metadata, 8).
aptos move run \
  --profile <YOUR_WALLET> \
  --network mainnet \
  --function-id 0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b::vault::withdraw \
  --args address:0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c u64:<SHARES>
```

**Checks:** WBTC balance of the wallet increases (minus gas), YAB balance drops by `shares_in`, explorer shows `Withdrawn` event.

**Note:** With **Pyth**, ensure cache freshness if your client path uses `withdraw_with_pyth_update`.

---

## Harvest protocol fee (`performance_fee_bps`)

**Name in state:** `VaultState.performance_fee_bps` (same field name as before; **semantics: harvest / operator collection only**, not withdraw).

**Governance:** `vault::set_performance_fee(admin, vault_addr, fee_bps)` — admin only; **`fee_bps ≤ 2000`** (20%).

**When it runs:**

- Immediately after **`pool_v3::claim_fees`** and **`process_reward_assets`** inside **`vault::claim_rewards`**.
- The same step runs at the start of **`vault::rebalance`** (before removing the old CLMM position), so the protocol cut applies to fees and gauge rewards collected in that transaction as well.

**What is charged:**

For the current transaction only, the vault compares **`free_btc` / `free_usdc`** to their values **before** collecting CLMM fees and processing reward assets:

- `delta_token_a = free_btc_after_claim_and_rewards − free_btc_before`
- `delta_token_b = free_usdc_after_claim_and_rewards − free_usdc_before`

Then:

- `protocol_token_a = delta_token_a * performance_fee_bps / 10000`
- `protocol_token_b = delta_token_b * performance_fee_bps / 10000`

Those amounts are **withdrawn from the vault’s primary store** and **deposited to `VaultState.treasury`** (raw token A / token B). Rounding is **down** (integer bps).

**If `performance_fee_bps == 0`:** nothing is sent to treasury on harvest; all claimed value stays in **`free_*`** for LPs / later deposit paths.

**Events:**

- **`RewardsClaimed { btc_received, timestamp }`** — `btc_received` is the **net** increase in **`free_btc`** credited to the vault **after** the protocol cut (historical field name).
- **`HarvestFeeCollected { protocol_btc, protocol_usdc, timestamp }`** when the cut is non-zero on at least one leg.

**Recycling to the pool without rebalance:** idle **`free_*`** after harvest is unchanged by this fee except for the treasury slice. Operators or users adding liquidity via **`deposit` / `deposit_dual`** can pull **`free_*`** into the existing position without calling **`rebalance`**.

---

## `claim_rewards` — operator or admin only

**Who:** `operator` or `admin` from `VaultState` (not regular LPs).

**What it does:**

1. Asserts vault is bootstrapped (`position_address != 0x0`).
2. Calls **`oracle::get_safe_price`** and updates `last_recorded_price`.
3. **`pool_v3::claim_fees`** — accrued trading fees on the CLMM position → credited to **`free_btc` / `free_usdc`** (vault primary store).
4. **`pool_v3::claim_rewards`** — gauge / incentive tokens → **`process_reward_assets`** (swap non–token-A assets per policy; see implementation).
5. **Harvest protocol cut** — **`performance_fee_bps`** applied to the **Δ`free_btc` / Δ`free_usdc`** from steps 3–4 (see above).
6. Emits **`RewardsClaimed`** (and **`HarvestFeeCollected`** if the cut is non-zero).

**Entry:**

```text
vault::claim_rewards(operator, vault_addr)
```

**Testing (CLI sketch):**

```bash
aptos move run \
  --profile <OPERATOR_OR_ADMIN> \
  --network mainnet \
  --function-id 0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b::vault::claim_rewards \
  --args address:0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c
```

**Checks:** Treasury balances of token A / B may increase if there was a non-zero harvest and non-zero **`performance_fee_bps`**; `RewardsClaimed` emitted. If the position had no fees yet, gas is still spent but deltas may be zero.

---

## Suggested test order

1. **`claim_rewards`** with the **operator** wallet — verifies Hyperion fee/reward paths, **`HarvestFeeCollected`** (when applicable), and net **`free_*`**.
2. **`withdraw`** with a **small** `shares_in` — verifies burn, NAV, and WBTC delivery (**no** withdraw performance fee).

Record successful tx hashes in **`docs/MAINNET.md`** like the deposit smoke test.

---

## Publishing the package (reference)

See **[`README.md`](../README.md)** — section **Publishing / package upgrade (mainnet)** for the full **`aptos move publish`** command with **`--named-addresses`**.
