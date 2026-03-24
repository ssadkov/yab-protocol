import { useCallback, useEffect, useState } from "react";
import { getAptos } from "./aptosClient";
import { VAULT_ADDRESS_NORMALIZED } from "./config";
import { normalizeAccountAddress } from "./addresses";

const BALANCE_VIEW = "0x1::primary_fungible_store::balance";
const METADATA_TYPE = "0x1::fungible_asset::Metadata";

async function primaryBalance(
  owner: string,
  metadataAddress: string,
): Promise<bigint> {
  const aptos = getAptos();
  const ownerNorm = normalizeAccountAddress(owner);
  const metaNorm = normalizeAccountAddress(metadataAddress);
  const result = await aptos.view({
    payload: {
      function: BALANCE_VIEW,
      typeArguments: [METADATA_TYPE],
      functionArguments: [ownerNorm, metaNorm],
    },
  });
  return BigInt(String(result[0]));
}

/** `yabMetadataAddress` defaults to the vault object (YAB `Metadata` lives there). */
export function useWalletBalances(
  owner: string | undefined,
  tokenAMetadata: string | undefined,
  tokenBMetadata: string | undefined,
  yabMetadataAddress: string = VAULT_ADDRESS_NORMALIZED,
  pollMs = 12_000,
) {
  const [balanceA, setBalanceA] = useState<bigint | null>(null);
  const [balanceB, setBalanceB] = useState<bigint | null>(null);
  const [balanceYab, setBalanceYab] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!owner) {
      setBalanceA(null);
      setBalanceB(null);
      setBalanceYab(null);
      return;
    }
    setError(null);
    try {
      const yabMeta = normalizeAccountAddress(yabMetadataAddress);
      const yabPromise = primaryBalance(owner, yabMeta);
      if (!tokenAMetadata || !tokenBMetadata) {
        setBalanceA(null);
        setBalanceB(null);
        setBalanceYab(await yabPromise);
        return;
      }
      const [a, b, y] = await Promise.all([
        primaryBalance(owner, tokenAMetadata),
        primaryBalance(owner, tokenBMetadata),
        yabPromise,
      ]);
      setBalanceA(a);
      setBalanceB(b);
      setBalanceYab(y);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBalanceA(null);
      setBalanceB(null);
      setBalanceYab(null);
    }
  }, [owner, tokenAMetadata, tokenBMetadata, yabMetadataAddress]);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(id);
  }, [refresh, pollMs]);

  return { balanceA, balanceB, balanceYab, error, refresh };
}
