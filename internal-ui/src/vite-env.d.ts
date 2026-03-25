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
  /** Optional full URL to Hyperion userPositions API (bypasses proxy). */
  readonly VITE_HYPERION_USER_POSITIONS_URL: string;
  /** Set `true` in production build if your host proxies `/api/yieldai` like Vite dev. */
  readonly VITE_HYPERION_USE_PROXY: string;
  /** Proxy target for dev (default `https://yieldai.app`). */
  readonly VITE_HYPERION_PROXY_TARGET: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
