import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";
import { DashboardLayout } from "./components/DashboardLayout";
import { GovernanceIdentity } from "./components/GovernanceIdentity";
import { HeroStats } from "./components/HeroStats";
import { StrategyCard } from "./components/StrategyCard";
import {
  TransactionPanel,
  type DepositAsset,
  type TxMainTab,
} from "./components/TransactionPanel";
import { YourPosition } from "./components/YourPosition";
import {
  MIN_DEPOSIT_TOKEN_A,
  MIN_DEPOSIT_TOKEN_B_DUAL,
  MODULE_ADDRESS,
  TOKEN_A_SYMBOL,
  TOKEN_B_SYMBOL,
  VAULT_ADDRESS,
  VAULT_ADDRESS_NORMALIZED,
  YAB_DECIMALS,
  YAB_SYMBOL,
} from "./config";
import {
  BTC_USD_ORACLE_DECIMALS,
  formatBpsPercent,
  formatRaw,
  formatUsd,
  parseToRaw,
  usdFromBtcRawTimesOracle,
  usdFromStableRaw,
} from "./format";
import { getAptos } from "./aptosClient";
import { toEntryU64, transactionHashFromSubmit } from "./moveArgs";
import { useHyperionVaultPosition } from "./useHyperionVaultPosition";
import { useVaultData } from "./useVaultData";
import { useWalletBalances } from "./useWalletBalances";
import { btcRawToUsdcRaw } from "./vaultMath";

function networkDisplayLabel(): string {
  const n = (import.meta.env.VITE_NETWORK ?? "mainnet").toLowerCase();
  if (n === "mainnet") return "Aptos Mainnet";
  if (n === "testnet") return "Aptos Testnet";
  if (n === "devnet") return "Aptos Devnet";
  return `Aptos ${n}`;
}

export default function App() {
  const {
    account,
    connected,
    connect,
    disconnect,
    signAndSubmitTransaction,
    wallets,
  } = useWallet();
  const { data, error, loading, refresh, tokenADecimals, tokenBDecimals } =
    useVaultData(60_000);
  const {
    positions: hyperionPositions,
    loading: hyperionLoading,
    error: hyperionError,
    refresh: refreshHyperion,
  } = useHyperionVaultPosition(60_000);

  const owner =
    connected && account ? String(account.address) : undefined;

  const {
    balanceA,
    balanceB,
    balanceYab,
    error: balErr,
    refresh: refreshBalances,
  } = useWalletBalances(
    owner,
    data?.tokenAMetadata,
    data?.tokenBMetadata,
    undefined,
    60_000,
  );

  const [depositA, setDepositA] = useState("");
  const [depositAEdited, setDepositAEdited] = useState(false);
  const [depositB, setDepositB] = useState("");
  const [depositBEdited, setDepositBEdited] = useState(false);
  const [depositDualA, setDepositDualA] = useState("");
  const [depositDualB, setDepositDualB] = useState("");
  const [depositDualEdited, setDepositDualEdited] = useState(false);
  const [withdrawYab, setWithdrawYab] = useState("");
  const [busy, setBusy] = useState(false);
  const [txMsg, setTxMsg] = useState<string | null>(null);
  const [txTab, setTxTab] = useState<TxMainTab>("deposit");
  const [depositAsset, setDepositAsset] = useState<DepositAsset>("A");

  const U64_MAX = 18446744073709551615n;

  const withdrawEstimateBtcRaw = useMemo(() => {
    if (!data) return null;
    try {
      const shares = parseToRaw(withdrawYab, YAB_DECIMALS);
      if (shares <= 0n) return null;
      return (shares * data.yabPriceRaw) / 100_000_000n;
    } catch {
      return null;
    }
  }, [data, withdrawYab]);

  const withdrawEstimateUsdcRaw = useMemo(() => {
    if (!data || withdrawEstimateBtcRaw == null) return null;
    return btcRawToUsdcRaw(withdrawEstimateBtcRaw, data.btcUsdPriceRaw);
  }, [data, withdrawEstimateBtcRaw]);

  const navUsd = useMemo(() => {
    if (!data) return null;
    const p = data.btcUsdPriceRaw;
    const wbtc = usdFromBtcRawTimesOracle(data.tokenARaw, p);
    const usdcFace = usdFromStableRaw(data.tokenBRaw, tokenBDecimals);
    const totalSpotUsd = wbtc + usdcFace;
    const supply = data.yabSupplyRaw;
    const yabUsdPerFull =
      supply > 0n
        ? (totalSpotUsd * 10 ** YAB_DECIMALS) / Number(supply)
        : 0;
    return {
      wbtc,
      usdcFace,
      totalSpotUsd,
      yabUsdPerFull,
    };
  }, [data, tokenBDecimals]);

  const walletYabUsd = useMemo(() => {
    if (!data || !navUsd || balanceYab == null || balanceYab === 0n) return null;
    const supply = data.yabSupplyRaw;
    if (supply === 0n) return null;
    return (Number(balanceYab) / Number(supply)) * navUsd.totalSpotUsd;
  }, [data, balanceYab, navUsd]);

  const walletYabSharePct = useMemo(() => {
    if (!data || balanceYab == null || balanceYab === 0n) return null;
    const supply = data.yabSupplyRaw;
    if (supply === 0n) return null;
    return (Number(balanceYab) / Number(supply)) * 100;
  }, [data, balanceYab]);

  const exchangeRateHint = useMemo(() => {
    if (!data || !navUsd) return null;
    const usdPerBtc = Number(data.lastRecordedPrice) / 10 ** BTC_USD_ORACLE_DECIMALS;
    if (!Number.isFinite(usdPerBtc) || usdPerBtc <= 0) return null;
    const wbtcPerYab = navUsd.yabUsdPerFull / usdPerBtc;
    return `1 ${YAB_SYMBOL} ≈ ${wbtcPerYab.toLocaleString("en-US", {
      maximumFractionDigits: 8,
    })} ${TOKEN_A_SYMBOL} (spot)`;
  }, [data, navUsd]);

  useEffect(() => {
    if (!connected) {
      setDepositAEdited(false);
      setDepositBEdited(false);
      setDepositDualEdited(false);
      setDepositA("");
      setDepositB("");
      setDepositDualA("");
      setDepositDualB("");
      setWithdrawYab("");
    }
  }, [connected]);

  useEffect(() => {
    if (depositAEdited || balanceA == null) return;
    setDepositA(formatRaw(balanceA, tokenADecimals));
  }, [balanceA, tokenADecimals, depositAEdited]);

  useEffect(() => {
    if (depositBEdited || balanceB == null) return;
    setDepositB(formatRaw(balanceB, tokenBDecimals));
  }, [balanceB, tokenBDecimals, depositBEdited]);

  useEffect(() => {
    if (depositDualEdited || balanceA == null || balanceB == null) return;
    setDepositDualA(formatRaw(balanceA, tokenADecimals));
    setDepositDualB(formatRaw(balanceB, tokenBDecimals));
  }, [balanceA, balanceB, tokenADecimals, tokenBDecimals, depositDualEdited]);

  async function submitWithdraw() {
    if (!connected || !account) {
      setTxMsg("Connect wallet first");
      return;
    }
    if (balanceYab == null) {
      setTxMsg("YAB balance not loaded");
      return;
    }
    setBusy(true);
    setTxMsg(null);
    try {
      const aptos = getAptos();
      let raw: bigint;
      try {
        raw = parseToRaw(withdrawYab, YAB_DECIMALS);
      } catch (e) {
        setTxMsg(e instanceof Error ? e.message : String(e));
        return;
      }
      if (raw <= 0n) {
        setTxMsg("Amount must be > 0");
        return;
      }
      if (raw > balanceYab) {
        setTxMsg("Amount exceeds YAB balance");
        return;
      }
      if (raw > U64_MAX) {
        setTxMsg("Amount too large for chain (u64)");
        return;
      }
      const pending = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::vault::withdraw`,
          functionArguments: [VAULT_ADDRESS_NORMALIZED, toEntryU64(raw)],
        },
      });
      const txHash = transactionHashFromSubmit(pending);
      await aptos.waitForTransaction({ transactionHash: txHash });
      setTxMsg(`withdraw ok: ${txHash}`);
      setWithdrawYab("");
      await refresh();
      await refreshBalances();
      await refreshHyperion();
    } catch (e) {
      setTxMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitWithdrawUsdc() {
    if (!connected || !account) {
      setTxMsg("Connect wallet first");
      return;
    }
    if (balanceYab == null) {
      setTxMsg("YAB balance not loaded");
      return;
    }
    setBusy(true);
    setTxMsg(null);
    try {
      const aptos = getAptos();
      let raw: bigint;
      try {
        raw = parseToRaw(withdrawYab, YAB_DECIMALS);
      } catch (e) {
        setTxMsg(e instanceof Error ? e.message : String(e));
        return;
      }
      if (raw <= 0n) {
        setTxMsg("Amount must be > 0");
        return;
      }
      if (raw > balanceYab) {
        setTxMsg("Amount exceeds YAB balance");
        return;
      }
      if (raw > U64_MAX) {
        setTxMsg("Amount too large for chain (u64)");
        return;
      }
      const pending = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::vault::withdraw_usdc`,
          functionArguments: [VAULT_ADDRESS_NORMALIZED, toEntryU64(raw)],
        },
      });
      const txHash = transactionHashFromSubmit(pending);
      await aptos.waitForTransaction({ transactionHash: txHash });
      setTxMsg(`withdraw_usdc ok: ${txHash}`);
      setWithdrawYab("");
      await refresh();
      await refreshBalances();
      await refreshHyperion();
    } catch (e) {
      setTxMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitDepositUsdc() {
    if (!connected || !account) {
      setTxMsg("Connect wallet first");
      return;
    }
    setBusy(true);
    setTxMsg(null);
    try {
      const aptos = getAptos();
      const raw = parseToRaw(depositB, tokenBDecimals);
      if (raw <= 0n) {
        setTxMsg("Amount must be > 0");
        return;
      }
      if (raw < MIN_DEPOSIT_TOKEN_B_DUAL) {
        setTxMsg(
          `token_b_in must be ≥ ${MIN_DEPOSIT_TOKEN_B_DUAL.toString()} raw (min deposit)`,
        );
        return;
      }
      const pending = await signAndSubmitTransaction({
        data: {
          function: `${MODULE_ADDRESS}::vault::deposit_usdc`,
          functionArguments: [VAULT_ADDRESS_NORMALIZED, toEntryU64(raw)],
        },
      });
      const txHash = transactionHashFromSubmit(pending);
      await aptos.waitForTransaction({ transactionHash: txHash });
      setTxMsg(`deposit_usdc ok: ${txHash}`);
      await refresh();
      await refreshBalances();
      await refreshHyperion();
    } catch (e) {
      setTxMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function submitDeposit(singleA: boolean) {
    if (!connected || !account) {
      setTxMsg("Connect wallet first");
      return;
    }
    setBusy(true);
    setTxMsg(null);
    try {
      const aptos = getAptos();
      if (singleA) {
        const raw = parseToRaw(depositA, tokenADecimals);
        if (raw <= 0n) {
          setTxMsg("Amount must be > 0");
          return;
        }
        if (raw < MIN_DEPOSIT_TOKEN_A) {
          setTxMsg(
            `token_a_in must be ≥ ${MIN_DEPOSIT_TOKEN_A.toString()} raw (min deposit)`,
          );
          return;
        }
        const pending = await signAndSubmitTransaction({
          data: {
            function: `${MODULE_ADDRESS}::vault::deposit`,
            functionArguments: [VAULT_ADDRESS_NORMALIZED, toEntryU64(raw)],
          },
        });
        const txHash = transactionHashFromSubmit(pending);
        await aptos.waitForTransaction({ transactionHash: txHash });
        setTxMsg(`deposit ok: ${txHash}`);
      } else {
        const rawA = parseToRaw(depositDualA, tokenADecimals);
        const rawB = parseToRaw(depositDualB, tokenBDecimals);
        if (rawA <= 0n || rawB <= 0n) {
          setTxMsg("Both amounts must be > 0");
          return;
        }
        if (rawA < MIN_DEPOSIT_TOKEN_A || rawB < MIN_DEPOSIT_TOKEN_B_DUAL) {
          setTxMsg(
            `dual: token_a ≥ ${MIN_DEPOSIT_TOKEN_A.toString()} raw, token_b ≥ ${MIN_DEPOSIT_TOKEN_B_DUAL.toString()} raw`,
          );
          return;
        }
        const pending = await signAndSubmitTransaction({
          data: {
            function: `${MODULE_ADDRESS}::vault::deposit_dual`,
            functionArguments: [
              VAULT_ADDRESS_NORMALIZED,
              toEntryU64(rawA),
              toEntryU64(rawB),
            ],
          },
        });
        const txHash = transactionHashFromSubmit(pending);
        await aptos.waitForTransaction({ transactionHash: txHash });
        setTxMsg(`deposit_dual ok: ${txHash}`);
      }
      await refresh();
      await refreshBalances();
      await refreshHyperion();
    } catch (e) {
      setTxMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const totalAssetsStr =
    navUsd != null ? formatUsd(navUsd.totalSpotUsd) : null;
  const yabPriceStr =
    navUsd != null ? formatUsd(navUsd.yabUsdPerFull) : null;
  const btcUsdStr =
    data != null
      ? formatRaw(data.lastRecordedPrice, BTC_USD_ORACLE_DECIMALS, 8)
      : null;

  const perfBpsStr = data ? `${data.performanceFeeBps.toString()} bps` : null;
  const perfPctStr = data
    ? formatBpsPercent(data.performanceFeeBps)
    : null;

  const yabBalLabel =
    balanceYab != null ? `${formatRaw(balanceYab, YAB_DECIMALS)} ${YAB_SYMBOL}` : null;
  const yabUsdLabel = walletYabUsd != null ? formatUsd(walletYabUsd) : null;
  const shareStr =
    walletYabSharePct != null
      ? `${
          walletYabSharePct < 0.01
            ? walletYabSharePct.toFixed(4)
            : walletYabSharePct < 1
              ? walletYabSharePct.toFixed(3)
              : walletYabSharePct.toFixed(2)
        }%`
      : null;
  const balALabel =
    balanceA != null
      ? `${formatRaw(balanceA, tokenADecimals)} ${TOKEN_A_SYMBOL}`
      : null;
  const balBLabel =
    balanceB != null
      ? `${formatRaw(balanceB, tokenBDecimals)} ${TOKEN_B_SYMBOL}`
      : null;

  const withdrawEstBtc =
    withdrawEstimateBtcRaw != null
      ? `≈ ${formatRaw(withdrawEstimateBtcRaw, tokenADecimals)} ${TOKEN_A_SYMBOL}`
      : null;
  const withdrawEstUsdc =
    withdrawEstimateUsdcRaw != null && data
      ? `≈ ${formatRaw(withdrawEstimateUsdcRaw, tokenBDecimals)} ${TOKEN_B_SYMBOL}`
      : null;

  return (
    <DashboardLayout
      networkLabel={networkDisplayLabel()}
      connected={connected}
      accountAddress={account ? String(account.address) : undefined}
      wallets={wallets}
      onConnect={(name) => void connect(name)}
      onDisconnect={() => void disconnect()}
    >
      <div className="mb-10 flex flex-col justify-between gap-6 md:flex-row md:items-end">
        <div>
          <h1 className="font-headline mb-2 text-4xl font-extrabold tracking-tighter text-on-surface md:text-5xl">
            Vault <span className="text-primary-container">Dashboard</span>
          </h1>
          <p className="max-w-lg text-sm leading-relaxed text-on-surface-variant">
            Internal dashboard: pool NAV, Hyperion CLMM, and vault transactions.
          </p>
        </div>
        <div className="text-left md:text-right">
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-gray-500">
            Total Value Locked (spot)
          </div>
          <div className="font-headline text-2xl font-bold font-mono">
            {totalAssetsStr ?? "—"}
          </div>
        </div>
      </div>

      {connected && (
        <YourPosition
          balanceALabel={balALabel}
          balanceBLabel={balBLabel}
          yabBalanceLabel={yabBalLabel}
          yabUsdLabel={yabUsdLabel}
          sharePctLabel={shareStr}
          balErr={balErr}
        />
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="space-y-8 lg:col-span-8">
          <HeroStats
            loading={loading}
            error={error}
            totalAssetsUsd={totalAssetsStr}
            yabPriceUsd={yabPriceStr}
            btcUsdLabel={btcUsdStr}
            onRefresh={() => void refresh()}
          />

          <StrategyCard
            loading={hyperionLoading}
            error={hyperionError}
            positions={hyperionPositions}
            onRefresh={() => void refreshHyperion()}
          />

          <GovernanceIdentity
            vaultAddress={VAULT_ADDRESS}
            performanceFeeBpsLabel={perfBpsStr}
            performanceFeePercentLabel={perfPctStr}
          />

          <section className="rounded-xl border border-outline-variant/20 bg-surface-container-low/50 p-4 text-xs text-on-surface-variant">
            <p className="mb-2 font-bold uppercase tracking-widest text-on-surface-variant/80">
              Reserves (on-chain)
            </p>
            {data && (
              <p>
                Position: {formatRaw(data.positionBtcRaw, tokenADecimals)}{" "}
                {TOKEN_A_SYMBOL} + {formatRaw(data.positionUsdcRaw, tokenBDecimals)}{" "}
                {TOKEN_B_SYMBOL} · Free: {formatRaw(data.freeBtcRaw, tokenADecimals)} +{" "}
                {formatRaw(data.freeUsdcRaw, tokenBDecimals)} {TOKEN_B_SYMBOL}. Supply{" "}
                {data.yabSupplyRaw.toString()} raw.
              </p>
            )}
            {!data && !loading && <p>—</p>}
            {loading && !data && <p>Loading…</p>}
            {error && <p className="text-error">{error}</p>}
          </section>
        </div>

        <aside className="lg:col-span-4">
          <div className="lg:sticky lg:top-24">
            <TransactionPanel
              busy={busy}
              connected={connected}
              mainTab={txTab}
              onMainTab={setTxTab}
              depositAsset={depositAsset}
              onDepositAsset={setDepositAsset}
              tokenADecimals={tokenADecimals}
              tokenBDecimals={tokenBDecimals}
              depositA={depositA}
              setDepositA={setDepositA}
              setDepositAEdited={setDepositAEdited}
              depositB={depositB}
              setDepositB={setDepositB}
              setDepositBEdited={setDepositBEdited}
              depositDualA={depositDualA}
              setDepositDualA={setDepositDualA}
              depositDualB={depositDualB}
              setDepositDualB={setDepositDualB}
              setDepositDualEdited={setDepositDualEdited}
              withdrawYab={withdrawYab}
              setWithdrawYab={setWithdrawYab}
              balanceA={balanceA}
              balanceB={balanceB}
              balanceYab={balanceYab}
              onMaxDepositA={() => {
                if (balanceA == null) return;
                setDepositAEdited(false);
                setDepositA(formatRaw(balanceA, tokenADecimals));
              }}
              onMaxDepositB={() => {
                if (balanceB == null) return;
                setDepositBEdited(false);
                setDepositB(formatRaw(balanceB, tokenBDecimals));
              }}
              onMaxDualA={() => {
                if (balanceA == null) return;
                setDepositDualEdited(true);
                setDepositDualA(formatRaw(balanceA, tokenADecimals));
              }}
              onMaxDualB={() => {
                if (balanceB == null) return;
                setDepositDualEdited(true);
                setDepositDualB(formatRaw(balanceB, tokenBDecimals));
              }}
              onMaxWithdrawYab={() => {
                if (balanceYab == null) return;
                setWithdrawYab(formatRaw(balanceYab, YAB_DECIMALS));
              }}
              onSubmitDepositWbtc={() => void submitDeposit(true)}
              onSubmitDepositUsdc={() => void submitDepositUsdc()}
              onSubmitDual={() => void submitDeposit(false)}
              onSubmitWithdrawBtc={() => void submitWithdraw()}
              onSubmitWithdrawUsdc={() => void submitWithdrawUsdc()}
              exchangeRateHint={exchangeRateHint}
              slippageLabel="—"
              expectedOutputDeposit={null}
              expectedUsdDeposit={null}
              withdrawEstimateBtc={withdrawEstBtc}
              withdrawEstimateUsdc={withdrawEstUsdc}
            />

            {txMsg && (
              <p className="mt-4 break-all rounded-lg border border-outline-variant/30 bg-surface-container-low p-3 font-mono text-xs text-primary">
                {txMsg}
              </p>
            )}
          </div>
        </aside>
      </div>
    </DashboardLayout>
  );
}
