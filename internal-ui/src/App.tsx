import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useEffect, useMemo, useState } from "react";
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
import { shortAddress } from "./addresses";
import { getAptos } from "./aptosClient";
import { toEntryU64, transactionHashFromSubmit } from "./moveArgs";
import {
  feeTokenLabel,
  useHyperionVaultPosition,
} from "./useHyperionVaultPosition";
import { useVaultData } from "./useVaultData";
import { useWalletBalances } from "./useWalletBalances";
import { btcRawToUsdcRaw } from "./vaultMath";

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

  const U64_MAX = 18446744073709551615n;

  /** Mirrors vault.move `btc_owed = shares_in * yab_price / 100_000_000` (estimate at current NAV). */
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

  /** Same economics as `withdraw_usdc`: `usdc_owed = btc_raw_to_usdc_raw(btc_owed, btc_price)`. */
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
    /** USD per 1 full YAB: same spot NAV as Total assets, pro-rata by supply. */
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

  /** Wallet YAB → USD: pro-rata share of spot pool value (`totalSpotUsd`), not on-chain BTC-eq NAV. */
  const walletYabUsd = useMemo(() => {
    if (!data || !navUsd || balanceYab == null || balanceYab === 0n) return null;
    const supply = data.yabSupplyRaw;
    if (supply === 0n) return null;
    return (Number(balanceYab) / Number(supply)) * navUsd.totalSpotUsd;
  }, [data, balanceYab, navUsd]);

  /** Fraction of total YAB supply (raw / raw), for display — not dollar “cost basis”. */
  const walletYabSharePct = useMemo(() => {
    if (!data || balanceYab == null || balanceYab === 0n) return null;
    const supply = data.yabSupplyRaw;
    if (supply === 0n) return null;
    return (Number(balanceYab) / Number(supply)) * 100;
  }, [data, balanceYab]);

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

  return (
    <div className="page">
      <header className="header">
        <h1>YAB vault (internal)</h1>
        <span className="mono">{VAULT_ADDRESS}</span>
      </header>

      <section className="card">
        <h2>Pool (on-chain)</h2>
        {loading && <p>Loading…</p>}
        {error && <p className="err">{error}</p>}
        {data && navUsd && (
          <>
            <p className="nav-explainer">
              <strong>Total assets (USD)</strong> = all {TOKEN_A_SYMBOL} at BTC/USD + all{" "}
              {TOKEN_B_SYMBOL} at $1 face (pos + free).
            </p>
            <dl className="grid">
            <dt className="nav-total-dt">Total assets</dt>
            <dd className="nav-total-dd">
              <span className="nav-usd-big">{formatUsd(navUsd.totalSpotUsd)}</span>
              <span className="muted nav-sub">
                {" "}
                {formatUsd(navUsd.wbtc)} {TOKEN_A_SYMBOL} + {formatUsd(navUsd.usdcFace)}{" "}
                {TOKEN_B_SYMBOL} face
              </span>
              <div className="muted nav-sub">
                Reserves: pos{" "}
                {formatRaw(data.positionBtcRaw, tokenADecimals)} +{" "}
                {formatRaw(data.positionUsdcRaw, tokenBDecimals)} {TOKEN_B_SYMBOL} · free{" "}
                {formatRaw(data.freeBtcRaw, tokenADecimals)} +{" "}
                {formatRaw(data.freeUsdcRaw, tokenBDecimals)} {TOKEN_B_SYMBOL}
              </div>
            </dd>
            <dt>YAB / 1</dt>
            <dd>
              <span className="usd">{formatUsd(navUsd.yabUsdPerFull)}</span>
              <span className="muted">
                {" "}
                spot (supply {data.yabSupplyRaw.toString()} raw)
              </span>
            </dd>
            <dt>BTC/USD cache</dt>
            <dd>
              <strong>
                {formatRaw(
                  data.lastRecordedPrice,
                  BTC_USD_ORACLE_DECIMALS,
                  8,
                )}
              </strong>
              <span className="muted">
                {" "}
                <span className="mono">{data.lastRecordedPrice.toString()}</span>
              </span>
            </dd>
            <dt>Performance fee (harvest only)</dt>
            <dd>
              {data.performanceFeeBps.toString()} bps
              <span className="muted">
                {" "}
                ({formatBpsPercent(data.performanceFeeBps)})
              </span>
            </dd>
          </dl>
          </>
        )}
        <button
          type="button"
          className="btn secondary"
          onClick={() => void refresh()}
        >
          Refresh
        </button>
      </section>

      <section className="card">
        <h2>Hyperion (CLMM)</h2>
        <p className="muted nav-sub">
          Indexer:{" "}
          <a
            href={`/api/yieldai/api/protocols/hyperion/userPositions?address=${encodeURIComponent(VAULT_ADDRESS_NORMALIZED)}`}
            target="_blank"
            rel="noreferrer"
            className="link"
          >
            userPositions
          </a>{" "}
          · vault {shortAddress(VAULT_ADDRESS)}
        </p>
        {hyperionLoading && <p>Loading…</p>}
        {hyperionError && <p className="err">{hyperionError}</p>}
        {!hyperionLoading && !hyperionError && hyperionPositions.length === 0 && (
          <p className="muted">No positions returned for this vault address.</p>
        )}
        {hyperionPositions.map((hp, idx) => {
          const pool = hp.position.pool;
          const poolLabel = `${pool.token1Info.symbol} / ${pool.token2Info.symbol}`;
          const explorerNet =
            (import.meta.env.VITE_NETWORK ?? "mainnet").toLowerCase();
          const objUrl = `https://explorer.aptoslabs.com/object/${encodeURIComponent(hp.position.objectId)}?network=${explorerNet}`;
          return (
            <div key={hp.position.objectId ?? idx} className="hyperion-pos">
              <p className="hyperion-pos-head">
                <span className="usd">
                  ≈ $
                  {Number(hp.value).toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
                <span className="muted">
                  {" "}
                  ·{" "}
                  <span
                    className={
                      hp.isActive ? "hyperion-status active" : "hyperion-status inactive"
                    }
                  >
                    {hp.isActive ? "Active" : "Inactive"}
                  </span>{" "}
                  · {poolLabel} · fee tier {pool.feeTier}
                </span>
              </p>
              <dl className="grid">
                <dt>Tick range</dt>
                <dd>
                  {hp.position.tickLower} … {hp.position.tickUpper}{" "}
                  <span className="muted">
                    (pool tick {pool.currentTick})
                  </span>
                </dd>
                <dt>Position</dt>
                <dd>
                  <a href={objUrl} target="_blank" rel="noreferrer" className="link mono">
                    {shortAddress(hp.position.objectId)}
                  </a>
                </dd>
                <dt>Unclaimed fees</dt>
                <dd>
                  {(hp.fees?.unclaimed ?? []).length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul className="hyperion-fee-list">
                      {(hp.fees?.unclaimed ?? []).map((f) => (
                        <li key={f.token}>
                          {feeTokenLabel(pool, f.token)}:{" "}
                          <span className="usd">
                            $
                            {Number(f.amountUSD).toLocaleString("en-US", {
                              maximumFractionDigits: 6,
                            })}
                          </span>
                          <span className="muted"> · raw {f.amount}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
                <dt>Farm (unclaimed)</dt>
                <dd>
                  {(hp.farm?.unclaimed ?? []).length === 0 ? (
                    <span className="muted">—</span>
                  ) : (
                    <ul className="hyperion-fee-list">
                      {(hp.farm?.unclaimed ?? []).map((f) => (
                        <li key={`farm-${f.token}`}>
                          {feeTokenLabel(pool, f.token)}:{" "}
                          <span className="usd">
                            $
                            {Number(f.amountUSD).toLocaleString("en-US", {
                              maximumFractionDigits: 6,
                            })}
                          </span>
                          <span className="muted"> · raw {f.amount}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </dd>
              </dl>
            </div>
          );
        })}
        <button
          type="button"
          className="btn secondary"
          onClick={() => void refreshHyperion()}
        >
          Refresh
        </button>
      </section>

      <section className="card">
        <h2>Wallet</h2>
        {!connected && (
          <div className="wallet-row">
            {wallets.map((w) => (
              <button
                key={w.name}
                type="button"
                className="btn"
                onClick={() => void connect(w.name)}
              >
                Connect {w.name}
              </button>
            ))}
          </div>
        )}
        {connected && account && (
          <div>
            <p className="mono">{String(account.address)}</p>
            {balErr && <p className="err">{balErr}</p>}
            {balanceA != null && (
              <p className="bal-line">
                {TOKEN_A_SYMBOL} (FA primary store):{" "}
                <strong>
                  {formatRaw(balanceA, tokenADecimals)} {TOKEN_A_SYMBOL}
                </strong>
                <span className="muted">
                  {" "}
                  — {balanceA.toString()} raw
                </span>
              </p>
            )}
            {balanceB != null && (
              <p className="bal-line">
                {TOKEN_B_SYMBOL} (FA primary store):{" "}
                <strong>
                  {formatRaw(balanceB, tokenBDecimals)} {TOKEN_B_SYMBOL}
                </strong>
                <span className="muted">
                  {" "}
                  — {balanceB.toString()} raw
                </span>
              </p>
            )}
            {balanceYab != null && (
              <div className="bal-block">
                <p className="bal-line">
                  {YAB_SYMBOL} (FA primary store):{" "}
                  <strong>
                    {formatRaw(balanceYab, YAB_DECIMALS)} {YAB_SYMBOL}
                  </strong>
                  {walletYabUsd != null && (
                    <span className="usd"> ≈ {formatUsd(walletYabUsd)}</span>
                  )}
                  <span className="muted">
                    {" "}
                    — {balanceYab.toString()} raw
                  </span>
                </p>
                {walletYabSharePct != null && data && (
                  <p className="hint">
                    ≈{" "}
                    {walletYabSharePct < 0.01
                      ? walletYabSharePct.toFixed(4)
                      : walletYabSharePct < 1
                        ? walletYabSharePct.toFixed(3)
                        : walletYabSharePct.toFixed(2)}
                    % of YAB supply ({data.yabSupplyRaw.toString()} raw). USD uses
                    the same spot pool NAV as &quot;Total assets&quot; above (your
                    pro-rata share). A small balance in &quot;full&quot; YAB is
                    normal when supply is mostly raw units. Shares minted before
                    the USDC accounting fix are not re-issued — new deposits use
                    the upgraded module.
                  </p>
                )}
              </div>
            )}
            <button
              type="button"
              className="btn secondary"
              onClick={() => void disconnect()}
            >
              Disconnect
            </button>
          </div>
        )}
      </section>

      <section className="card">
        <h2>Deposit ({TOKEN_A_SYMBOL} only)</h2>
        <p className="hint">
          Pulls {TOKEN_A_SYMBOL} from your primary FA store. Amount defaults to
          wallet balance. Min {MIN_DEPOSIT_TOKEN_A.toString()} raw (
          {TOKEN_A_SYMBOL}).
        </p>
        <label className="field">
          Amount ({TOKEN_A_SYMBOL})
          <div className="row-input">
            <input
              value={depositA}
              onChange={(e) => {
                setDepositAEdited(true);
                setDepositA(e.target.value);
              }}
              className="input"
              disabled={busy}
            />
            <button
              type="button"
              className="btn secondary"
              disabled={busy || balanceA == null || balanceA === 0n}
              onClick={() => {
                if (balanceA == null) return;
                setDepositAEdited(false);
                setDepositA(formatRaw(balanceA, tokenADecimals));
              }}
            >
              Max
            </button>
          </div>
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy || !connected}
          onClick={() => void submitDeposit(true)}
        >
          {busy ? "…" : "deposit"}
        </button>
      </section>

      <section className="card">
        <h2>Deposit ({TOKEN_B_SYMBOL} only)</h2>
        <p className="hint">
          Pulls {TOKEN_B_SYMBOL} from your primary FA store, swaps part B→{TOKEN_A_SYMBOL}{" "}
          per strategy band, then adds liquidity. Amount defaults to wallet balance. Min{" "}
          {MIN_DEPOSIT_TOKEN_B_DUAL.toString()} raw ({TOKEN_B_SYMBOL}).
        </p>
        <label className="field">
          Amount ({TOKEN_B_SYMBOL})
          <div className="row-input">
            <input
              value={depositB}
              onChange={(e) => {
                setDepositBEdited(true);
                setDepositB(e.target.value);
              }}
              className="input"
              disabled={busy}
            />
            <button
              type="button"
              className="btn secondary"
              disabled={busy || balanceB == null || balanceB === 0n}
              onClick={() => {
                if (balanceB == null) return;
                setDepositBEdited(false);
                setDepositB(formatRaw(balanceB, tokenBDecimals));
              }}
            >
              Max
            </button>
          </div>
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy || !connected}
          onClick={() => void submitDepositUsdc()}
        >
          {busy ? "…" : "deposit_usdc"}
        </button>
      </section>

      <section className="card">
        <h2>Deposit dual ({TOKEN_A_SYMBOL} + {TOKEN_B_SYMBOL})</h2>
        <p className="hint">
          Defaults to wallet balances. Min {TOKEN_A_SYMBOL}:{" "}
          {MIN_DEPOSIT_TOKEN_A.toString()} raw; min {TOKEN_B_SYMBOL}:{" "}
          {MIN_DEPOSIT_TOKEN_B_DUAL.toString()} raw.
        </p>
        <label className="field">
          {TOKEN_A_SYMBOL}
          <div className="row-input">
            <input
              value={depositDualA}
              onChange={(e) => {
                setDepositDualEdited(true);
                setDepositDualA(e.target.value);
              }}
              className="input"
              disabled={busy}
            />
            <button
              type="button"
              className="btn secondary"
              disabled={busy || balanceA == null || balanceA === 0n}
              onClick={() => {
                if (balanceA == null) return;
                setDepositDualEdited(true);
                setDepositDualA(formatRaw(balanceA, tokenADecimals));
              }}
            >
              Max
            </button>
          </div>
        </label>
        <label className="field">
          {TOKEN_B_SYMBOL}
          <div className="row-input">
            <input
              value={depositDualB}
              onChange={(e) => {
                setDepositDualEdited(true);
                setDepositDualB(e.target.value);
              }}
              className="input"
              disabled={busy}
            />
            <button
              type="button"
              className="btn secondary"
              disabled={busy || balanceB == null || balanceB === 0n}
              onClick={() => {
                if (balanceB == null) return;
                setDepositDualEdited(true);
                setDepositDualB(formatRaw(balanceB, tokenBDecimals));
              }}
            >
              Max
            </button>
          </div>
        </label>
        <button
          type="button"
          className="btn"
          disabled={busy || !connected}
          onClick={() => void submitDeposit(false)}
        >
          {busy ? "…" : "deposit_dual"}
        </button>
      </section>

      <section className="card">
        <h2>Withdraw ({YAB_SYMBOL} → {TOKEN_A_SYMBOL})</h2>
        <p className="hint">
          Burns YAB from your primary FA store and sends{" "}
          <strong>{TOKEN_A_SYMBOL}</strong> (wrapped BTC on Aptos) to your wallet per
          on-chain NAV — same asset the vault uses for the BTC leg. There is no USDC
          payout on <code className="mono">withdraw</code>; estimate below uses current{" "}
          <code className="mono">yab_price</code> (actual output follows the tx-time
          oracle).
        </p>
        <label className="field">
          {YAB_SYMBOL} to burn
          <div className="row-input">
            <input
              value={withdrawYab}
              onChange={(e) => setWithdrawYab(e.target.value)}
              className="input"
              disabled={busy}
            />
            <button
              type="button"
              className="btn secondary"
              disabled={busy || balanceYab == null || balanceYab === 0n}
              onClick={() => {
                if (balanceYab == null) return;
                setWithdrawYab(formatRaw(balanceYab, YAB_DECIMALS));
              }}
            >
              Max
            </button>
          </div>
        </label>
        {withdrawEstimateBtcRaw != null && (
          <p className="hint">
            ≈ <strong>{formatRaw(withdrawEstimateBtcRaw, tokenADecimals)}</strong>{" "}
            {TOKEN_A_SYMBOL} expected (NAV estimate)
          </p>
        )}
        <button
          type="button"
          className="btn"
          disabled={
            busy ||
            !connected ||
            balanceYab == null ||
            balanceYab === 0n
          }
          onClick={() => void submitWithdraw()}
        >
          {busy ? "…" : "Withdraw"}
        </button>
        <p className="hint" style={{ marginTop: "1rem" }}>
          <strong>{TOKEN_B_SYMBOL}</strong> payout uses the same share economics; estimate converts{" "}
          <code className="mono">btc_owed</code> at the vault oracle (
          <code className="mono">btc_raw_to_usdc_raw</code>).
        </p>
        {withdrawEstimateUsdcRaw != null && data && (
          <p className="hint">
            ≈ <strong>{formatRaw(withdrawEstimateUsdcRaw, tokenBDecimals)}</strong>{" "}
            {TOKEN_B_SYMBOL} expected (oracle nominal, before slippage)
          </p>
        )}
        <button
          type="button"
          className="btn secondary"
          disabled={
            busy ||
            !connected ||
            balanceYab == null ||
            balanceYab === 0n
          }
          onClick={() => void submitWithdrawUsdc()}
        >
          {busy ? "…" : "withdraw_usdc"}
        </button>
      </section>

      {txMsg && <p className="tx-msg">{txMsg}</p>}
    </div>
  );
}
