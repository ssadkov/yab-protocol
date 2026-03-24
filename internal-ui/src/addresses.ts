import { AccountAddress } from "@aptos-labs/ts-sdk";

/** AIP-40 long form for view / entry payloads. */
export function normalizeAccountAddress(addr: string): string {
  const s = addr.trim();
  try {
    return AccountAddress.fromStringStrict(s).toString();
  } catch {
    return AccountAddress.fromString(s).toString();
  }
}
