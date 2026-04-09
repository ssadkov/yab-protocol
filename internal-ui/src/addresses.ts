import { AccountAddress } from "@aptos-labs/ts-sdk";

/** AIP-40 long form for view / entry payloads. */
export function normalizeAccountAddress(addr: string): string {
  let s = addr.trim();
  // Defensive fix: some APIs return short hex like `0x1` (odd-length hex digits).
  // `AccountAddress.fromString*` may reject odd-length hex depending on code path.
  if (/^0x[0-9a-fA-F]+$/.test(s) && (s.length - 2) % 2 === 1) {
    s = `0x0${s.slice(2)}`;
  }
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
