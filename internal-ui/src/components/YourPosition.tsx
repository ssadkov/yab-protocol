import {
  TOKEN_A_SYMBOL,
  TOKEN_B_SYMBOL,
  YAB_SYMBOL,
} from "../config";

type YourPositionProps = {
  balanceALabel: string | null;
  balanceBLabel: string | null;
  yabBalanceLabel: string | null;
  yabUsdLabel: string | null;
  sharePctLabel: string | null;
  balErr: string | null;
};

export function YourPosition({
  balanceALabel,
  balanceBLabel,
  yabBalanceLabel,
  yabUsdLabel,
  sharePctLabel,
  balErr,
}: YourPositionProps) {
  return (
    <section className="mb-10">
      <div className="relative">
        <div className="absolute -inset-2 opacity-50 blur-3xl bg-gradient-to-r from-primary/5 via-secondary/5 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-8 overflow-hidden rounded-xl border border-white/5 bg-[rgba(53,52,54,0.6)] p-6 backdrop-blur-md md:flex-nowrap md:p-8">
          <div className="min-w-0 flex-1">
            <div className="mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">account_balance</span>
              <h2 className="font-headline text-lg font-bold tracking-tight">
                Your Position
              </h2>
            </div>
            {balErr && <p className="mb-2 text-sm text-error">{balErr}</p>}
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:gap-x-12">
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Total Balance ({YAB_SYMBOL})
                </div>
                <div className="font-headline text-4xl font-black text-white">
                  {yabBalanceLabel ?? "—"}
                </div>
                <div className="mt-1 font-mono text-sm text-primary">
                  {yabUsdLabel ? `≈ ${yabUsdLabel}` : "—"}
                </div>
              </div>
              <div className="hidden h-12 w-px bg-white/10 md:block" />
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Share of Vault
                </div>
                <div className="font-headline text-3xl font-bold font-mono">
                  {sharePctLabel ?? "—"}
                </div>
              </div>
              <div>
                <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  PnL Indicator
                </div>
                <div className="flex items-center gap-1 font-headline text-3xl font-bold font-mono text-on-surface-variant">
                  <span className="material-symbols-outlined text-2xl">trending_flat</span>
                  N/A
                </div>
                <p className="mt-1 max-w-xs text-[10px] text-on-surface-variant/80">
                  Cost basis not tracked on-chain.
                </p>
              </div>
            </div>
            <div className="mt-6 grid grid-cols-1 gap-2 border-t border-white/10 pt-4 font-mono text-xs text-on-surface-variant sm:grid-cols-2">
              <p>
                {TOKEN_A_SYMBOL}:{" "}
                <span className="text-on-surface">{balanceALabel ?? "—"}</span>
              </p>
              <p>
                {TOKEN_B_SYMBOL}:{" "}
                <span className="text-on-surface">{balanceBLabel ?? "—"}</span>
              </p>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
