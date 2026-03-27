# YAB Protocol

Aptos Move vault around a Hyperion v3 CLMM position, YAB fungible shares, and a Pyth BTC/USD oracle.

## Rebalance

`vault::rebalance` is **`entry`**-callable by **`VaultState.operator`** or **`VaultState.admin`**. It:

1. Loads **`oracle::get_safe_price(VaultState.last_recorded_price)`** (Pyth + YAB guards).
2. Aborts unless **`strategy::should_rebalance(btc_price, center_price, params)`** is true (see below).
3. Enforces **`min_rebalance_interval_secs`** since **`last_rebalance_ts`**.
4. Claims fees/rewards (with the same **harvest protocol cut** as **`claim_rewards`** — see [`docs/WITHDRAW_AND_CLAIM.md`](docs/WITHDRAW_AND_CLAIM.md)), removes all liquidity from the old position, optionally swaps toward the target mix, opens a **new** position with **`tick_lower` / `tick_upper`** supplied in the transaction, and sets **`center_price = btc_price`**.

**Ticks** must match the pool’s **`tick_spacing`** (off-chain: read `pool_v3::LiquidityPoolV3.tick_spacing` and align bounds; typical mainnet WBTC/USDC pool uses spacing **10**).

### Preconditions (common aborts)

| Condition | Module / note |
|-----------|----------------|
| Stale Pyth or price spike vs `last_recorded_price` | `oracle` — refresh Hermes in the same tx path where possible; see **`sync_oracle_baseline_with_pyth_update`** (admin) for an emergency baseline reset. |
| `rebalance_not_needed` | Oracle move vs `center_price` below **`rebalance_trigger_bps`**. |
| `rebalance_too_early` | Wall-clock interval &lt; **`min_rebalance_interval_secs`**. |
| Hyperion `router_v3` liquidity errors | Often slippage / CLMM rounding; **`rebalance` uses `min_b = 0`** on `add_liquidity` (same idea as `deposit_dual`). If issues persist, consider raising **`max_swap_slippage_bps`** temporarily via **`set_strategy_params`**. |

### Strategy parameters (`VaultStrategy.params`)

Governance can update **`range_half_width_bps`**, **`rebalance_trigger_bps`**, and **`max_swap_slippage_bps`** with **`vault::set_strategy_params`** (admin). **`min_rebalance_interval_secs`** and **`dust_reinvest_threshold_bps`** are **not** changed by that entry function—they are fixed at vault initialization unless the package adds another governance path.

| Field | Role | Default in code (`strategy::default_params`) |
|-------|------|-----------------------------------------------|
| **`range_half_width_bps`** | Used in **`math::sqrt_bps_band_around_current`**: builds **`[sqrt_lo, sqrt_hi]`** as `sqrt_current × (1 ± half/10000)`. That band feeds **`btc_ratio_bps`**, which drives **how much token A is swapped to token B** before re-adding liquidity. **Not** the same as “±X% on BTC/USD spot” literally. | `500` (~±5% on **sqrt**) |
| **`rebalance_trigger_bps`** | Rebalance allowed when **`|oracle − center_price| / center_price ≥ trigger/10000`** (ratio computed in **u128** to avoid overflow). | `400` (4%) |
| **`min_rebalance_interval_secs`** | Minimum seconds after **`last_rebalance_ts`**. | `1800` (30 min) |
| **`max_swap_slippage_bps`** | Lower bound **`min_a`** for **`add_liquidity_by_contract`**; token **B** leg uses **`min_b = 0`** in **`rebalance`**. | `30` (0.3%) |
| **`dust_reinvest_threshold_bps`** | Dust reinvest threshold (other flows). | `10` |

#### Why avoid `range_half_width_bps = 10000`

At **`10000`**, **`sqrt_lo = 0`** and **`sqrt_hi = 2 × sqrt_current`**, so **`btc_ratio_bps` = 5000** — the vault targets swapping **about half** of available token A into B before re-adding liquidity. That is usually **too aggressive** for price impact and rounding. **`500`** is the intended “narrow band” default in code.

### Example: Aptos CLI (mainnet)

Replace placeholders if your addresses differ; **`yab`** package and vault are pinned in **`Move.toml`** / **`internal-ui` `.env`**.

**Update strategy (admin):**

```bash
aptos move run \
  --profile mainnet_deployer \
  --function-id 0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b::vault::set_strategy_params \
  --args address:0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c u64:500 u64:400 u64:30 \
  --assume-yes
```

**Rebalance (operator or admin)** — set ticks from current pool state and spacing:

```bash
aptos move run \
  --profile mainnet_deployer \
  --function-id 0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b::vault::rebalance \
  --args address:0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c u32:TICK_LOWER u32:TICK_UPPER \
  --assume-yes
```

## Further docs

- [`docs/PYTH_ORACLE.md`](docs/PYTH_ORACLE.md) — Hermes / Pyth, views, and safety params.
- [`docs/MAINNET.md`](docs/MAINNET.md) — mainnet smoke-test log.
- [`docs/WITHDRAW_AND_CLAIM.md`](docs/WITHDRAW_AND_CLAIM.md) — user `withdraw` and operator `claim_rewards`.

## Build

```bash
aptos move compile
aptos move test
```

Named addresses for publishing are in **`Move.toml`** (`[addresses]`).

## Publishing / package upgrade (mainnet)

The package uses **`upgrade_policy = "compatible"`** in **`Move.toml`**. Upgrades use **`aptos move publish`** with the same publisher account as **`yab`** and full **`--named-addresses`** for every named address the compiler resolves (must match **`Move.toml`** or the publish will fail).

**Example (PowerShell, mainnet)** — line continuation is backtick (`` ` ``):

```powershell
aptos move publish `
  --named-addresses yab=0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b,dex_contract=0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c,deployer=0xb31e712b26fd295357355f6845e77c888298636609e93bc9b05f0f604049f434,pyth=0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387,wormhole=0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625 `
  --profile mainnet_deployer `
  --assume-yes
```

**Bash** (one line):

```bash
aptos move publish \
  --named-addresses yab=0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b,dex_contract=0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c,deployer=0xb31e712b26fd295357355f6845e77c888298636609e93bc9b05f0f604049f434,pyth=0x7e783b349d3e89cf5931af376ebeadbfab855b3fa239b7ada8f5a92fbea6b387,wormhole=0x5bc11445584a763c1fa7ed39081f1b920954da14e04b32440cba863d03e19625 \
  --profile mainnet_deployer \
  --assume-yes
```

Harvest / protocol fee behavior after upgrade is documented in **[`docs/WITHDRAW_AND_CLAIM.md`](docs/WITHDRAW_AND_CLAIM.md)** ( **`performance_fee_bps`** on operator harvest only).
