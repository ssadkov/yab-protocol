type YourPositionProps = {
  yabBalanceLabel: string | null;
  yabUsdLabel: string | null;
  sharePctLabel: string | null;
  balErr: string | null;
  /** Vault-wide unclaimed fees + farm (USD), from Hyperion/Yield AI API — not on-chain NAV. */
  unclaimedVaultUsdLabel: string;
  /** User’s pro-rata share of that unclaimed amount (same YAB / supply ratio as spot). */
  unclaimedUserEstUsdLabel: string;
};

export function YourPosition({
  yabBalanceLabel,
  yabUsdLabel,
  sharePctLabel,
  balErr,
  unclaimedVaultUsdLabel,
  unclaimedUserEstUsdLabel,
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

          <div className="mt-6 border-t border-white/10 pt-6">
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
              Unclaimed (fees + farm) — off-chain estimate
            </div>
            <div className="flex flex-col gap-3 text-sm md:flex-row md:items-baseline md:justify-between">
              <div>
                <span className="text-on-surface-variant">Vault total: </span>
                <span className="font-mono font-semibold text-secondary">
                  {unclaimedVaultUsdLabel}
                </span>
              </div>
              <div className="md:text-right">
                <span className="text-on-surface-variant">Your est. share: </span>
                <span className="font-mono font-semibold text-secondary">
                  {unclaimedUserEstUsdLabel}
                </span>
              </div>
            </div>
            <p className="mt-3 text-[11px] leading-relaxed text-on-surface-variant/80">
              Not included in Total Balance above until an operator runs on-chain harvest (
              <code className="rounded bg-black/20 px-1 font-mono text-[10px]">claim_rewards</code>
              ). After harvest, value moves into vault reserves and your YAB share reflects it via NAV.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
