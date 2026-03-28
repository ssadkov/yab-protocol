type YourPositionProps = {
  yabBalanceLabel: string | null;
  yabUsdLabel: string | null;
  sharePctLabel: string | null;
  balErr: string | null;
};

export function YourPosition({
  yabBalanceLabel,
  yabUsdLabel,
  sharePctLabel,
  balErr,
}: YourPositionProps) {
  return (
    <section className="mb-10">
      <div className="relative">
        <div className="absolute -inset-2 opacity-50 blur-3xl bg-gradient-to-r from-primary/5 via-secondary/5 to-transparent" />
        <div className="relative overflow-hidden rounded-xl border border-white/5 bg-[rgba(53,52,54,0.6)] p-6 backdrop-blur-md md:p-8">
          <div className="mb-4 flex items-center gap-2">
            <span className="material-symbols-outlined text-primary">account_balance</span>
            <h2 className="font-headline text-lg font-bold tracking-tight">
              Your Position
            </h2>
          </div>
          {balErr && <p className="mb-4 text-sm text-error">{balErr}</p>}

          <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div className="min-w-0">
              <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Total Balance
              </div>
              <div className="font-headline text-4xl font-bold leading-none tracking-tight text-primary md:text-5xl">
                {yabUsdLabel ?? "—"}
              </div>
              <div className="mt-2 font-mono text-sm text-on-surface-variant">
                {yabBalanceLabel ?? "—"}
              </div>
            </div>

            <div className="shrink-0 text-left md:text-right md:pb-0.5">
              <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                Share of Vault
              </div>
              <div className="font-mono text-lg font-medium tabular-nums text-on-surface md:text-xl">
                {sharePctLabel ?? "—"}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
