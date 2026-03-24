# Pyth BTC/USD oracle (mainnet)

The `yab::oracle` module reads the **on-chain Pyth cache** for feed id `e62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43` (BTC/USD), normalizes to vault units (USD per 1 BTC × `10^8`), then applies YAB guards: max age, max deviation vs `last_recorded_price`, max confidence ratio.

## Pull model (important)

Pyth on Aptos uses **on-demand updates**: the cached price must be **fresh** when `get_price` runs. Typically you:

1. Fetch a price update payload from **Hermes** (see [Fetch price updates](https://docs.pyth.network/price-feeds/fetch-price-updates)).
2. In the **same transaction**, call `pyth::update_price_feeds` / `update_price_feeds_with_funder` (paying the update fee in APT), then call vault (`deposit`, `withdraw`, etc.).

If the cache is stale, `pyth::get_price` aborts inside `oracle::get_safe_price`.

## View functions (read-only)

| Function | Purpose |
|----------|---------|
| `oracle::btc_usd_snapshot_unsafe` | Raw cached price, conf, publish time, age — **no** Pyth stale check; good for debugging |
| `oracle::btc_usd_price_pyth_only` | Normalized price; uses Pyth `get_price` (respects Pyth stale threshold) |
| `oracle::btc_usd_price_safe(last_recorded_price)` | Same path as vault: Pyth + YAB deviation/confidence checks |
| `oracle::btc_usd_feed_id` | Feed id bytes |
| `oracle::safety_params` | `(MAX_PRICE_AGE_SECS, MAX_DEVIATION_BPS, MAX_CONF_BPS)` |

### CLI example (mainnet)

Replace `<YAB_ADDR>` with your deployed package address.

```bash
aptos move view \
  --function-id <YAB_ADDR>::oracle::btc_usd_snapshot_unsafe \
  --url https://fullnode.mainnet.aptoslabs.com
```

For `btc_usd_price_safe`, pass `last_recorded_price` (e.g. from `VaultState.last_recorded_price`):

```bash
aptos move view \
  --function-id <YAB_ADDR>::oracle::btc_usd_price_safe \
  --args u64:8300000000000 \
  --url https://fullnode.mainnet.aptoslabs.com
```

## Published Pyth package addresses

See [Pyth Aptos addresses](https://docs.pyth.network/price-feeds/core/use-real-time-data/aptos). This repo’s `Move.toml` sets `pyth`, `wormhole`, and `deployer` to mainnet values used by the official deployment.
