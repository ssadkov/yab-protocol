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

/** Short display for long hex addresses (e.g. explorer-style). */
export function shortAddress(addr: string, headChars = 10, tailChars = 8): string {
  const s = addr.trim();
  if (s.length <= headChars + tailChars + 1) return s;
  return `${s.slice(0, headChars)}…${s.slice(-tailChars)}`;
}
