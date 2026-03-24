/** Some wallets encode Move u64 more reliably as `number` (or string if huge). */
export function toEntryU64(value: bigint): number | string {
  if (value <= BigInt(Number.MAX_SAFE_INTEGER)) {
    return Number(value);
  }
  return value.toString();
}

export function transactionHashFromSubmit(result: unknown): string {
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.hash === "string") return r.hash;
    if (typeof r.transactionHash === "string") return r.transactionHash;
  }
  throw new Error("Wallet submit response has no hash / transactionHash");
}
