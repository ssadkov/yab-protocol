import { useCallback, useEffect, useState } from "react";
import { getAptos } from "./aptosClient";
import {
  MODULE_ADDRESS,
  TOKEN_A_DECIMALS,
  TOKEN_B_DECIMALS,
  VAULT_ADDRESS_NORMALIZED,
  VAULT_STATE_TYPE,
} from "./config";
import { normalizeAccountAddress } from "./addresses";
import { moveResourceData } from "./moveResourceData";
import {
  parseFungibleSupplyView,
  totalAssetsTokenAEquiv,
  yabPriceRaw,
} from "./vaultMath";

export type VaultSnapshot = {
  tokenAMetadata: string;
  tokenBMetadata: string;
  tokenARaw: bigint;
  tokenBRaw: bigint;
  totalAssetsRaw: bigint;
  yabPriceRaw: bigint;
  centerPrice: bigint;
  lastRecordedPrice: bigint;
  lastRebalanceTs: bigint;
  performanceFeeBps: bigint;
};

function toBig(v: unknown): bigint {
  if (typeof v === "bigint") return v;
  if (typeof v === "number") return BigInt(Math.trunc(v));
  return BigInt(String(v));
}

export function useVaultData(pollMs = 15_000) {
  const [data, setData] = useState<VaultSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    const aptos = getAptos();
    setError(null);
    try {
      const resource = await aptos.getAccountResource({
        accountAddress: VAULT_ADDRESS_NORMALIZED,
        resourceType: VAULT_STATE_TYPE,
      });
      const d = moveResourceData(resource);
      const tokenAMetadata = normalizeAccountAddress(
        String(d.token_a_metadata ?? ""),
      );
      const tokenBMetadata = normalizeAccountAddress(
        String(d.token_b_metadata ?? ""),
      );
      const posA = toBig(d.position_btc);
      const posB = toBig(d.position_usdc);
      const freeA = toBig(d.free_btc);
      const freeB = toBig(d.free_usdc);
      const lastRec = toBig(d.last_recorded_price);

      let btcUsd = lastRec;
      try {
        const safe = await aptos.view({
          payload: {
            function: `${MODULE_ADDRESS}::oracle::btc_usd_price_safe`,
            functionArguments: [lastRec],
          },
        });
        btcUsd = toBig(safe[0]);
      } catch {
        if (lastRec > 0n) {
          btcUsd = lastRec;
        }
      }

      const supplyView = await aptos.view({
        payload: {
          function: "0x1::fungible_asset::supply",
          typeArguments: ["0x1::fungible_asset::Metadata"],
          functionArguments: [VAULT_ADDRESS_NORMALIZED],
        },
      });
      const supply = parseFungibleSupplyView(supplyView);

      const total = totalAssetsTokenAEquiv(posA, posB, freeA, freeB, btcUsd);
      const yabP = yabPriceRaw(total, supply);

      setData({
        tokenAMetadata,
        tokenBMetadata,
        tokenARaw: posA + freeA,
        tokenBRaw: posB + freeB,
        totalAssetsRaw: total,
        yabPriceRaw: yabP,
        centerPrice: toBig(d.center_price),
        lastRecordedPrice: lastRec,
        lastRebalanceTs: toBig(d.last_rebalance_ts),
        performanceFeeBps: toBig(d.performance_fee_bps),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return {
    data,
    error,
    loading,
    refresh,
    tokenADecimals: TOKEN_A_DECIMALS,
    tokenBDecimals: TOKEN_B_DECIMALS,
  };
}
