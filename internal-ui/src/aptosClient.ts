import { Aptos, AptosConfig } from "@aptos-labs/ts-sdk";
import { NETWORK } from "./config";

let client: Aptos | null = null;

export function getAptos(): Aptos {
  if (!client) {
    const apiKey = import.meta.env.VITE_APTOS_API_KEY?.trim();
    client = new Aptos(
      new AptosConfig({
        network: NETWORK,
        ...(apiKey ? { clientConfig: { API_KEY: apiKey } } : {}),
      }),
    );
  }
  return client;
}
