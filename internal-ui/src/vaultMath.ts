/** Token-B (USDC) 6-dec raw ↔ token-A 8-dec raw; matches `vault::USDC_TO_BTC_RAW_MULT` (10^10). */
export const USDC_TO_BTC_RAW_MULT = 10_000_000_000n;

/** USDC raw → BTC-equivalent raw at vault oracle scale (`usdc_raw_to_btc_raw_equiv`). */
export function usdcRawToBtcRawEquiv(
  usdcRaw: bigint,
  btcPrice8dec: bigint,
): bigint {
  if (btcPrice8dec <= 0n) return 0n;
  return (usdcRaw * USDC_TO_BTC_RAW_MULT) / btcPrice8dec;
}

/** Mirrors `deposit`: `shares = token_a_in * 10^8 / yab_price`. */
export function estimateYabMintRawFromTokenA(
  tokenARaw: bigint,
  yabPriceRaw: bigint,
): bigint {
  if (yabPriceRaw <= 0n) return 0n;
  return (tokenARaw * 100_000_000n) / yabPriceRaw;
}

/** Mirrors `deposit_dual` / USDC leg: `shares = btc_in_equiv * 10^8 / yab_price`. */
export function estimateYabMintRawFromBtcEquiv(
  btcEquivRaw: bigint,
  yabPriceRaw: bigint,
): bigint {
  if (yabPriceRaw <= 0n) return 0n;
  return (btcEquivRaw * 100_000_000n) / yabPriceRaw;
}

/** Token-A 8-dec raw → USDC 6-dec raw at vault oracle scale; inverse of dividing USDC by `btcPrice8dec` via `usdc_raw_to_btc_raw_equiv`. */
export function btcRawToUsdcRaw(btcARaw: bigint, btcPrice8dec: bigint): bigint {
  if (btcARaw <= 0n || btcPrice8dec <= 0n) return 0n;
  return (btcARaw * btcPrice8dec) / USDC_TO_BTC_RAW_MULT;
}

/**
 * Mirrors vault.move `get_total_assets`: token-B leg converted to token-A equivalent at vault-scale BTC/USD price.
 * `btcPrice8dec` = USD per 1 BTC with 8 fractional digits (same scale as on-chain).
 */
export function totalAssetsTokenAEquiv(
  positionBtc: bigint,
  positionUsdc: bigint,
  freeBtc: bigint,
  freeUsdc: bigint,
  btcPrice8dec: bigint,
): bigint {
  if (btcPrice8dec <= 0n) return 0n;
  const posEquiv =
    positionBtc + (positionUsdc * USDC_TO_BTC_RAW_MULT) / btcPrice8dec;
  const freeEquiv = freeBtc + (freeUsdc * USDC_TO_BTC_RAW_MULT) / btcPrice8dec;
  return posEquiv + freeEquiv;
}

/**
 * USDC → token-A equivalent raw (vault-style): two truncating divisions, not one on the sum.
 * Matches `usdc_raw_to_btc_raw_equiv` for position + free USDC legs.
 */
export function usdcLegToTokenAEquivRaw(
  positionUsdc: bigint,
  freeUsdc: bigint,
  btcPrice8dec: bigint,
): bigint {
  if (btcPrice8dec <= 0n) return 0n;
  return (
    (positionUsdc * USDC_TO_BTC_RAW_MULT) / btcPrice8dec +
    (freeUsdc * USDC_TO_BTC_RAW_MULT) / btcPrice8dec
  );
}

const INITIAL_YAB_PRICE = 100_000_000n;

/** Mirrors vault.move `get_yab_price` when supply > 0. */
export function yabPriceRaw(totalAssetsTokenAEquiv: bigint, supply: bigint): bigint {
  if (supply <= 0n) return INITIAL_YAB_PRICE;
  return (totalAssetsTokenAEquiv * 100_000_000n) / supply;
}

/** Parse `0x1::fungible_asset::supply` view return: Option<u128> JSON as `{ vec: [...] }`. */
export function parseFungibleSupplyView(result: unknown): bigint {
  const row = (result as unknown[])[0];
  if (row && typeof row === "object" && row !== null && "vec" in row) {
    const v = (row as { vec: unknown[] }).vec;
    if (Array.isArray(v) && v.length > 0) {
      return BigInt(String(v[0]));
    }
  }
  return 0n;
}
