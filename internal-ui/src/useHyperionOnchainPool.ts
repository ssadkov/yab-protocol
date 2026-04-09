import { useCallback, useEffect, useState } from "react";
import { getAptos } from "./aptosClient";
import { normalizeAccountAddress } from "./addresses";

const DEX_CONTRACT_ADDRESS = normalizeAccountAddress(
  "0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c",
);

function extractAddressLike(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "object" && v) {
    const anyV = v as any;
    if (typeof anyV.inner === "string") return anyV.inner;
    if (typeof anyV.address === "string") return anyV.address;
    if (typeof anyV.value === "string") return anyV.value;
    if (typeof anyV.id === "string") return anyV.id;
  }
  return String(v);
}

type PoolTicks = {
  poolAddress: string;
  feeTier: number;
  tickSpacing: number;
  currentTick: number;
  sqrtPriceX64: bigint;
  priceBPerA: string;
  priceAPerB: string;
  bands: {
    label: string;
    halfWidthBps: number;
    priceLowBPerA: string;
    priceHighBPerA: string;
    tickLower: number;
    tickUpper: number;
  }[];
};

function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(String(v));
}

function snapTickDown(tick: number, spacing: number): number {
  if (spacing <= 0) return tick;
  const r = tick % spacing;
  return tick - (r < 0 ? r + spacing : r);
}

function snapTickUp(tick: number, spacing: number): number {
  if (spacing <= 0) return tick;
  const down = snapTickDown(tick, spacing);
  return down === tick ? tick : down + spacing;
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

function sqrtPriceX64ToPriceBPerA(
  sqrtPriceX64: bigint,
  tokenADecimals: number,
  tokenBDecimals: number,
  fracDigits = 6,
): string {
  // price (B per A) = (sqrtP^2 / 2^128) * 10^(decA - decB)
  const q128 = 1n << 128n;
  const numBase = sqrtPriceX64 * sqrtPriceX64;
  const exp = tokenADecimals - tokenBDecimals;
  const num = exp >= 0 ? numBase * pow10(exp) : numBase;
  const den = exp >= 0 ? q128 : q128 * pow10(-exp);
  return formatRational(num, den, fracDigits);
}

function applySqrtBandFromPriceBps(
  sqrtPriceX64: bigint,
  priceBps: number,
  direction: "down" | "up",
): bigint {
  const p = Math.max(0, Math.min(10_000, priceBps));
  const ratio = direction === "down" ? (10_000 - p) / 10_000 : (10_000 + p) / 10_000;
  const scale = 1_000_000_000_000; // 1e12
  const factor = Math.sqrt(ratio);
  const factorScaled = BigInt(Math.round(factor * scale));
  return (sqrtPriceX64 * factorScaled) / BigInt(scale);
}

export function useHyperionOnchainPoolTicks(
  tokenAMetadata: string | null,
  tokenBMetadata: string | null,
  feeTier: number | null,
  tokenADecimals: number | null,
  tokenBDecimals: number | null,
  halfWidthBpsList: number[],
  pollMs = 30_000,
) {
  const [data, setData] = useState<PoolTicks | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    const a = tokenAMetadata ? normalizeAccountAddress(tokenAMetadata) : null;
    const b = tokenBMetadata ? normalizeAccountAddress(tokenBMetadata) : null;
    if (!a || !b || feeTier == null || tokenADecimals == null || tokenBDecimals == null) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const aptos = getAptos();

      const poolObj = await aptos.view({
        payload: {
          function: `${DEX_CONTRACT_ADDRESS}::pool_v3::liquidity_pool`,
          functionArguments: [a, b, feeTier],
        },
      });
      const rawPoolAddr = extractAddressLike(poolObj[0]);
      let poolAddress: string;
      try {
        poolAddress = normalizeAccountAddress(rawPoolAddr);
      } catch (e) {
        throw new Error(
          `Failed to parse pool address from liquidity_pool(): ${rawPoolAddr} (${e instanceof Error ? e.message : String(e)})`,
        );
      }

      const [spacingView, tickAndPrice] = await Promise.all([
        aptos.view({
          payload: {
            function: `${DEX_CONTRACT_ADDRESS}::pool_v3::get_tick_spacing`,
            functionArguments: [feeTier],
          },
        }),
        aptos.view({
          payload: {
            function: `${DEX_CONTRACT_ADDRESS}::pool_v3::current_tick_and_price`,
            functionArguments: [poolAddress],
          },
        }),
      ]);

      const tickSpacing = Number(toBig(spacingView[0]));
      const currentTickU32 = Number(toBig(tickAndPrice[0]));
      const sqrtPriceX64 = toBig(tickAndPrice[1]);
      const currentTick = currentTickU32; // Hyperion returns u32 tick bits; treat as number for UI

      const priceBPerA = sqrtPriceX64ToPriceBPerA(
        sqrtPriceX64,
        tokenADecimals,
        tokenBDecimals,
        6,
      );
      const priceAPerB = (() => {
        // inverse with same digits; avoid float
        const q128 = 1n << 128n;
        const numBase = sqrtPriceX64 * sqrtPriceX64;
        const exp = tokenADecimals - tokenBDecimals;
        const num = exp >= 0 ? numBase * pow10(exp) : numBase;
        const den = exp >= 0 ? q128 : q128 * pow10(-exp);
        return formatRational(den, num, 12);
      })();

      const uniqueBands = Array.from(
        new Set(
          (halfWidthBpsList ?? [])
            .map((x) => Math.trunc(Number(x)))
            .filter((x) => Number.isFinite(x)),
        ),
      )
        .map((x) => Math.max(0, Math.min(10_000, x)))
        .sort((x, y) => x - y);

      const bandViews = await Promise.all(
        uniqueBands.flatMap((bps) => {
          const sqrtLow = applySqrtBandFromPriceBps(sqrtPriceX64, bps, "down");
          const sqrtHigh = applySqrtBandFromPriceBps(sqrtPriceX64, bps, "up");
          return [
            aptos.view({
              payload: {
                function: `${DEX_CONTRACT_ADDRESS}::tick_math::get_tick_at_sqrt_price`,
                functionArguments: [sqrtLow.toString()],
              },
            }),
            aptos.view({
              payload: {
                function: `${DEX_CONTRACT_ADDRESS}::tick_math::get_tick_at_sqrt_price`,
                functionArguments: [sqrtHigh.toString()],
              },
            }),
          ];
        }),
      );

      const bands = uniqueBands.map((bps, i) => {
        const lowView = bandViews[i * 2];
        const highView = bandViews[i * 2 + 1];
        const tickLow = Number((lowView[0] as any)?.bits ?? lowView[0]);
        const tickHigh = Number((highView[0] as any)?.bits ?? highView[0]);
        const tickLower = snapTickDown(tickLow, tickSpacing);
        const tickUpper = snapTickUp(tickHigh, tickSpacing);

        const sqrtLow = applySqrtBandFromPriceBps(sqrtPriceX64, bps, "down");
        const sqrtHigh = applySqrtBandFromPriceBps(sqrtPriceX64, bps, "up");
        const priceLowBPerA = sqrtPriceX64ToPriceBPerA(
          sqrtLow,
          tokenADecimals,
          tokenBDecimals,
          6,
        );
        const priceHighBPerA = sqrtPriceX64ToPriceBPerA(
          sqrtHigh,
          tokenADecimals,
          tokenBDecimals,
          6,
        );

        const label = bps === 500 ? "±5%" : bps === 1000 ? "±10%" : `±${(bps / 100).toFixed(2)}%`;
        return { label, halfWidthBps: bps, priceLowBPerA, priceHighBPerA, tickLower, tickUpper };
      });

      setData({
        poolAddress,
        feeTier,
        tickSpacing,
        currentTick,
        sqrtPriceX64,
        priceBPerA,
        priceAPerB,
        bands,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [
    tokenAMetadata,
    tokenBMetadata,
    feeTier,
    tokenADecimals,
    tokenBDecimals,
    halfWidthBpsList,
  ]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { data, error, loading, refresh };
}

