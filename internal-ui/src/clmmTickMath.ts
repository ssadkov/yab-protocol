/**
 * CLMM tick → price helpers for Hyperion / Uniswap v3–style pools.
 * Sqrt ratio at tick matches Uniswap v3 TickMath (Q64.96); we convert to Hyperion Q64.64 via >> 32.
 * SPDX reference: Uniswap v3-core TickMath.sol (GPL-2.0-or-later).
 */

import { normalizeAccountAddress } from "./addresses";
import type { HyperionPoolInfo } from "./useHyperionVaultPosition";

const MIN_TICK = -887272;
const MAX_TICK = 887272;
const MAX_UINT256 = (1n << 256n) - 1n;

function mulShift(val: bigint, mulBy: bigint): bigint {
  return (val * mulBy) >> 128n;
}

/** @returns sqrt(1.0001^tick) * 2^96 as bigint (uint160 range) */
export function getSqrtRatioAtTickQ96(tick: number): bigint {
  if (!Number.isInteger(tick)) {
    throw new Error("tick must be an integer");
  }
  if (tick < MIN_TICK || tick > MAX_TICK) {
    throw new Error("tick out of bounds");
  }

  const absTick = tick < 0 ? -tick : tick;
  const a = absTick;

  let ratio =
    (a & 1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n;
  if ((a & 0x2) !== 0) ratio = mulShift(ratio, 0xfff97272373d413259a46990580e213an);
  if ((a & 0x4) !== 0) ratio = mulShift(ratio, 0xfff2e50f5f656932ef12357cf3c7fdccn);
  if ((a & 0x8) !== 0) ratio = mulShift(ratio, 0xffe5caca7e10e4e61c3624eaa0941cd0n);
  if ((a & 0x10) !== 0) ratio = mulShift(ratio, 0xffcb9843d60f6159c9db58835c926644n);
  if ((a & 0x20) !== 0) ratio = mulShift(ratio, 0xff973b41fa98c081472e6896dfb254c0n);
  if ((a & 0x40) !== 0) ratio = mulShift(ratio, 0xff2ea16466c96a3843ec78b326b52861n);
  if ((a & 0x80) !== 0) ratio = mulShift(ratio, 0xfe5dee046a99a2a811c461f1969c3053n);
  if ((a & 0x100) !== 0) ratio = mulShift(ratio, 0xfcbe86c7900a88aedcffc83b479aa3a4n);
  if ((a & 0x200) !== 0) ratio = mulShift(ratio, 0xf987a7253ac413176f2b074cf7815e54n);
  if ((a & 0x400) !== 0) ratio = mulShift(ratio, 0xf3392b0822b70005940c7a398e4b70f3n);
  if ((a & 0x800) !== 0) ratio = mulShift(ratio, 0xe7159475a2c29b7443b29c7fa6e889d9n);
  if ((a & 0x1000) !== 0) ratio = mulShift(ratio, 0xd097f3bdfd2022b8845ad8f792aa5825n);
  if ((a & 0x2000) !== 0) ratio = mulShift(ratio, 0xa9f746462d870fdf8a65dc1f90e061e5n);
  if ((a & 0x4000) !== 0) ratio = mulShift(ratio, 0x70d869a156d2a1b890bb3df62baf32f7n);
  if ((a & 0x8000) !== 0) ratio = mulShift(ratio, 0x31be135f97d08fd981231505542fcfa6n);
  if ((a & 0x10000) !== 0) ratio = mulShift(ratio, 0x9aa508b5b7a84e1c677de54f3e99bc9n);
  if ((a & 0x20000) !== 0) ratio = mulShift(ratio, 0x5d6af8dedb81196699c329225ee604n);
  if ((a & 0x40000) !== 0) ratio = mulShift(ratio, 0x2216e584f5fa1ea926041bedfe98n);
  if ((a & 0x80000) !== 0) ratio = mulShift(ratio, 0x48a170391f7dc42444e8fa2n);

  if (tick > 0) {
    ratio = MAX_UINT256 / ratio;
  }

  const q32 = 1n << 32n;
  const sqrtPriceX96 = (ratio >> 32n) + (ratio % q32 === 0n ? 0n : 1n);
  return sqrtPriceX96;
}

function pow10(n: number): bigint {
  if (n <= 0) return 1n;
  let x = 1n;
  for (let i = 0; i < n; i++) x *= 10n;
  return x;
}

function formatRational(
  numerator: bigint,
  denominator: bigint,
  fracDigits: number,
): string {
  if (denominator === 0n) return "—";
  const neg = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const scale = pow10(fracDigits);
  const scaled = (n * scale) / d;
  const intPart = scaled / scale;
  const frac = scaled % scale;
  const fracStr =
    fracDigits > 0 ? frac.toString().padStart(fracDigits, "0") : "";
  return `${neg ? "-" : ""}${intPart.toString()}${
    fracDigits > 0 ? `.${fracStr}` : ""
  }`;
}

/** Price of token B per 1 token A: (sqrt^2 / 2^128) * 10^(decA - decB). Matches on-chain Hyperion Q64.64 usage. */
export function sqrtPriceX64ToPriceBPerA(
  sqrtPriceX64: bigint,
  tokenADecimals: number,
  tokenBDecimals: number,
  fracDigits = 6,
): string {
  const q128 = 1n << 128n;
  const numBase = sqrtPriceX64 * sqrtPriceX64;
  const exp = tokenADecimals - tokenBDecimals;
  const num = exp >= 0 ? numBase * pow10(exp) : numBase;
  const den = exp >= 0 ? q128 : q128 * pow10(-exp);
  return formatRational(num, den, fracDigits);
}

export type VaultDecimalsSnapshot = {
  tokenAMetadata: string;
  tokenADecimals: number;
  tokenBDecimals: number;
};

/**
 * Human-readable price at tick: amount of pool token2 per 1 pool token1 (same convention as StrategyCard pool label).
 * When `vault` is set, uses vault token A/B decimals and address order like `useHyperionViaApiPool`.
 */
export function pricePoolToken2PerToken1AtTick(
  tick: number,
  pool: HyperionPoolInfo,
  vault: VaultDecimalsSnapshot | null | undefined,
  fracDigits = 4,
): string | null {
  try {
    const q96 = getSqrtRatioAtTickQ96(tick);
    const sqrtX64 = q96 >> 32n;

    let decA: number;
    let decB: number;
    let token1IsVaultA: boolean;
    if (vault?.tokenAMetadata) {
      decA = vault.tokenADecimals;
      decB = vault.tokenBDecimals;
      token1IsVaultA =
        normalizeAccountAddress(pool.token1) ===
        normalizeAccountAddress(vault.tokenAMetadata);
    } else {
      decA = pool.token1Info.decimals;
      decB = pool.token2Info.decimals;
      token1IsVaultA = true;
    }

    const s = token1IsVaultA
      ? sqrtPriceX64ToPriceBPerA(sqrtX64, decA, decB, fracDigits)
      : sqrtPriceX64ToPriceBPerA(sqrtX64, decB, decA, fracDigits);
    return s;
  } catch {
    return null;
  }
}
