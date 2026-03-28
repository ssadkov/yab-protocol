import { shortAddress } from "../addresses";

type DashboardLayoutProps = {
  connected: boolean;
  accountAddress: string | undefined;
  wallets: readonly { name: string }[];
  onConnect: (walletName: string) => void;
  onDisconnect: () => void;
  children: React.ReactNode;
};

export function DashboardLayout({
  connected,
  accountAddress,
  wallets,
  onConnect,
  onDisconnect,
  children,
}: DashboardLayoutProps) {
  const short = accountAddress ? shortAddress(accountAddress) : "";

  return (
    <div className="min-h-screen bg-surface text-on-surface font-body selection:bg-primary-container selection:text-on-primary-container">
      <header className="fixed top-0 left-0 z-50 flex w-full items-center justify-between border-b border-white/5 bg-[#131314]/80 px-4 py-4 shadow-[0_8px_32px_rgba(0,0,0,0.12)] backdrop-blur-xl md:px-8">
        <div className="flex items-center gap-3 md:gap-4">
          <span className="text-2xl font-black tracking-tighter text-[#2DD4BF] dark:text-[#57F1DB]">
            YAB
          </span>
          <div className="mx-1 hidden h-6 w-px bg-outline-variant/30 sm:block" />
          <span className="hidden font-headline text-sm font-medium tracking-tight text-slate-400 sm:inline">
            Yield AI Bitcoin
          </span>
        </div>
        <div className="flex flex-1 items-center justify-end gap-2 md:gap-4">
          {!connected && (
            <div className="flex flex-wrap items-center justify-end gap-2">
              {wallets.map((w) => (
                <button
                  key={w.name}
                  type="button"
                  className="flex items-center gap-2 rounded bg-primary px-3 py-2 text-xs font-bold text-on-primary transition-transform active:scale-95 md:px-4 md:text-sm"
                  onClick={() => onConnect(w.name)}
                >
                  <span className="material-symbols-outlined text-sm">
                    account_balance_wallet
                  </span>
                  <span className="hidden sm:inline">Connect {w.name}</span>
                  <span className="sm:hidden">Connect</span>
                </button>
              ))}
            </div>
          )}
          {connected && (
            <div className="flex items-center gap-2 md:gap-3">
              <span className="rounded bg-primary/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-primary">
                Connected
              </span>
              <button
                type="button"
                className="rounded-lg border border-primary/20 bg-surface-container-high px-3 py-2 font-mono text-xs font-bold text-[#2DD4BF] transition-all active:scale-95 md:text-sm"
                title={accountAddress}
              >
                {short}
              </button>
              <button
                type="button"
                className="text-slate-400 transition-colors hover:text-[#57F1DB]"
                title="Disconnect"
                onClick={() => onDisconnect()}
              >
                <span className="material-symbols-outlined">logout</span>
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="min-h-screen pb-12 pt-24">
        <div className="mx-auto max-w-7xl px-4 md:px-8">{children}</div>
      </main>

      <div
        className="pointer-events-none fixed right-[-10%] top-[-10%] z-0 h-[50%] w-[50%] rounded-full bg-primary/5 blur-[120px]"
        aria-hidden
      />
      <div
        className="pointer-events-none fixed bottom-[-10%] left-[-10%] z-0 h-[40%] w-[40%] rounded-full bg-secondary/5 blur-[120px]"
        aria-hidden
      />
    </div>
  );
}
