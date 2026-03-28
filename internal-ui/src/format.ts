/** Parse human decimal string to raw base units (bigint). */
export function parseToRaw(amount: string, decimals: number): bigint {
  const s = amount.trim().replace(/\s/g, "");
  if (!s) return 0n;
  const neg = s.startsWith("-");
  const t = neg ? s.slice(1) : s;
  const [intPart, frac = ""] = t.split(".");
  if (!/^\d+$/.test(intPart)) throw new Error("Invalid integer part");
  if (frac && !/^\d+$/.test(frac)) throw new Error("Invalid fractional part");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw =
    BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  return neg ? -raw : raw;
}

/** Move oracle / vault: USD per 1 whole BTC, 8 fractional digits (see `oracle.move`). */
export const BTC_USD_ORACLE_DECIMALS = 8;

/**
 * USD notional from WBTC raw (8-dec) × on-chain BTC/USD raw (8-dec).
 * Product scale 10^16 = 10^8 * 10^8.
 */
export function usdFromBtcRawTimesOracle(
  btcRaw: bigint,
  btcUsdPriceRaw: bigint,
): number {
  if (btcRaw === 0n || btcUsdPriceRaw === 0n) return 0;
  return Number(btcRaw * btcUsdPriceRaw) / 1e16;
}

/** ~USD for stablecoin leg (1 token ≈ $1) — face value only, not vault NAV. */
export function usdFromStableRaw(tokenRaw: bigint, decimals: number): number {
  return Number(tokenRaw) / 10 ** decimals;
}

export function formatUsd(usd: number): string {
  const abs = Math.abs(usd);
  const maxFrac =
    abs === 0 ? 2 : abs < 0.01 ? 6 : abs < 1 ? 4 : 2;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: maxFrac,
  }).format(usd);
}

/** `bps` basis points → percent string, e.g. 1000 → "10%". */
export function formatBpsPercent(bps: bigint): string {
  const n = Number(bps);
  if (!Number.isFinite(n)) return "—";
  const pct = n / 100;
  const fracDigits = pct % 1 === 0 ? 0 : 2;
  return `${pct.toFixed(fracDigits)}%`;
}

/** Oracle / vault-scale USD per 1 BTC (fixed-point `raw`); display with exactly 2 fractional digits. */
export function formatOracleUsdPerBtc(
  raw: bigint,
  oracleDecimals: number,
): string {
  const n = Number(raw) / 10 ** oracleDecimals;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `maxFrac` caps how many fractional digits we print (display only), not token decimals. */
export function formatRaw(raw: bigint, decimals: number, maxFrac = 8): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const intPart = v / base;
  const fracPart = v % base;
  if (fracPart === 0n) return `${neg ? "-" : ""}${intPart.toString()}`;
  let fracStr = fracPart.toString().padStart(decimals, "0");
  fracStr = fracStr.replace(/0+$/, "");
  if (fracStr.length > maxFrac) fracStr = fracStr.slice(0, maxFrac);
  return `${neg ? "-" : ""}${intPart.toString()}.${fracStr}`;
}
