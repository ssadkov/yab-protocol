import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { AptosWalletAdapterProvider } from "@aptos-labs/wallet-adapter-react";
import { NETWORK } from "./config";
import App from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <AptosWalletAdapterProvider
      autoConnect
      dappConfig={{ network: NETWORK }}
      onError={(err) => console.error("Wallet:", err)}
    >
      <App />
    </AptosWalletAdapterProvider>
  </StrictMode>,
);
