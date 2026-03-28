import { useState } from "react";
import { shortAddress } from "../addresses";

type GovernanceIdentityProps = {
  vaultAddress: string;
  performanceFeeBpsLabel: string | null;
  performanceFeePercentLabel: string | null;
};

export function GovernanceIdentity({
  vaultAddress,
  performanceFeeBpsLabel,
  performanceFeePercentLabel,
}: GovernanceIdentityProps) {
  const [copied, setCopied] = useState(false);

  async function copyVault() {
    try {
      await navigator.clipboard.writeText(vaultAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
      <div className="space-y-4 rounded-xl bg-surface-container-low p-6">
        <h4 className="text-xs font-bold uppercase tracking-widest text-on-surface-variant">
          Vault Governance
        </h4>
        <div className="space-y-3">
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-on-surface-variant">Management Fee</span>
            <span className="font-mono text-sm text-on-surface-variant">—</span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-on-surface-variant">Performance Fee</span>
            <span className="font-mono text-sm text-secondary">
              {performanceFeeBpsLabel ?? "—"}{" "}
              {performanceFeePercentLabel ? (
                <span className="text-on-surface-variant/70">
                  ({performanceFeePercentLabel})
                </span>
              ) : null}
            </span>
          </div>
          <div className="flex items-center justify-between py-2">
            <span className="text-sm text-on-surface-variant">Strategy Engine</span>
            <span className="rounded bg-surface-container-high px-2 py-0.5 font-mono text-xs">
              Hyperion v2
            </span>
          </div>
        </div>
      </div>
      <div className="flex flex-col justify-between rounded-xl bg-surface-container-low p-6">
        <div>
          <h4 className="mb-4 text-xs font-bold uppercase tracking-widest text-on-surface-variant">
            On-Chain Identity
          </h4>
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-[10px] uppercase text-on-surface-variant">
                Vault Address
              </p>
              <div className="flex items-center gap-2 truncate rounded bg-surface-container-highest p-2 font-mono text-xs text-primary">
                <span className="min-w-0 flex-1 truncate">{shortAddress(vaultAddress)}</span>
                <button
                  type="button"
                  className="material-symbols-outlined shrink-0 cursor-pointer text-sm hover:text-white"
                  title="Copy full address"
                  onClick={() => void copyVault()}
                >
                  content_copy
                </button>
              </div>
              {copied && (
                <p className="mt-1 text-[10px] text-primary">Copied</p>
              )}
            </div>
            <div>
              <p className="mb-1 text-[10px] uppercase text-on-surface-variant">
                Price Oracle
              </p>
              <div className="flex items-center gap-2 truncate font-mono text-xs text-on-surface">
                Vault BTC/USD cache
                <span className="material-symbols-outlined text-sm text-primary">verified</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
