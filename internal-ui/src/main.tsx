import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import type { Network } from "@aptos-labs/ts-sdk";
import { NETWORK } from "./config";
import App from "./App";
import "./style.css";

const apiKey = import.meta.env.VITE_APTOS_API_KEY?.trim();

const dappConfig: {
  network: Network;
  aptosApiKeys?: Partial<Record<Network, string>>;
} = {
  network: NETWORK,
};

if (apiKey) {
  dappConfig.aptosApiKeys = { [NETWORK]: apiKey };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AptosWalletAdapterProvider
      autoConnect
      dappConfig={dappConfig}
      onError={(err) => console.error("Wallet:", err)}
    >
      <App />
    </AptosWalletAdapterProvider>
  </StrictMode>,
);
