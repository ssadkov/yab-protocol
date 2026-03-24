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
  usdcLegToTokenAEquivRaw,
  yabPriceRaw,
} from "./vaultMath";
import { fetchFungibleDecimals } from "./fungibleMetadata";

export type VaultSnapshot = {
  tokenAMetadata: string;
  tokenBMetadata: string;
  /** From `0x1::fungible_asset::Metadata` (env fallback if fetch fails) */
  tokenADecimals: number;
  tokenBDecimals: number;
  /** BTC/USD used for NAV (8-decimal USD/BTC scale); from `oracle::btc_usd_price_safe` or fallback to cached */
  btcUsdPriceRaw: bigint;
  /** `position_btc` + `free_btc` (VaultState) */
  tokenARaw: bigint;
  /** `position_usdc` + `free_usdc` */
  tokenBRaw: bigint;
  positionBtcRaw: bigint;
  positionUsdcRaw: bigint;
  freeBtcRaw: bigint;
  freeUsdcRaw: bigint;
  /** USDC→token-A eq (two `/` like on-chain); `tokenARaw + usdcBtcEquivRaw === totalAssetsRaw` */
  usdcBtcEquivRaw: bigint;
  totalAssetsRaw: bigint;
  /** Total YAB supply (raw FA units); same view used for `yabPriceRaw` */
  yabSupplyRaw: bigint;
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
      const [tokenADecimals, tokenBDecimals] = await Promise.all([
        fetchFungibleDecimals(aptos, tokenAMetadata).then(
          (x) => x ?? TOKEN_A_DECIMALS,
        ),
        fetchFungibleDecimals(aptos, tokenBMetadata).then(
          (x) => x ?? TOKEN_B_DECIMALS,
        ),
      ]);
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
      const usdcBtcEquiv = usdcLegToTokenAEquivRaw(posB, freeB, btcUsd);
      const yabP = yabPriceRaw(total, supply);

      setData({
        tokenAMetadata,
        tokenBMetadata,
        tokenADecimals,
        tokenBDecimals,
        btcUsdPriceRaw: btcUsd,
        tokenARaw: posA + freeA,
        tokenBRaw: posB + freeB,
        positionBtcRaw: posA,
        positionUsdcRaw: posB,
        freeBtcRaw: freeA,
        freeUsdcRaw: freeB,
        usdcBtcEquivRaw: usdcBtcEquiv,
        totalAssetsRaw: total,
        yabSupplyRaw: supply,
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
    tokenADecimals: data?.tokenADecimals ?? TOKEN_A_DECIMALS,
    tokenBDecimals: data?.tokenBDecimals ?? TOKEN_B_DECIMALS,
  };
}
