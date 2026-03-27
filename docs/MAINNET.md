# YAB — mainnet operations log

## Successful WBTC deposit (smoke test)

| Field | Value |
|--------|--------|
| Version | `4652543051` |
| Hash | `0x66dca33962924bc672941b9c1e375c57f6cf688dfd9d423942a43e12d8557ecc` |
| Network | Mainnet |
| VM status | `Executed successfully` |
| Gas used | 11105 units |

**Explorer:** [transaction on Aptos Explorer](https://explorer.aptoslabs.com/txn/0x66dca33962924bc672941b9c1e375c57f6cf688dfd9d423942a43e12d8557ecc?network=mainnet)

**Context (from payload):**

- Function: `0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b::vault::deposit`
- Vault address: `0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c`
- `token_a_in`: `29000` (satoshis / 8-decimal WBTC units)
- Event `Deposited`: `btc_in` 29000, `shares_minted` 24446, user `0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97`

---

## Successful full withdraw (smoke test)

| Field | Value |
|--------|--------|
| Version | `4655975922` |
| Hash | `0xdfb6fe85d0996cfb315b81359a88428eef799f7c9f528c70e12af610f5cf18a6` |
| Network | Mainnet |
| VM status | `Executed successfully` |
| Gas used | 15002 units |

**Explorer:** [transaction on Aptos Explorer](https://explorer.aptoslabs.com/txn/0xdfb6fe85d0996cfb315b81359a88428eef799f7c9f528c70e12af610f5cf18a6?network=mainnet)

**Context (from payload):**

- Function: `0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b::vault::withdraw`
- Vault address: `0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c`
- Shares in: `24446`
- Event `Withdrawn`: `shares_burned` 24446, `btc_out` 15135, user `0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97`

---

## Successful package upgrade (compatible publish)

| Field | Value |
|--------|--------|
| Hash | `0xb9cd87349b8388e3d14f948473809a4f9c54e2564507eb9bd3bc6232ce76c30d` |
| Network | Mainnet |
| VM status | `Executed successfully` |

**Explorer:** [transaction on Aptos Explorer](https://explorer.aptoslabs.com/txn/0xb9cd87349b8388e3d14f948473809a4f9c54e2564507eb9bd3bc6232ce76c30d?network=mainnet)

**Publish command:** see [`README.md`](../README.md) (Publishing / package upgrade). Harvest semantics: [`WITHDRAW_AND_CLAIM.md`](./WITHDRAW_AND_CLAIM.md).

---

## Action plan (next steps)

1. **USDC deposit path** — implement and/or validate user flow for depositing **USDC** (token B) into the vault, not only WBTC (token A). Includes UI/SDK and on-chain `deposit_dual` or equivalent if that is the intended entrypoint.

2. **Production oracle** — **done** in `oracle.move` (Pyth BTC/USD + views). Operators must still **bundle Hermes price updates** in txs when the on-chain cache is stale (see [`PYTH_ORACLE.md`](./PYTH_ORACLE.md)). Consider restoring strict `min_b` on `add_liquidity` after live-oracle validation.

3. **Claim smoke test** — run `vault::claim_rewards` (operator/admin) or `vault::claim_rewards_with_pyth_update` when cache freshness is uncertain; paste tx hash here when done.

---

*Last updated: from user-confirmed successful mainnet deposit.*
