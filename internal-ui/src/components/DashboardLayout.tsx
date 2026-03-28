import { shortAddress } from "../addresses";

type DashboardLayoutProps = {
  networkLabel: string;
  connected: boolean;
  accountAddress: string | undefined;
  wallets: readonly { name: string }[];
  onConnect: (walletName: string) => void;
  onDisconnect: () => void;
  children: React.ReactNode;
};

export function DashboardLayout({
  networkLabel,
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
        <nav className="hidden items-center gap-8 md:flex">
          <span className="border-b-2 border-[#2DD4BF] pb-1 text-sm font-medium text-[#2DD4BF]">
            Dashboard
          </span>
          <a
            className="text-sm font-medium text-gray-400 transition-colors hover:text-white"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            Vaults
          </a>
          <a
            className="text-sm font-medium text-gray-400 transition-colors hover:text-white"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            Governance
          </a>
        </nav>
        <div className="flex items-center gap-2 md:gap-4">
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

      <aside className="fixed left-0 top-0 z-40 hidden h-full w-64 flex-col gap-6 bg-[#1C1B1C] px-4 pb-8 pt-24 md:flex">
        <div className="px-2">
          {connected && accountAddress ? (
            <div className="mb-6 flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-gradient-to-br from-primary to-primary-container p-[1px]">
                <div
                  className="h-full w-full rounded-full bg-surface-container"
                  aria-hidden
                />
              </div>
              <div>
                <div className="text-xs font-bold text-on-surface">
                  Sovereign Terminal
                </div>
                <div className="text-[10px] text-gray-500">Yield AI Bitcoin</div>
              </div>
            </div>
          ) : (
            <div className="mb-4 px-2">
              <h2 className="font-headline mb-1 text-sm uppercase tracking-widest text-[#2DD4BF]">
                YAB Vault
              </h2>
              <p className="text-[10px] uppercase tracking-widest text-slate-500">
                {networkLabel}
              </p>
            </div>
          )}
        </div>

        <nav className="flex flex-col gap-[1px] bg-[#131314]">
          <a
            className="flex items-center gap-3 border-r-2 border-[#2DD4BF] bg-[#2A2A2B] px-4 py-4 text-[#2DD4BF] duration-150 ease-in-out"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <span className="material-symbols-outlined">dashboard</span>
            Overview
          </a>
          <a
            className="flex items-center gap-3 px-4 py-4 text-gray-500 transition-colors duration-150 hover:bg-[#2A2A2B] hover:text-gray-200"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <span className="material-symbols-outlined">account_balance_wallet</span>
            Yield Strategies
          </a>
          <a
            className="flex items-center gap-3 px-4 py-4 text-gray-500 transition-colors duration-150 hover:bg-[#2A2A2B] hover:text-gray-200"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <span className="material-symbols-outlined">water_drop</span>
            Liquidity
          </a>
          <a
            className="flex items-center gap-3 px-4 py-4 text-gray-500 transition-colors duration-150 hover:bg-[#2A2A2B] hover:text-gray-200"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <span className="material-symbols-outlined">monitoring</span>
            Analytics
          </a>
          <a
            className="flex items-center gap-3 px-4 py-4 text-gray-500 transition-colors duration-150 hover:bg-[#2A2A2B] hover:text-gray-200"
            href="#"
            onClick={(e) => e.preventDefault()}
          >
            <span className="material-symbols-outlined">settings</span>
            Settings
          </a>
        </nav>

        <div className="mt-auto space-y-4 px-2">
          <button
            type="button"
            disabled
            title="Coming soon"
            className="w-full rounded-lg bg-gradient-to-br from-primary to-primary-container py-3 font-bold text-on-primary opacity-60 shadow-lg"
          >
            Stake YAB
          </button>
          <div className="space-y-1">
            <a
              className="flex items-center gap-2 text-xs text-gray-500 transition-colors hover:text-primary"
              href="#"
              onClick={(e) => e.preventDefault()}
            >
              <span className="material-symbols-outlined text-sm">description</span>
              Documentation
            </a>
            <a
              className="flex items-center gap-2 text-xs text-gray-500 transition-colors hover:text-primary"
              href="#"
              onClick={(e) => e.preventDefault()}
            >
              <span className="material-symbols-outlined text-sm">help</span>
              Support
            </a>
          </div>
        </div>
      </aside>

      <main className="min-h-screen pb-12 pt-24 md:ml-64">
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
