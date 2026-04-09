import { useCallback, useEffect, useState } from "react";
import { getAptos } from "./aptosClient";
import {
  CAMPAIGN_REWARD_MODULE_ADDRESS,
  DEX_CONTRACT_ADDRESS,
  VAULT_ADDRESS_NORMALIZED,
} from "./config";
import { normalizeAccountAddress, shortAddress } from "./addresses";
import { fetchFungibleDecimals } from "./fungibleMetadata";

export type CampaignRewardRow = {
  tokenMetadata: string;
  tokenLabel: string;
  unclaimRaw: bigint;
  displayAmount: string;
  decimals: number;
};

export type CampaignRewardsSnapshot = {
  rows: CampaignRewardRow[];
};

function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(String(v));
}

function tokenInnerFromView(v: unknown): string {
  if (typeof v === "string") return normalizeAccountAddress(v);
  if (v && typeof v === "object" && "inner" in v) {
    return normalizeAccountAddress(String((v as { inner: string }).inner));
  }
  return "";
}

function formatFixedFromRaw(raw: bigint, decimals: number, maxFrac = 8): string {
  if (decimals < 0 || decimals > 36) return raw.toString();
  const neg = raw < 0n;
  const n = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const intPart = n / base;
  const frac = n % base;
  if (decimals === 0) return (neg ? "-" : "") + intPart.toString();
  let fracStr = frac.toString().padStart(decimals, "0");
  fracStr = fracStr.slice(0, maxFrac).replace(/0+$/, "");
  if (!fracStr) return (neg ? "-" : "") + intPart.toString();
  return `${neg ? "-" : ""}${intPart}.${fracStr}`;
}

/** Aptos FA metadata object for native APT is commonly `0xa` (normalized). */
const APT_METADATA_NORMALIZED = normalizeAccountAddress("0xa");

function labelForMetadata(addr: string): string {
  if (addr === APT_METADATA_NORMALIZED) return "APT";
  return shortAddress(addr, 8, 6);
}

type PendingRewardLike = {
  token?: unknown;
  unclaim_amount?: unknown;
  total?: unknown;
  claimed_amount?: unknown;
};

function collectPendingRewards(raw: unknown): PendingRewardLike[] {
  const out: PendingRewardLike[] = [];
  const visit = (x: unknown) => {
    if (!x || typeof x !== "object") return;
    const o = x as Record<string, unknown>;
    if ("unclaim_amount" in o && "token" in o) {
      out.push(o as PendingRewardLike);
      return;
    }
    if (Array.isArray(x)) {
      for (const e of x) visit(e);
    }
  };
  visit(raw);
  return out;
}

export function useCampaignRewards(
  tokenAMetadata: string | null,
  tokenBMetadata: string | null,
  feeTier: number | null,
  pollMs = 60_000,
) {
  const [data, setData] = useState<CampaignRewardsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setError(null);
    const a = tokenAMetadata ? normalizeAccountAddress(tokenAMetadata) : null;
    const b = tokenBMetadata ? normalizeAccountAddress(tokenBMetadata) : null;
    if (a == null || b == null || feeTier == null) {
      setData(null);
      setLoading(false);
      return;
    }
    try {
      const aptos = getAptos();

      const poolView = await aptos.view({
        payload: {
          function: `${DEX_CONTRACT_ADDRESS}::pool_v3::liquidity_pool`,
          functionArguments: [a, b, feeTier],
        },
      });
      const poolInner = tokenInnerFromView(poolView[0]);
      if (!poolInner) throw new Error("Could not parse pool address from liquidity_pool()");

      const claimView = await aptos.view({
        payload: {
          function: `${CAMPAIGN_REWARD_MODULE_ADDRESS}::reward::get_claimable_reward_by_pool`,
          functionArguments: [VAULT_ADDRESS_NORMALIZED, poolInner],
        },
      });

      const pending = collectPendingRewards(claimView[0]);
      const rows: CampaignRewardRow[] = [];

      for (const p of pending) {
        const meta = tokenInnerFromView(p.token);
        if (!meta) continue;
        const unclaimRaw = toBig(p.unclaim_amount ?? 0);
        if (unclaimRaw === 0n) continue;
        const dec = (await fetchFungibleDecimals(aptos, meta)) ?? 8;
        rows.push({
          tokenMetadata: meta,
          tokenLabel: labelForMetadata(meta),
          unclaimRaw,
          displayAmount: formatFixedFromRaw(unclaimRaw, dec),
          decimals: dec,
        });
      }

      setData({ rows });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [tokenAMetadata, tokenBMetadata, feeTier]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { data, error, loading, refresh };
}
