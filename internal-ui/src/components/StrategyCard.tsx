import type { HyperionPositionEntry } from "../useHyperionVaultPosition";
import { feeTokenLabel } from "../useHyperionVaultPosition";
import { shortAddress } from "../addresses";

function sumUnclaimedUsd(
  entries: { amountUSD: string }[] | undefined,
): number {
  if (!entries?.length) return 0;
  return entries.reduce((acc, e) => acc + Number(e.amountUSD || 0), 0);
}

/** Position of current tick on [tickLower, tickUpper]; can be outside 0–1. */
function tickMarkerFraction(
  tickLower: number,
  tickUpper: number,
  currentTick: number,
): number {
  if (tickUpper === tickLower) return 0.5;
  return (currentTick - tickLower) / (tickUpper - tickLower);
}

type StrategyCardProps = {
  loading: boolean;
  error: string | null;
  positions: HyperionPositionEntry[];
  onRefresh: () => void;
};

export function StrategyCard({
  loading,
  error,
  positions,
  onRefresh,
}: StrategyCardProps) {
  const hp = positions[0];
  const pool = hp?.position.pool;

  const unclaimedFeesUsd = hp
    ? sumUnclaimedUsd(hp.fees?.unclaimed) +
      sumUnclaimedUsd(hp.farm?.unclaimed)
    : 0;

  const tickLower = hp?.position.tickLower ?? 0;
  const tickUpper = hp?.position.tickUpper ?? 1;
  const currentTick = pool?.currentTick ?? tickLower;
  const frac = tickMarkerFraction(tickLower, tickUpper, currentTick);
  const markerPct = Math.min(100, Math.max(0, frac * 100));
  const inRange =
    currentTick >= Math.min(tickLower, tickUpper) &&
    currentTick <= Math.max(tickLower, tickUpper);

  const poolLabel = pool
    ? `${pool.token1Info.symbol} / ${pool.token2Info.symbol}`
    : "—";

  const explorerNet = (import.meta.env.VITE_NETWORK ?? "mainnet").toLowerCase();
  const objUrl = hp
    ? `https://explorer.aptoslabs.com/object/${encodeURIComponent(hp.position.objectId)}?network=${explorerNet}`
    : "";

  return (
    <div className="mb-8 rounded-xl border-l-4 border-primary bg-surface-container-low p-6 shadow-lg md:p-8">
      <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
        <div>
          <div className="mb-1 flex flex-wrap items-center gap-3">
            <h3 className="font-headline text-lg font-bold tracking-tight md:text-xl">
              {loading ? "Hyperion strategy" : poolLabel}
            </h3>
            {hp && (
              <span
                className={
                  hp.isActive
                    ? "rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-primary"
                    : "rounded-full border border-outline-variant/30 bg-surface-container-high px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant"
                }
              >
                {hp.isActive ? "Active" : "Inactive"}
              </span>
            )}
          </div>
          <p className="text-sm text-on-surface-variant">
            {pool
              ? `Fee Tier: ${pool.feeTier} · CLMM concentrated liquidity`
              : "No CLMM position data for this vault."}
          </p>
          {hp && (
            <p className="mt-2 font-mono text-[10px] text-on-surface-variant/70">
              <a
                href={objUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary hover:underline"
              >
                {shortAddress(hp.position.objectId)}
              </a>
            </p>
          )}
        </div>
        <div className="text-left sm:text-right">
          <p className="mb-1 text-xs uppercase tracking-widest text-on-surface-variant">
            Unclaimed (fees + farm)
          </p>
          <p className="font-mono text-2xl font-bold text-secondary">
            {loading
              ? "…"
              : hp
                ? `$${unclaimedFeesUsd.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}`
                : "—"}
          </p>
        </div>
      </div>

      {error && (
        <p className="mb-4 text-sm text-error">
          {error}{" "}
          <button
            type="button"
            className="font-bold text-primary underline"
            onClick={() => onRefresh()}
          >
            Retry
          </button>
        </p>
      )}

      {!loading && !error && positions.length === 0 && (
        <p className="mb-6 text-sm text-on-surface-variant">
          No positions returned for this vault address. Check indexer / proxy.
        </p>
      )}

      <div className="relative pb-2 pt-4">
        <div className="mb-2 flex justify-between font-mono text-[10px] uppercase text-on-surface-variant/60">
          <span>Min Tick: {hp ? tickLower : "—"}</span>
          <span className={inRange ? "font-bold text-secondary" : ""}>
            Current: {hp ? currentTick : "—"}
          </span>
          <span>Max Tick: {hp ? tickUpper : "—"}</span>
        </div>
        <div className="relative h-3 w-full overflow-hidden rounded-full bg-surface-container-high">
          {hp && (
            <>
              <div className="absolute inset-y-0 left-0 right-0 bg-primary/10" />
              <div
                className="absolute inset-y-0 bg-primary/25"
                style={{
                  left: "0%",
                  width: "100%",
                }}
              />
              <div
                className="absolute top-0 z-10 h-full w-1 rounded-sm bg-secondary shadow-[0_0_8px_rgba(255,185,95,0.8)]"
                style={{ left: `calc(${markerPct}% - 2px)` }}
              />
            </>
          )}
        </div>
        {hp && (
          <div className="mt-4 flex justify-center">
            <div className="flex items-center gap-2 rounded bg-surface-container-highest px-3 py-1 font-mono text-[10px] text-on-surface-variant">
              <span
                className={`h-2 w-2 rounded-full ${inRange ? "animate-pulse bg-primary" : "bg-on-surface-variant/40"}`}
              />
              {inRange
                ? "POSITION IN RANGE (FEES MAY ACCRUE)"
                : "CURRENT PRICE OUTSIDE POSITION RANGE"}
            </div>
          </div>
        )}

        {hp && pool && (hp.fees?.unclaimed?.length ?? 0) > 0 && (
          <ul className="mt-4 space-y-1 font-mono text-xs text-on-surface-variant">
            {(hp.fees?.unclaimed ?? []).map((f) => (
              <li key={f.token}>
                {feeTokenLabel(pool, f.token)}: $
                {Number(f.amountUSD).toLocaleString("en-US", {
                  maximumFractionDigits: 6,
                })}
              </li>
            ))}
          </ul>
        )}
      </div>

      <button
        type="button"
        className="mt-4 rounded-lg border border-outline-variant/40 bg-surface-container-high px-4 py-2 text-xs font-bold uppercase tracking-widest text-on-surface transition-colors hover:bg-surface-container-highest"
        onClick={() => onRefresh()}
      >
        Refresh Hyperion
      </button>
    </div>
  );
}
