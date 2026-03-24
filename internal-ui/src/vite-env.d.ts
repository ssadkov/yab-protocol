/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NETWORK: string;
  readonly VITE_MODULE_ADDRESS: string;
  readonly VITE_VAULT_ADDRESS: string;
  readonly VITE_TOKEN_A_DECIMALS: string;
  readonly VITE_TOKEN_B_DECIMALS: string;
  readonly VITE_YAB_DECIMALS: string;
  /** Optional: Aptos Developer Portal / provider API key (sent as `Authorization` / `x-aptos-api-key` per SDK) */
  readonly VITE_APTOS_API_KEY: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
