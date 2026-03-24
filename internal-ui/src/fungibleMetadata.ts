import type { Aptos } from "@aptos-labs/ts-sdk";
import { normalizeAccountAddress } from "./addresses";
import { moveResourceData } from "./moveResourceData";

const METADATA_RESOURCE = "0x1::fungible_asset::Metadata" as const;

/**
 * On-chain decimals for a fungible asset metadata object (not env).
 * Falls back to `null` if the resource is missing or malformed.
 */
export async function fetchFungibleDecimals(
  aptos: Aptos,
  metadataObjectAddress: string,
): Promise<number | null> {
  try {
    const resource = await aptos.getAccountResource({
      accountAddress: normalizeAccountAddress(metadataObjectAddress),
      resourceType: METADATA_RESOURCE,
    });
    const d = moveResourceData(resource);
    const dec = d.decimals;
    if (typeof dec === "number" && Number.isInteger(dec) && dec >= 0 && dec <= 32) {
      return dec;
    }
    if (typeof dec === "bigint") return Number(dec);
  } catch {
    // missing metadata or wrong address
  }
  return null;
}
