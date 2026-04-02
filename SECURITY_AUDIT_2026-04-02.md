# Security Audit — YAB Vault (Aptos Move)

Date: 2026-04-02
Reviewer: Codex (security-audit skill)

Scope:
- `sources/vault.move`
- `sources/oracle.move`
- `sources/strategy.move`
- `sources/math.move`
- `sources/errors.move`

## Top risks (prioritized)

1. **Critical** — Withdrawal overpayment from position leg transfers all withdrawn assets instead of capping to `owed` amount.
2. **Critical** — `withdraw_usdc` can transfer *all* free BTC swap output to caller for tiny share burns.
3. **High** — No practical slippage bounds on many swaps and liquidity ops (`min=0` and global sqrt limits), enabling sandwich/price-manipulation loss.
4. **High** — Strategy params are not fully bounded; invalid values can brick rebalances/deposits due arithmetic underflow.
5. **Medium** — `deposit` (token-A path) can mint zero shares without abort, causing silent user loss.
6. **Medium** — Unsupported reward assets are redirected to treasury rather than vault accounting (value extraction from LPs by policy).
7. **Medium** — `set_operator` allows zero address, potentially disabling critical operations.
8. **Low/Medium** — Oracle timestamp subtraction can underflow if feed timestamp is in the future (clock skew/invalid feed edge).
9. **Low** — Initialization lacks explicit guardrails for `treasury`/`operator` non-zero validation.
10. **Low** — Multiple safety-critical constants are hardcoded (oracle tolerances, deadline), increasing governance/ops risk.

## Recommended immediate fixes

- Implement exact payout accounting in withdraw paths: track `paid_out` and return residual assets back to vault.
- Add explicit slippage controls for user-facing entrypoints (`min_out`, `max_price_impact_bps`).
- Add upper bounds checks for governance params (`<= 10000` where bps expected).
- Enforce `shares > 0` on every mint path.
- Emit additional events for admin changes and parameter updates.
