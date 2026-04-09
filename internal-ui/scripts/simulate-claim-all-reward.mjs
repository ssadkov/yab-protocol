import fs from "node:fs";
import path from "node:path";
import { Aptos, AptosConfig, Network, Ed25519PublicKey } from "@aptos-labs/ts-sdk";

const REWARD_MODULE_ADDR =
  "0xbefca24468c1cce695166e97c90adbd9fc07e4889e6dd1c647bed4bc237e1736";
const FUNCTION_ID = `${REWARD_MODULE_ADDR}::reward::claim_all_reward`;
const VAULT_ADDRESS =
  "0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c";

function readProfilePublicKeyHex(profileName) {
  const repoRoot = path.resolve(process.cwd(), "..");
  const cfgPath = path.join(repoRoot, ".aptos", "config.yaml");
  const txt = fs.readFileSync(cfgPath, "utf8");
  const re = new RegExp(
    `\\n\\s*${profileName}:\\s*\\n[\\s\\S]*?\\n\\s*public_key:\\s*ed25519-pub-(0x[0-9a-fA-F]+)\\s*\\n`,
  );
  const m = txt.match(re);
  if (!m) throw new Error(`Could not find public_key for profile '${profileName}' in ${cfgPath}`);
  return m[1];
}

function parseArgTy(ty) {
  // Examples: "&signer", "address", "vector<address>", "u64", "vector<vector<u8>>"
  return String(ty ?? "").replace(/\s+/g, "");
}

function buildFunctionArgs(paramTys) {
  // Skip signer param.
  const tys = paramTys.filter((t) => parseArgTy(t) !== "&signer");
  if (tys.length === 0) return [];
  if (tys.length === 1) {
    const t = parseArgTy(tys[0]);
    if (t === "address") return [VAULT_ADDRESS];
    if (t === "vector<address>") return [[VAULT_ADDRESS]];
  }
  throw new Error(`Unsupported function signature params=${JSON.stringify(tys)}`);
}

async function main() {
  const aptos = new Aptos(
    new AptosConfig({ network: Network.MAINNET }),
  );

  const senderAccount = "0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b";

  const mod = await aptos.getAccountModule({
    accountAddress: REWARD_MODULE_ADDR,
    moduleName: "reward",
  });
  const abi = mod?.abi;
  if (!abi?.exposed_functions) throw new Error("Module ABI missing exposed_functions");

  const fn = abi.exposed_functions.find((f) => f.name === "claim_all_reward");
  if (!fn) throw new Error("ABI: claim_all_reward not found");

  const fnArgs = buildFunctionArgs(fn.params ?? []);

  const pubHex = readProfilePublicKeyHex("mainnet_deployer");
  const signerPublicKey = new Ed25519PublicKey(pubHex);

  const tx = await aptos.transaction.build.simple({
    sender: senderAccount,
    data: {
      function: FUNCTION_ID,
      functionArguments: fnArgs,
    },
  });

  const [sim] = await aptos.transaction.simulate.simple({
    signerPublicKey,
    transaction: tx,
  });

  // Keep output compact for pasting.
  console.log(JSON.stringify({
    function: FUNCTION_ID,
    args: fnArgs,
    success: sim.success,
    vm_status: sim.vm_status,
    gas_used: sim.gas_used,
  }, null, 2));
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
});

