# Deploy-key rotation to a 2-of-3 multisig

How to move an existing Aptos package publisher from a single CLI key to an on-chain `0x1::multisig_account`, then prove the multisig can publish, and only then revoke the old key.

This was rehearsed twice on YAB testnet and completed on the YAB mainnet package. The same sequence applies to another already-published package. The package address stays the same.

Status for YAB mainnet (`0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b`): multisig installed, publish check passed (upgrade 25 → 26), old key revoked (`authentication_key` is 32 zero bytes). A transfer signed by the old profile now simulates as `INVALID_AUTH_KEY`.

## What changes

The publisher account's `authentication_key` becomes `0x0`. After that, that account can sign only through the multisig flow in [Petra Vault](https://vault.petra.app): propose, approve, execute.

The install transaction writes the owner list and the threshold onto that same account. It is signed by the old key. The proof inside it commits to the exact owners, the threshold, the chain id, the account address, and the account's current sequence number. Those owners are fixed by that signature.

## What stays the same

- The package address. Modules stay on the account that already published them.
- The YAB vault object (`0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c` on mainnet).
- `VaultState.admin` and `VaultState.operator`. This rotation does not change them.
- User balances and positions.

`aptos multisig create` is a different operation. It creates a new address and makes the sender an owner. A Petra **Create Vault** button does the same kind of thing: a new address that cannot upgrade the existing package. Import the existing publisher address.

## Owners

Threshold **2 of 3**. The same three Petra accounts were used on testnet and mainnet:

| Owner | Address |
|-------|---------|
| 1 | `0x56ff2fc971deecd286314fe99b8ffd6a5e72e62eacdc46ae9b234c5282985f97` |
| 2 | `0xc9eceb24a8e6cb1065a150587e6ccd604fcc644b73513184309d8f47ceca925a` |
| 3 | `0xd862aaaaccdbff20ec8648bd401c9e4d02377a72e8a33de8d4118659513880ca` |

Browser Petra and mobile Petra are different owners only when they are different addresses. A synced copy of the same key is one owner.

Each owner who will sign needs APT on that network. The creator of a proposal auto-votes yes, so a 2-of-3 needs one more Approve. Any owner can Execute after the threshold is met. The executor pays execute gas. On this cutover, proposing a publish used about 97k gas, an approve used 246 gas, and executing the publish used 1.7k–38k gas depending on the package. `0.1` APT on the approving owner was enough for approve plus execute. An owner with `0` APT cannot sign.

Petra Vault signs with the connected Petra wallet. Ledger works if the Aptos account is imported into Petra (**Add Account → Import from Ledger**), then Petra connects to the vault. Tangem WalletConnect does not cover Aptos. SafePal is not the wallet Petra Vault documents for this flow.

On-chain multisig timelock (`upsert_timelock`, 1 hour–14 days) exists in the framework, but feature bit 115 was off on testnet and mainnet during this cutover. Leave timelock out until `0x1::features` bit 115 is enabled.

## Safe cutover

Use this on a production publisher. The old key stays valid until the last step, so a failed publish check can still be fixed with the CLI key.

| Step | Who signs | Old key afterwards |
|------|-----------|--------------------|
| 1. Install | Old publisher key | Still valid |
| 2. Import the publisher address in Petra Vault | — | Still valid |
| 3. Publish through the vault | Two owners | Still valid. Confirm this before step 4 |
| 4. Revoke | Old publisher key, last time | `authentication_key = 0x0` |

### 1. Install the multisig

Function: `0x1::multisig_account::create_with_existing_account`.

Send it from the publisher profile. Arguments, in order:

| # | Type | Value |
|---|------|--------|
| 1 | `address` | The existing publisher address |
| 2 | `vector<address>` | The owner addresses |
| 3 | `u64` | `2` |
| 4 | `u8` | `0` (Ed25519) |
| 5 | `vector<u8>` | The publisher's 32-byte Ed25519 public key |
| 6 | `vector<u8>` | 64-byte Ed25519 signature of the creation proof |
| 7 | `vector<String>` | `[]` |
| 8 | `vector<vector<u8>>` | `[]` |

The chain rebuilds `0x1::multisig_account::MultisigAccountCreationMessage` and checks the signature with `account::verify_signed_message`. Fields of that message:

| Field | Value |
|-------|--------|
| `chain_id` | `1` mainnet, `2` testnet |
| `account_address` | The publisher address |
| `sequence_number` | The publisher's **current** sequence number, the one this transaction will use |
| `owners` | The same vector passed as argument 2 |
| `num_signatures_required` | `2` |

`current + 1` aborts with `0x1::account: EINVALID_PROOF_OF_KNOWLEDGE` (`0x10008`). Metadata keys and values stay empty.

Before sending, read `0x1::account::Account` on the publisher. `rotation_capability_offer.for.vec` and `signer_capability_offer.for.vec` should be empty. A non-empty offer is a second way to act as the account and has to be cleared on purpose.

After the transaction:

- `0x1::multisig_account::MultisigAccount` exists on the publisher address.
- `owners` and `num_signatures_required` match the proof.
- `authentication_key` is still equal to the address.

`create_with_existing_account_and_revoke_auth_key` cannot be called later. Once `MultisigAccount` exists, `move_to` aborts. The later revoke is a separate entry.

### 2. Import the vault

In Petra Vault, choose **Import** and paste the publisher address. That is the account where the modules and the new `MultisigAccount` live.

For YAB mainnet that address is `0xd42e…a60b`:

https://vault.petra.app/vault/mainnet/0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b

The YAB vault object `0x599b04…` is a different address. It does not hold the multisig.

### 3. Publish through the vault

Build a compatible upgrade payload. `Move.toml` in git stays on the mainnet addresses. `aptos move build-publish-payload --named-addresses` refuses a name that is already set in `Move.toml`. For a testnet rehearsal, substitute `yab` and `dex_contract` only for the build, then restore the file. Do not commit the JSON payload.

```text
aptos move build-publish-payload --json-output-file publication.json --included-artifacts none --skip-fetch-latest-git-deps --assume-yes --profile <publisher-profile>
```

The payload calls `0x1::code::publish_package_txn`. In the vault open **Smart Contracts → Publish Contract**, upload the JSON, and let Petra simulate. **Create Proposal** spends the creator's APT and counts as one yes. A second owner presses **Approve**. Any owner then presses **Execute**.

Confirm both of these before revoking:

- `0x1::code::PackageRegistry` upgrade number increased by 1.
- `authentication_key` is still the original key.

The YAB mainnet payload matched the live bytecode except the compiler version (`2.0.2.3` → `2.0.2.4`). The upgrade number still moved, which is the check that the multisig can publish. A later production upgrade uses the same Petra path with a real code change.

### 4. Revoke the old key

Signed by the publisher profile. This is its last successful transaction.

```text
aptos move run --profile <publisher-profile> --function-id 0x1::account::rotate_authentication_key_call --args hex:0000000000000000000000000000000000000000000000000000000000000000 --assume-yes
```

`rotate_authentication_key_call` is private and `is_entry`. The argument is 32 zero bytes. It sets `authentication_key` directly. Owners are unchanged.

### 5. Confirm the old key is dead

`authentication_key` on the publisher is `0x0000…0000`. A transaction from that profile simulates as `INVALID_AUTH_KEY` and is not submitted. Further publishes go through the vault.

## One-shot install

`0x1::multisig_account::create_with_existing_account_and_revoke_auth_key` installs the multisig and sets `authentication_key` to `0x0` in one transaction. The proof struct is `MultisigAccountCreationWithAuthKeyRevocationMessage`, with the same fields. If that transaction aborts, the multisig is not created and the old key remains. Use it on a throwaway account whose owners are already proven. The YAB testnet `default` package used this path. The production path is the safe cutover above.

## YAB record

### Testnet A — one shot (`default`)

Profile `default`. Package `0x8a233984c022b893a3b84f031abbac21ac5e9dd58159bce14b8ed0a155baaffb`.

| Field | Value |
|-------|--------|
| Function | `create_with_existing_account_and_revoke_auth_key` |
| Signer | Old `default` key. The multisig did not exist yet. |
| Hash | `0x83744341243e73d24e8f734ecb4b492444ea0ab0fc08640525bb6cf9771b0b18` |
| Version | `11404080155` |
| Gas | 6836 |
| Result | `authentication_key = 0x0` |

[Explorer](https://explorer.aptoslabs.com/txn/0x83744341243e73d24e8f734ecb4b492444ea0ab0fc08640525bb6cf9771b0b18?network=testnet)

A `0.1` APT transfer then checked propose / approve / execute. It does not upgrade the package.

| Step | Signer | Hash |
|------|--------|------|
| Propose | `0x56ff…f597` | `0xc96f09074e73f62e12a50b077c5af689905e2aced0746afea8a93e6d967997db` |
| Approve | `0xc9ec…925a` | `0x80946a68ea965111a7536d5894c4d79fd97649c130bb6820bfac2d5f4cde70f5` |
| Execute `transfer_coins` of `10000000` octas to `0xc9ec…925a` | `0xc9ec…925a` | `0x4341f7072457283383fb953e81c713493e4cebb2de2eb43e1b8becf38c093742` |

[Execute](https://explorer.aptoslabs.com/txn/0x4341f7072457283383fb953e81c713493e4cebb2de2eb43e1b8becf38c093742?network=testnet)

Package publish (`publication-testnet.json`, testnet Hyperion `0x69faed94da99abb7316cb3ec2eeaa1b961a47349fad8c584f67a930b0d14fec7`). Upgrade **4 → 5**. `0xd862…` did not sign.

| Step | Signer | Hash |
|------|--------|------|
| Propose | `0xc9ec…925a` | `0x6d17f537339a62bd8b03e3986d8335d1d0adbac7a5846a354fde717d4861e621` |
| Approve | `0x56ff…f597` | `0xa99bdb63b2f433e84d6e0b498ac6a6d62c93df5e1377512cbef2c9c0b6e14c9b` |
| Execute | `0x56ff…f597` | `0xed3263a0026331f189811ef721cb7ad3c3acce550ee2251171974e3f69f0e481` |

[Publish](https://explorer.aptoslabs.com/txn/0xed3263a0026331f189811ef721cb7ad3c3acce550ee2251171974e3f69f0e481?network=testnet)

### Testnet B — safe cutover (`deploy2`)

Profile `deploy2`. Package `0x5c40fdcb53b9ca4f5cbf1d7d1647e3a0503ecfaa68209f643b49dab56f3d55bc`. This is the sequence copied to mainnet.

Install, old key kept. Hash `0xc88f2726beab8365434f996bfad02a3d9ee7f6a45f7f4d84721a7d0c1bc9d694`, version `11411388553`, gas 6834. [Explorer](https://explorer.aptoslabs.com/txn/0xc88f2726beab8365434f996bfad02a3d9ee7f6a45f7f4d84721a7d0c1bc9d694?network=testnet).

Publish (`publication-deploy2.json`). The previous package did not depend on Pyth. Upgrade **1 → 2** still succeeded. Gas 38354. `authentication_key` was still the original key.

| Step | Signer | Hash |
|------|--------|------|
| Propose | `0x56ff…f597` | `0x372ea828d67207170175221f884c42601d956b0adc655f34c44d6bdfc3285122` |
| Approve | `0xd862…80ca` | `0x54c0d303bbc44aa8b97ae4a8b333d8fec5c35a4fe9a1cb921fbfe2c467c6f209` |
| Execute | `0xd862…80ca` | `0xc304a2906047e1b6cf611cc827b42e1d5da950f416f42560788ddd4e6e4f1958` |

[Publish](https://explorer.aptoslabs.com/txn/0xc304a2906047e1b6cf611cc827b42e1d5da950f416f42560788ddd4e6e4f1958?network=testnet)

Revoke. Hash `0x07808eb882d914fbe1d1152ec39727a0a3181e4c5069469ad2d8fa14a8f3e681`, version `11411958676`, gas 49. [Explorer](https://explorer.aptoslabs.com/txn/0x07808eb882d914fbe1d1152ec39727a0a3181e4c5069469ad2d8fa14a8f3e681?network=testnet). `authentication_key = 0x0`. Owners unchanged.

### Mainnet

Profile `mainnet_deployer`. Package `0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b`. Hyperion `0x8b4a2c4bb53857c718a04c020b98f8c2e1f99a68b0f57389a8bf5434cd22e05c`. Vault object `0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c`.

At install time owner 2 held `30234` octas and owner 3 held `0`. Owner 1 sent `0.1` APT to owner 2 before the publish (`0x2d4ead29b4d09604a00f08f6965b3a4a5ca05d9d85e9a6e3e9a50f56f7c82479`). Owner 3 did not sign the publish. Capability offers were empty.

| Step | Signer | Hash | Result |
|------|--------|------|--------|
| Install | Old `mainnet_deployer` key | `0xb97dfd313d70a37b494646d020f6308377712506462be51469ef80b23e2da64a` | Version `7362853920`, gas 6833. Auth key unchanged. |
| Propose publish | `0x56ff…f597` | `0xf43f0d3a2906a54aca427ca1d8e81b838ca80c89298a3caddfacf6b9e01ff938` | Payload `publication-mainnet.json` |
| Approve | `0xc9ec…925a` | `0x4afe9bbf46bfad48a74977d63c544aa7ab3d9de54aee2983f5b0dbc9ca8e5f91` | Gas 246 |
| Execute publish | `0xc9ec…925a` | `0x042bd3b1cff51366f58b4d0760f1f711f9042aebe9a199d5f17c129fd003ec56` | Upgrade **25 → 26**. Auth key still the original key. |
| Revoke | Old `mainnet_deployer` key | `0x06860f39798090ae6ec9a7099be03b8006ed246e7df9fa40532a2eef8f804b09` | Version `7366605721`, gas 50. `authentication_key = 0x0` |

[Install](https://explorer.aptoslabs.com/txn/0xb97dfd313d70a37b494646d020f6308377712506462be51469ef80b23e2da64a?network=mainnet) · [Publish](https://explorer.aptoslabs.com/txn/0x042bd3b1cff51366f58b4d0760f1f711f9042aebe9a199d5f17c129fd003ec56?network=mainnet) · [Revoke](https://explorer.aptoslabs.com/txn/0x06860f39798090ae6ec9a7099be03b8006ed246e7df9fa40532a2eef8f804b09?network=mainnet)
