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
  const [depositDualA, setDepositDualA] = useState("");
  const [depositDualB, setDepositDualB] = useState("");
  const [depositDualEdited, setDepositDualEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [txMsg, setTxMsg] = useState<string | null>(null);

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

  useEffect(() => {
    if (!connected) {
      setDepositAEdited(false);
      setDepositDualEdited(false);
      setDepositA("");
      setDepositDualA("");
      setDepositDualB("");
    }
  }, [connected]);

  useEffect(() => {
    if (depositAEdited || balanceA == null) return;
    setDepositA(formatRaw(balanceA, tokenADecimals));
  }, [balanceA, tokenADecimals, depositAEdited]);

  useEffect(() => {
    if (depositDualEdited || balanceA == null || balanceB == null) return;
    setDepositDualA(formatRaw(balanceA, tokenADecimals));
    setDepositDualB(formatRaw(balanceB, tokenBDecimals));
  }, [balanceA, balanceB, tokenADecimals, tokenBDecimals, depositDualEdited]);

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

      {txMsg && <p className="tx-msg">{txMsg}</p>}
    </div>
  );
}
