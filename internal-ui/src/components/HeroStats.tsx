type HeroStatsProps = {
  loading: boolean;
  error: string | null;
  totalAssetsUsd: string | null;
  yabPriceUsd: string | null;
  btcUsdLabel: string | null;
  onRefresh: () => void;
};

export function HeroStats({
  loading,
  error,
  totalAssetsUsd,
  yabPriceUsd,
  btcUsdLabel,
  onRefresh,
}: HeroStatsProps) {
  const show = (v: string | null) =>
    loading && !v ? "…" : v ?? "—";

  return (
    <div className="mb-8 grid grid-cols-1 gap-1 overflow-hidden rounded-xl bg-background px-1 shadow-2xl md:grid-cols-3">
      <div className="bg-surface-container-low p-6 md:p-8">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-xs font-medium uppercase tracking-[0.15em] text-on-surface-variant">
            Total Assets (USD)
          </p>
          <button
            type="button"
            className="text-[10px] font-bold uppercase tracking-widest text-primary/80 hover:text-primary"
            onClick={() => onRefresh()}
          >
            Refresh
          </button>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="font-headline text-3xl font-extrabold tracking-tighter text-on-surface md:text-4xl">
            {show(totalAssetsUsd)}
          </span>
        </div>
        {error && (
          <p className="mt-2 text-xs text-error" title={error}>
            Pool data unavailable
          </p>
        )}
      </div>
      <div className="bg-surface-container-low p-6 md:p-8">
        <p className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-on-surface-variant">
          YAB Price
        </p>
        <div className="flex items-baseline gap-2">
          <span className="font-headline text-3xl font-extrabold tracking-tighter text-on-surface md:text-4xl">
            {show(yabPriceUsd)}
          </span>
        </div>
        <p className="mt-1 font-mono text-[10px] text-on-surface-variant/60">
          PER 1.00 YAB
        </p>
      </div>
      <div className="relative overflow-hidden bg-surface-container-low p-6 md:p-8">
        <div className="relative z-10">
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.15em] text-on-surface-variant">
            BTC/USD (vault cache)
          </p>
          <div className="flex items-baseline gap-2">
            <span className="font-headline text-3xl font-extrabold tracking-tighter text-secondary md:text-4xl">
              {show(btcUsdLabel)}
            </span>
          </div>
          <p className="mt-1 font-mono text-[10px] text-secondary/60">ORACLE SNAPSHOT</p>
        </div>
      </div>
    </div>
  );
}
