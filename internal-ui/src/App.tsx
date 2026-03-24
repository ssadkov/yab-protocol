import { useWallet } from "@aptos-labs/wallet-adapter-react";
import { useEffect, useState } from "react";
import {
  MIN_DEPOSIT_TOKEN_A,
  MIN_DEPOSIT_TOKEN_B_DUAL,
  MODULE_ADDRESS,
  TOKEN_A_SYMBOL,
  TOKEN_B_SYMBOL,
  VAULT_ADDRESS,
  VAULT_ADDRESS_NORMALIZED,
} from "./config";
import { formatRaw, parseToRaw } from "./format";
import { getAptos } from "./aptosClient";
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
    useVaultData();

  const owner =
    connected && account ? String(account.address) : undefined;

  const {
    balanceA,
    balanceB,
    error: balErr,
    refresh: refreshBalances,
  } = useWalletBalances(
    owner,
    data?.tokenAMetadata,
    data?.tokenBMetadata,
  );

  const [depositA, setDepositA] = useState("");
  const [depositAEdited, setDepositAEdited] = useState(false);
  const [depositDualA, setDepositDualA] = useState("");
  const [depositDualB, setDepositDualB] = useState("");
  const [depositDualEdited, setDepositDualEdited] = useState(false);
  const [busy, setBusy] = useState(false);
  const [txMsg, setTxMsg] = useState<string | null>(null);

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
            functionArguments: [VAULT_ADDRESS_NORMALIZED, raw],
          },
        });
        await aptos.waitForTransaction({
          transactionHash: pending.hash,
        });
        setTxMsg(`deposit ok: ${pending.hash}`);
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
            functionArguments: [VAULT_ADDRESS_NORMALIZED, rawA, rawB],
          },
        });
        await aptos.waitForTransaction({
          transactionHash: pending.hash,
        });
        setTxMsg(`deposit_dual ok: ${pending.hash}`);
      }
      await refresh();
      await refreshBalances();
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
        {data && (
          <dl className="grid">
            <dt>
              {TOKEN_A_SYMBOL} in vault (position + free, raw units)
            </dt>
            <dd>
              {data.tokenARaw.toString()} raw
              <span className="muted">
                {" "}
                ≈ {formatRaw(data.tokenARaw, tokenADecimals)} {TOKEN_A_SYMBOL}
              </span>
            </dd>
            <dt>
              {TOKEN_B_SYMBOL} in vault (position + free, raw units)
            </dt>
            <dd>
              {data.tokenBRaw.toString()} raw
              <span className="muted">
                {" "}
                ≈ {formatRaw(data.tokenBRaw, tokenBDecimals)} {TOKEN_B_SYMBOL}
              </span>
            </dd>
            <dt>Total assets ({TOKEN_A_SYMBOL} equivalent, computed)</dt>
            <dd>
              {data.totalAssetsRaw.toString()} raw
              <span className="muted">
                {" "}
                ≈ {formatRaw(data.totalAssetsRaw, tokenADecimals)} {TOKEN_A_SYMBOL}
              </span>
            </dd>
            <dt>YAB price (raw, computed)</dt>
            <dd>{data.yabPriceRaw.toString()}</dd>
            <dt>Last recorded BTC/USD oracle</dt>
            <dd>{data.lastRecordedPrice.toString()}</dd>
            <dt>Performance fee (bps)</dt>
            <dd>{data.performanceFeeBps.toString()}</dd>
          </dl>
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
