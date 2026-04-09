import { useCallback, useEffect, useMemo, useState } from "react";
import { normalizeAccountAddress } from "./addresses";

const DEFAULT_HYPERION_GRAPHQL_URL = "https://hyperfluid-api.alcove.pro/v1/graphql";

type PoolFromApi = {
  id: string;
  pool: {
    currentTick: number;
    sqrtPrice: string;
    token1: string;
    token2: string;
    feeRate?: number | string;
  };
};

type ViaApiPool = {
  poolId: string;
  currentTick: number;
  sqrtPriceX64: bigint;
  token1: string;
  token2: string;
};

function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(String(v));
}

function pow10(n: number): bigint {
  if (n <= 0) return 1n;
  let x = 1n;
  for (let i = 0; i < n; i++) x *= 10n;
  return x;
}

function formatRational(numerator: bigint, denominator: bigint, fracDigits: number): string {
  if (denominator === 0n) return "—";
  const neg = (numerator < 0n) !== (denominator < 0n);
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const scale = pow10(fracDigits);
  const scaled = (n * scale) / d;
  const intPart = scaled / scale;
  const frac = scaled % scale;
  const fracStr = fracDigits > 0 ? frac.toString().padStart(fracDigits, "0") : "";
  return `${neg ? "-" : ""}${intPart.toString()}${fracDigits > 0 ? `.${fracStr}` : ""}`;
}

function sqrtPriceX64ToPriceBPerA(
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

function deltaTicksForHalfWidthBps(halfWidthBps: number): number {
  const p = Math.max(0, Math.min(10_000, Math.trunc(halfWidthBps))) / 10_000;
  // price range [1-p, 1+p] => tick delta = ln(1+p)/ln(1.0001)
  if (p <= 0) return 0;
  const base = Math.log(1.0001);
  return Math.ceil(Math.log(1 + p) / base);
}

export type ViaApiBands = {
  label: string;
  halfWidthBps: number;
  priceLowBPerA: string;
  priceHighBPerA: string;
  tickLower: number;
  tickUpper: number;
};

export type ViaApiComputed = {
  pool: ViaApiPool;
  priceBPerA: string;
  bands: ViaApiBands[];
};

function graphqlUrl(): string {
  return (import.meta.env.VITE_HYPERION_GRAPHQL_URL?.trim() || DEFAULT_HYPERION_GRAPHQL_URL).trim();
}

async function fetchPools(): Promise<PoolFromApi[]> {
  const query = `
query MyQuery {
  api {
    getPoolStat {
      id
      pool {
        currentTick
        sqrtPrice
        token1
        token2
        feeRate
      }
    }
  }
}`;
  const res = await fetch(graphqlUrl(), {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = (await res.json()) as any;
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    const msg = json.errors
      .map((e: any) => String(e?.message ?? e))
      .filter(Boolean)
      .join("; ");
    throw new Error(`GraphQL errors: ${msg}`);
  }
  const rows = json?.data?.api?.getPoolStat;
  if (Array.isArray(rows)) return rows as PoolFromApi[];
  if (rows && typeof rows === "object") return [rows as PoolFromApi];
  const preview = (() => {
    try {
      return JSON.stringify(json).slice(0, 600);
    } catch {
      return String(json).slice(0, 600);
    }
  })();
  throw new Error(`Unexpected GraphQL response: ${preview}`);
}

function samePair(a1: string, a2: string, b1: string, b2: string): boolean {
  const x1 = normalizeAccountAddress(a1);
  const x2 = normalizeAccountAddress(a2);
  const y1 = normalizeAccountAddress(b1);
  const y2 = normalizeAccountAddress(b2);
  return (x1 === y1 && x2 === y2) || (x1 === y2 && x2 === y1);
}

export function useHyperionViaApiComputed(
  tokenAMetadata: string | null,
  tokenBMetadata: string | null,
  tokenADecimals: number | null,
  tokenBDecimals: number | null,
  halfWidthBpsList: number[],
  pollMs = 30_000,
) {
  const [data, setData] = useState<ViaApiComputed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const wanted = useMemo(() => {
    if (!tokenAMetadata || !tokenBMetadata) return null;
    return { a: tokenAMetadata, b: tokenBMetadata };
  }, [tokenAMetadata, tokenBMetadata]);

  const refresh = useCallback(async () => {
    setError(null);
    if (!wanted || tokenADecimals == null || tokenBDecimals == null) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const pools = await fetchPools();
      const hit = pools.find((p) => samePair(p.pool.token1, p.pool.token2, wanted.a, wanted.b));
      if (!hit) throw new Error("Pool not found in via API response");

      const pool: ViaApiPool = {
        poolId: hit.id,
        currentTick: Number(hit.pool.currentTick),
        sqrtPriceX64: toBig(hit.pool.sqrtPrice),
        token1: normalizeAccountAddress(hit.pool.token1),
        token2: normalizeAccountAddress(hit.pool.token2),
      };

      // Interpret “A” as tokenA (vault token A), “B” as tokenB (vault token B).
      // If API token order differs, invert by swapping decimals and taking reciprocal is harder;
      // simplest is to compute both directions and pick the one matching addresses.
      const aNorm = normalizeAccountAddress(wanted.a);
      const token1IsA = pool.token1 === aNorm;

      const priceBPerA = token1IsA
        ? sqrtPriceX64ToPriceBPerA(pool.sqrtPriceX64, tokenADecimals, tokenBDecimals, 6)
        : // if token1 is B, then sqrtPrice encodes (token2 per token1) = (A per B); invert by swapping decimals
          sqrtPriceX64ToPriceBPerA(pool.sqrtPriceX64, tokenBDecimals, tokenADecimals, 6);

      const uniqueBands = Array.from(
        new Set(
          (halfWidthBpsList ?? [])
            .map((x) => Math.trunc(Number(x)))
            .filter((x) => Number.isFinite(x)),
        ),
      )
        .map((x) => Math.max(0, Math.min(10_000, x)))
        .sort((x, y) => x - y);

      const bands: ViaApiBands[] = uniqueBands.map((bps) => {
        const dt = deltaTicksForHalfWidthBps(bps);
        const tickLower = pool.currentTick - dt;
        const tickUpper = pool.currentTick + dt;
        const label = bps === 500 ? "±5%" : bps === 1000 ? "±10%" : `±${(bps / 100).toFixed(2)}%`;

        // price ranges in B per A (string) from bps directly (no sqrt math needed)
        // We keep 6 decimals to match the main price display.
        const p = Math.max(0, Math.min(10_000, bps));

        // Parse priceBPerA back to rational is messy; instead show ranges derived from current sqrt price:
        // reuse sqrt scaling in price space: low/high prices are current price * (1±p).
        // We'll compute with 12-dec scaling based on decimal string.
        const cur = Number(priceBPerA);
        const low = cur * (1 - p / 10_000);
        const high = cur * (1 + p / 10_000);
        const priceLowBPerA = Number.isFinite(low) ? low.toFixed(6) : "—";
        const priceHighBPerA = Number.isFinite(high) ? high.toFixed(6) : "—";

        return { label, halfWidthBps: bps, priceLowBPerA, priceHighBPerA, tickLower, tickUpper };
      });

      setData({ pool, priceBPerA, bands });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [wanted, tokenADecimals, tokenBDecimals, halfWidthBpsList]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { data, error, loading, refresh };
}

