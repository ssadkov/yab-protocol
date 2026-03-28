import {
  TOKEN_A_SYMBOL,
  TOKEN_B_SYMBOL,
  YAB_DECIMALS,
  YAB_SYMBOL,
} from "../config";
import { formatRaw } from "../format";

export type TxMainTab = "deposit" | "dual" | "withdraw";
export type DepositAsset = "A" | "B";

type TransactionPanelProps = {
  busy: boolean;
  connected: boolean;
  mainTab: TxMainTab;
  onMainTab: (t: TxMainTab) => void;
  depositAsset: DepositAsset;
  onDepositAsset: (a: DepositAsset) => void;
  tokenADecimals: number;
  tokenBDecimals: number;
  depositA: string;
  setDepositA: (v: string) => void;
  setDepositAEdited: (v: boolean) => void;
  depositB: string;
  setDepositB: (v: string) => void;
  setDepositBEdited: (v: boolean) => void;
  depositDualA: string;
  setDepositDualA: (v: string) => void;
  depositDualB: string;
  setDepositDualB: (v: string) => void;
  setDepositDualEdited: (v: boolean) => void;
  withdrawYab: string;
  setWithdrawYab: (v: string) => void;
  balanceA: bigint | null;
  balanceB: bigint | null;
  balanceYab: bigint | null;
  onMaxDepositA: () => void;
  onMaxDepositB: () => void;
  onMaxDualA: () => void;
  onMaxDualB: () => void;
  onMaxWithdrawYab: () => void;
  onSubmitDepositWbtc: () => void;
  onSubmitDepositUsdc: () => void;
  onSubmitDual: () => void;
  onSubmitWithdrawBtc: () => void;
  onSubmitWithdrawUsdc: () => void;
  exchangeRateHint: string | null;
  slippageLabel: string;
  expectedOutputDeposit: string | null;
  expectedUsdDeposit: string | null;
  expectedOutputDual: string | null;
  expectedUsdDual: string | null;
  /** Human-readable minimum deposit amounts (token units, not raw). */
  minDepositHintDepositTab: string;
  minDepositHintDualTab: string;
  withdrawEstimateBtc: string | null;
  withdrawEstimateUsdc: string | null;
};

export function TransactionPanel(props: TransactionPanelProps) {
  const {
    busy,
    connected,
    mainTab,
    onMainTab,
    depositAsset,
    onDepositAsset,
    tokenADecimals,
    tokenBDecimals,
    depositA,
    setDepositA,
    setDepositAEdited,
    depositB,
    setDepositB,
    setDepositBEdited,
    depositDualA,
    setDepositDualA,
    depositDualB,
    setDepositDualB,
    setDepositDualEdited,
    withdrawYab,
    setWithdrawYab,
    balanceA,
    balanceB,
    balanceYab,
    onMaxDepositA,
    onMaxDepositB,
    onMaxDualA,
    onMaxDualB,
    onMaxWithdrawYab,
    onSubmitDepositWbtc,
    onSubmitDepositUsdc,
    onSubmitDual,
    onSubmitWithdrawBtc,
    onSubmitWithdrawUsdc,
    exchangeRateHint,
    slippageLabel,
    expectedOutputDeposit,
    expectedUsdDeposit,
    expectedOutputDual,
    expectedUsdDual,
    minDepositHintDepositTab,
    minDepositHintDualTab,
    withdrawEstimateBtc,
    withdrawEstimateUsdc,
  } = props;

  const showBalanceDetail = () => {
    if (mainTab === "deposit" && depositAsset === "A" && balanceA != null) {
      return `Balance: ${formatRaw(balanceA, tokenADecimals)} ${TOKEN_A_SYMBOL}`;
    }
    if (mainTab === "deposit" && depositAsset === "B" && balanceB != null) {
      return `Balance: ${formatRaw(balanceB, tokenBDecimals)} ${TOKEN_B_SYMBOL}`;
    }
    if (mainTab === "dual") {
      const a =
        balanceA != null
          ? `${formatRaw(balanceA, tokenADecimals)} ${TOKEN_A_SYMBOL}`
          : "—";
      const b =
        balanceB != null
          ? `${formatRaw(balanceB, tokenBDecimals)} ${TOKEN_B_SYMBOL}`
          : "—";
      return `${a} · ${b}`;
    }
    if (mainTab === "withdraw" && balanceYab != null) {
      return `Balance: ${formatRaw(balanceYab, YAB_DECIMALS)} ${YAB_SYMBOL}`;
    }
    return "Balance: —";
  };

  return (
    <div className="glass-card overflow-hidden rounded-2xl border border-outline-variant/10">
      <div className="flex bg-surface-container-lowest/50 p-1">
        {(["deposit", "dual", "withdraw"] as const).map((t) => (
          <button
            key={t}
            type="button"
            className={`flex-1 py-3 text-[10px] font-bold uppercase tracking-widest transition-colors ${
              mainTab === t
                ? "border-b-2 border-primary text-primary"
                : "text-on-surface-variant/60 hover:text-on-surface"
            }`}
            onClick={() => onMainTab(t)}
          >
            {t === "deposit" ? "Deposit" : t === "dual" ? "Dual" : "Withdraw"}
          </button>
        ))}
      </div>

      <div className="space-y-6 p-6 md:p-8">
        {mainTab === "deposit" && (
          <>
            <div className="flex rounded-lg bg-surface-container-highest/50 p-0.5">
              <button
                type="button"
                className={`flex-1 rounded-md py-2 text-xs font-bold uppercase tracking-wider ${
                  depositAsset === "A"
                    ? "bg-surface-container-high text-primary"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
                onClick={() => onDepositAsset("A")}
              >
                {TOKEN_A_SYMBOL}
              </button>
              <button
                type="button"
                className={`flex-1 rounded-md py-2 text-xs font-bold uppercase tracking-wider ${
                  depositAsset === "B"
                    ? "bg-surface-container-high text-primary"
                    : "text-on-surface-variant hover:text-on-surface"
                }`}
                onClick={() => onDepositAsset("B")}
              >
                {TOKEN_B_SYMBOL}
              </button>
            </div>

            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  Input Amount
                </label>
                <span className="font-mono text-[10px] text-on-surface-variant/60">
                  {showBalanceDetail()}
                </span>
              </div>
              {depositAsset === "A" ? (
                <div className="group relative">
                  <input
                    value={depositA}
                    onChange={(e) => {
                      setDepositAEdited(true);
                      setDepositA(e.target.value);
                    }}
                    disabled={busy}
                    className="w-full rounded-lg border-0 bg-surface-container-lowest py-5 pl-4 pr-36 font-mono text-2xl text-on-surface placeholder:text-surface-container-highest focus:ring-1 focus:ring-primary/40"
                    placeholder="0.00"
                  />
                  <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-3">
                    <button
                      type="button"
                      className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary hover:bg-primary/20"
                      disabled={busy || balanceA == null || balanceA === 0n}
                      onClick={onMaxDepositA}
                    >
                      Max
                    </button>
                    <div className="flex items-center gap-2 rounded border border-outline-variant/20 bg-surface-container-high px-2 py-1">
                      <span className="material-symbols-outlined text-sm text-secondary">
                        currency_bitcoin
                      </span>
                      <span className="text-xs font-bold">{TOKEN_A_SYMBOL}</span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="group relative">
                  <input
                    value={depositB}
                    onChange={(e) => {
                      setDepositBEdited(true);
                      setDepositB(e.target.value);
                    }}
                    disabled={busy}
                    className="w-full rounded-lg border-0 bg-surface-container-lowest py-5 pl-4 pr-36 font-mono text-2xl text-on-surface placeholder:text-surface-container-highest focus:ring-1 focus:ring-primary/40"
                    placeholder="0.00"
                  />
                  <div className="absolute right-4 top-1/2 flex -translate-y-1/2 items-center gap-3">
                    <button
                      type="button"
                      className="rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary hover:bg-primary/20"
                      disabled={busy || balanceB == null || balanceB === 0n}
                      onClick={onMaxDepositB}
                    >
                      Max
                    </button>
                    <div className="flex items-center gap-2 rounded border border-outline-variant/20 bg-surface-container-high px-2 py-1">
                      <span className="text-xs font-bold">{TOKEN_B_SYMBOL}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="space-y-3 rounded-lg bg-surface-container-highest/30 p-4">
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Exchange rate</span>
                <span className="font-mono text-on-surface">
                  {exchangeRateHint ?? "—"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Slippage tolerance</span>
                <span className="max-w-[58%] text-right font-mono text-[11px] text-primary">
                  {slippageLabel}
                </span>
              </div>
              <div className="flex justify-between border-t border-outline-variant/10 pt-2">
                <span className="text-xs font-bold uppercase tracking-widest text-on-surface">
                  Expected output
                </span>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-primary">
                    {expectedOutputDeposit ?? "—"}
                  </p>
                  <p className="text-[10px] text-on-surface-variant/60">
                    {expectedUsdDeposit ?? ""}
                  </p>
                  <p className="mt-1 text-[9px] text-on-surface-variant/50">
                    NAV-based estimate from current yab_price; actual mint may differ after
                    swaps and LP rounding.
                  </p>
                </div>
              </div>
            </div>

            <p className="text-[10px] leading-relaxed text-on-surface-variant">
              {minDepositHintDepositTab}
            </p>

            <button
              type="button"
              disabled={busy || !connected}
              className="w-full rounded-xl bg-gradient-to-br from-primary to-primary-container py-5 font-black uppercase tracking-widest text-on-primary shadow-[0_8px_24px_rgba(87,241,219,0.2)] transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_32px_rgba(87,241,219,0.3)] active:translate-y-0 active:scale-[0.98] disabled:opacity-40"
              onClick={() =>
                depositAsset === "A" ? onSubmitDepositWbtc() : onSubmitDepositUsdc()
              }
            >
              {busy ? "…" : depositAsset === "A" ? "Confirm Deposit" : "Deposit USDC"}
            </button>
          </>
        )}

        {mainTab === "dual" && (
          <>
            <div className="space-y-4">
              <p className="text-[10px] leading-relaxed text-on-surface-variant">
                {minDepositHintDualTab}
              </p>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                {TOKEN_A_SYMBOL}
              </label>
              <div className="relative">
                <input
                  value={depositDualA}
                  onChange={(e) => {
                    setDepositDualEdited(true);
                    setDepositDualA(e.target.value);
                  }}
                  disabled={busy}
                  className="w-full rounded-lg border-0 bg-surface-container-lowest py-3 pl-3 pr-24 font-mono text-lg text-on-surface focus:ring-1 focus:ring-primary/40"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary"
                  disabled={busy || balanceA == null || balanceA === 0n}
                  onClick={onMaxDualA}
                >
                  Max
                </button>
              </div>
              <label className="block text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                {TOKEN_B_SYMBOL}
              </label>
              <div className="relative">
                <input
                  value={depositDualB}
                  onChange={(e) => {
                    setDepositDualEdited(true);
                    setDepositDualB(e.target.value);
                  }}
                  disabled={busy}
                  className="w-full rounded-lg border-0 bg-surface-container-lowest py-3 pl-3 pr-24 font-mono text-lg text-on-surface focus:ring-1 focus:ring-primary/40"
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary"
                  disabled={busy || balanceB == null || balanceB === 0n}
                  onClick={onMaxDualB}
                >
                  Max
                </button>
              </div>
            </div>
            <div className="space-y-3 rounded-lg bg-surface-container-highest/30 p-4">
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Exchange rate</span>
                <span className="font-mono text-on-surface">
                  {exchangeRateHint ?? "—"}
                </span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-on-surface-variant">Slippage tolerance</span>
                <span className="max-w-[58%] text-right font-mono text-[11px] text-primary">
                  {slippageLabel}
                </span>
              </div>
              <div className="flex justify-between border-t border-outline-variant/10 pt-2">
                <span className="text-xs font-bold uppercase tracking-widest text-on-surface">
                  Expected output
                </span>
                <div className="text-right">
                  <p className="font-mono text-sm font-bold text-primary">
                    {expectedOutputDual ?? "—"}
                  </p>
                  <p className="text-[10px] text-on-surface-variant/60">
                    {expectedUsdDual ?? ""}
                  </p>
                  <p className="mt-1 text-[9px] text-on-surface-variant/50">
                    NAV-based estimate from current yab_price; actual mint may differ after
                    swaps and LP rounding.
                  </p>
                </div>
              </div>
            </div>
            <button
              type="button"
              disabled={busy || !connected}
              className="w-full rounded-lg bg-gradient-to-r from-primary to-primary-container py-4 font-black uppercase tracking-widest text-sm text-on-primary shadow-xl transition-all active:scale-95"
              onClick={onSubmitDual}
            >
              {busy ? "…" : "Execute Dual Deposit"}
            </button>
          </>
        )}

        {mainTab === "withdraw" && (
          <>
            <p className="text-[10px] leading-relaxed text-on-surface-variant">
              Burns {YAB_SYMBOL} from your primary FA store.{" "}
              <strong>{TOKEN_A_SYMBOL}</strong> payout uses on-chain NAV;{" "}
              <strong>{TOKEN_B_SYMBOL}</strong> uses{" "}
              <code className="font-mono text-on-surface-variant/90">btc_raw_to_usdc_raw</code>{" "}
              at oracle.
            </p>
            <div className="space-y-4">
              <div className="flex items-end justify-between">
                <label className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant">
                  {YAB_SYMBOL} to burn
                </label>
                <span className="font-mono text-[10px] text-on-surface-variant/60">
                  {showBalanceDetail()}
                </span>
              </div>
              <div className="relative">
                <input
                  value={withdrawYab}
                  onChange={(e) => setWithdrawYab(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-lg border-0 bg-surface-container-lowest py-5 px-4 font-mono text-2xl text-on-surface focus:ring-1 focus:ring-primary/40"
                  placeholder="0.00"
                />
                <button
                  type="button"
                  className="absolute right-4 top-1/2 -translate-y-1/2 rounded bg-primary/10 px-2 py-1 text-[10px] font-bold uppercase text-primary"
                  disabled={busy || balanceYab == null || balanceYab === 0n}
                  onClick={onMaxWithdrawYab}
                >
                  Max
                </button>
              </div>
            </div>
            <div className="space-y-2 rounded-lg bg-surface-container-highest/30 p-4 text-xs">
              <div className="flex justify-between gap-4">
                <span className="text-on-surface-variant">Est. {TOKEN_A_SYMBOL}</span>
                <span className="font-mono text-on-surface">
                  {withdrawEstimateBtc ?? "—"}
                </span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-on-surface-variant">Est. {TOKEN_B_SYMBOL}</span>
                <span className="font-mono text-on-surface">
                  {withdrawEstimateUsdc ?? "—"}
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={
                  busy || !connected || balanceYab == null || balanceYab === 0n
                }
                className="w-full rounded-lg bg-gradient-to-br from-primary to-primary-container py-4 font-black uppercase tracking-widest text-on-primary shadow-xl transition-all active:scale-95 disabled:opacity-40"
                onClick={onSubmitWithdrawBtc}
              >
                {busy ? "…" : `Withdraw to ${TOKEN_A_SYMBOL}`}
              </button>
              <button
                type="button"
                disabled={
                  busy || !connected || balanceYab == null || balanceYab === 0n
                }
                className="w-full rounded-lg border border-outline-variant/40 bg-surface-container-high py-4 font-bold uppercase tracking-widest text-on-surface transition-colors hover:bg-surface-container-highest disabled:opacity-40"
                onClick={onSubmitWithdrawUsdc}
              >
                {busy ? "…" : `Withdraw to ${TOKEN_B_SYMBOL}`}
              </button>
            </div>
          </>
        )}

        <div className="flex items-center gap-3 text-center">
          <div className="h-px flex-1 bg-outline-variant/20" />
          <span className="text-[10px] uppercase tracking-widest text-on-surface-variant/40">
            Vault safety
          </span>
          <div className="h-px flex-1 bg-outline-variant/20" />
        </div>
        <p className="text-center text-[10px] leading-relaxed text-on-surface-variant">
          YAB automated strategy rebalances on cadence per vault. Assets are secured by Aptos Move
          smart contracts.
        </p>
        {!connected && (
          <p className="text-center text-xs font-bold text-secondary">
            Connect a wallet to transact.
          </p>
        )}
      </div>
    </div>
  );
}
