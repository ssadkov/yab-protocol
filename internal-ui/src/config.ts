import { Network } from "@aptos-labs/ts-sdk";
import { normalizeAccountAddress } from "./addresses";

const DEFAULT_MODULE =
  "0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b";
const DEFAULT_VAULT =
  "0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c";

function networkFromEnv(): Network {
  const n = (import.meta.env.VITE_NETWORK ?? "mainnet").toLowerCase();
  if (n === "mainnet") return Network.MAINNET;
  if (n === "testnet") return Network.TESTNET;
  if (n === "devnet") return Network.DEVNET;
  return Network.MAINNET;
}

export const NETWORK = networkFromEnv();
export const MODULE_ADDRESS = (
  import.meta.env.VITE_MODULE_ADDRESS ?? DEFAULT_MODULE
).trim();
export const VAULT_ADDRESS = (
  import.meta.env.VITE_VAULT_ADDRESS ?? DEFAULT_VAULT
).trim();

/** Long AIP-40 form for RPC / views / txs */
export const VAULT_ADDRESS_NORMALIZED = normalizeAccountAddress(VAULT_ADDRESS);

/** Mainnet pool labels (internal UI); decimals still from env */
export const TOKEN_A_SYMBOL = "WBTC";
export const TOKEN_B_SYMBOL = "USDC";

/** WBTC-style (8) / USDC-style (6) — adjust via env for your deployment */
export const TOKEN_A_DECIMALS = Number(
  import.meta.env.VITE_TOKEN_A_DECIMALS ?? "8",
);
export const TOKEN_B_DECIMALS = Number(
  import.meta.env.VITE_TOKEN_B_DECIMALS ?? "6",
);

export const VAULT_STATE_TYPE = `${MODULE_ADDRESS}::vault::VaultState` as const;

/** On-chain minimums (vault.move) */
export const MIN_DEPOSIT_TOKEN_A = 20_000n;
export const MIN_DEPOSIT_TOKEN_B_DUAL = 100n;
