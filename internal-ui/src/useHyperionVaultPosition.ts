import { useCallback, useEffect, useState } from "react";
import { normalizeAccountAddress } from "./addresses";
import { VAULT_ADDRESS_NORMALIZED } from "./config";

const APT_METADATA_ADDRESS = normalizeAccountAddress("0xa");

/** Default Yield AI endpoint; override with `VITE_HYPERION_USER_POSITIONS_URL`. */
export const DEFAULT_HYPERION_USER_POSITIONS_URL =
  "https://yieldai.app/api/protocols/hyperion/userPositions";

export type HyperionPoolInfo = {
  currentTick: number;
  feeRate?: string;
  feeTier: number;
  poolId: string;
  token1: string;
  token2: string;
  token1Info: { symbol: string; decimals: number; name?: string };
  token2Info: { symbol: string; decimals: number; name?: string };
};

export type HyperionFeeEntry = {
  amount: string;
  amountUSD: string;
  token: string;
};

export type HyperionPositionEntry = {
  isActive: boolean;
  value: string;
  farm?: { unclaimed?: HyperionFeeEntry[] };
  fees?: { unclaimed?: HyperionFeeEntry[] };
  position: {
    objectId: string;
    poolId: string;
    tickLower: number;
    tickUpper: number;
    createdAt?: string;
    pool: HyperionPoolInfo;
  };
};

type ApiEnvelope = {
  success?: boolean;
  data?: HyperionPositionEntry[];
};

function hyperionPositionsUrl(): string {
  const custom = import.meta.env.VITE_HYPERION_USER_POSITIONS_URL?.trim();
  const q = `?address=${encodeURIComponent(VAULT_ADDRESS_NORMALIZED)}`;
  if (custom) {
    const sep = custom.includes("?") ? "&" : "?";
    return `${custom}${sep}address=${encodeURIComponent(VAULT_ADDRESS_NORMALIZED)}`;
  }
  /**
   * In browsers, `yieldai.app` is typically blocked by CORS when called directly.
   * Default to same-origin proxy in production when available (Vercel rewrite),
   * and allow opting out via `VITE_HYPERION_USE_PROXY=false`.
   */
  const useProxy =
    import.meta.env.DEV ||
    (import.meta.env.PROD && import.meta.env.VITE_HYPERION_USE_PROXY !== "false");
  if (useProxy) {
    return `/api/yieldai/api/protocols/hyperion/userPositions${q}`;
  }
  return `${DEFAULT_HYPERION_USER_POSITIONS_URL}${q}`;
}

export function feeTokenLabel(
  pool: HyperionPoolInfo,
  tokenAddress: string,
): string {
  const t = normalizeAccountAddress(tokenAddress);
  try {
    if (t === normalizeAccountAddress(pool.token1)) return pool.token1Info.symbol;
    if (t === normalizeAccountAddress(pool.token2)) return pool.token2Info.symbol;
    if (t === APT_METADATA_ADDRESS) return "APT";
  } catch {
    /* ignore */
  }
  return `${tokenAddress.slice(0, 10)}…`;
}

export function useHyperionVaultPosition(pollMs = 30_000) {
  const [positions, setPositions] = useState<HyperionPositionEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(hyperionPositionsUrl(), {
        headers: { Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiEnvelope;
      if (!json.success || !Array.isArray(json.data)) {
        throw new Error("Unexpected API response");
      }
      setPositions(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPositions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { positions, loading, error, refresh };
}
