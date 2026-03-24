/** Parse human decimal string to raw base units (bigint). */
export function parseToRaw(amount: string, decimals: number): bigint {
  const s = amount.trim().replace(/\s/g, "");
  if (!s) return 0n;
  const neg = s.startsWith("-");
  const t = neg ? s.slice(1) : s;
  const [intPart, frac = ""] = t.split(".");
  if (!/^\d+$/.test(intPart)) throw new Error("Invalid integer part");
  if (frac && !/^\d+$/.test(frac)) throw new Error("Invalid fractional part");
  const fracPadded = (frac + "0".repeat(decimals)).slice(0, decimals);
  const raw =
    BigInt(intPart) * 10n ** BigInt(decimals) + BigInt(fracPadded || "0");
  return neg ? -raw : raw;
}

export function formatRaw(raw: bigint, decimals: number, maxFrac = 8): string {
  const neg = raw < 0n;
  const v = neg ? -raw : raw;
  const base = 10n ** BigInt(decimals);
  const intPart = v / base;
  const fracPart = v % base;
  if (fracPart === 0n) return `${neg ? "-" : ""}${intPart.toString()}`;
  let fracStr = fracPart.toString().padStart(decimals, "0");
  fracStr = fracStr.replace(/0+$/, "");
  if (fracStr.length > maxFrac) fracStr = fracStr.slice(0, maxFrac);
  return `${neg ? "-" : ""}${intPart.toString()}.${fracStr}`;
}
