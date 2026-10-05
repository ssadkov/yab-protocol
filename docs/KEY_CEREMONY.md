# Key ceremony

How to replace the owners of the YAB publisher multisig with four new keys at threshold 2 of 4. The same keys are rehearsed on testnet first and then become the mainnet owners.

The multisig itself was installed as described in [`MULTISIG_DEPLOY_KEY.md`](./MULTISIG_DEPLOY_KEY.md). This document only changes who the owners are.

## What the multisig controls

The mainnet publisher `0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b` has `authentication_key = 0x0`. It signs only through [Petra Vault](https://vault.petra.app). It holds two powers:

- **Package upgrades.** The modules live on this account.
- **`VaultState.admin`.** `vault::initialize` stores its caller as admin and the vault object address is `create_named_object(caller, b"YAB_VAULT_V1")`. The mainnet vault `0x599b04…379c` derives from `0xd42e…`, so the publisher is the admin. There is no `set_admin`. The owners of this multisig therefore also sign `set_operator`, `set_performance_fee`, `set_strategy_params` and `sync_oracle_baseline_with_pyth_update`.

`VaultState.operator` stays a single hot key for the bot. Replacing it is `set_operator`, which needs two owners.

Check the admin before starting:

```text
curl -s "https://fullnode.mainnet.aptoslabs.com/v1/accounts/0x599b04f9fc1c3702da76430d96a7962adbafd76941fe980d12e0bc0033f1379c/resource/0xd42e699a4b22880d77da7dd02bb2fa768ecaa8cb1c4aa1423f968f480c97a60b::vault::VaultState" | jq '.data | {admin, operator, treasury}'
```

`admin` should be `0xd42e…a60b`.

## Owners and threshold

Four owners, threshold **2 of 4**. Three keys belong to the founder, on three separate devices. One key belongs to a second team member.

This is an accepted decision: the founder alone reaches the threshold. The design protects against the loss or theft of one device. It does not require two people for a publish. The fourth key is a recovery key.

Do not record in this repository which address is on which device or belongs to which person. The addresses are public on-chain. The mapping is not.

## Rules for every step

1. **One seed per owner.** Each key is a new Petra wallet created on its own device. It is not another account added inside an existing wallet: those derive from the same mnemonic and count as one owner.
2. **Seeds stay offline.** No seed in cloud storage, messengers, password managers with sync, or screenshots.
3. **At least one offline backup.** At least one owner key, preferably the Ledger, has its seed on paper or steel, stored away from the other devices. With `authentication_key = 0x0`, losing three of four keys freezes the package and the admin role permanently.
4. **Owner accounts are single-purpose.** They connect only to `vault.petra.app`. No other dapps, no DeFi, no NFTs. Keep 0.1–0.5 APT on each for gas.
5. **Addresses are confirmed by voice.** An address sent in writing is read back on a call, at least the first 6 and last 6 hex characters. The owner list is fixed by a signature. A substituted address makes a stranger an owner.
6. **Check the network in Petra before each signature.** The same keys sign on testnet and mainnet.
7. **Approve only announced proposals.** Every proposal is announced out of band before it is created. An unannounced proposal is rejected, not approved.
8. **Publish only from a git tag.** The approver rebuilds the payload from the same tag with the same `aptos` CLI version and runs `aptos multisig verify-proposal` against the on-chain proposal. A mismatch stops the publish. The compiler version changes the bytecode, so pin the CLI version in the record.
9. **No timelock yet.** `0x1::features` bit 115 was off during the multisig install. Two owner keys can propose, approve and execute within seconds. Once the feature is enabled, revisit `upsert_timelock`.

## Phase 0 — Generate the keys

| Step | Who | Check |
|------|-----|-------|
| 0.1 | Each owner, on their own device | New Petra wallet (Create, not Add Account). For the Ledger key: **Add Account → Import from Ledger**. |
| 0.2 | Owner with the backup key | Seed written on paper or steel and stored away from the other devices. |
| 0.3 | Each owner | Sends the address. Every address is read back on a call. |
| 0.4 | Founder | Four distinct addresses. None of them equals an old owner. |
| 0.5 | Each owner | Testnet APT from the faucet. |

Views used below, all `#[view]` in `0x1::multisig_account`:

| View | Returns |
|------|---------|
| `owners(multisig)` | Current owner list |
| `num_signatures_required(multisig)` | Threshold |
| `get_pending_transactions(multisig)` | Proposals not yet executed or rejected |
| `get_transaction(multisig, seq)` | One proposal with its payload and votes |
| `next_sequence_number(multisig)` | Next proposal number |

```text
aptos move view --function-id 0x1::multisig_account::owners --args address:<multisig> --url https://fullnode.testnet.aptoslabs.com
```

## Phase 1 — Testnet rehearsal

Target: testnet package `deploy2`, `0x5c40fdcb53b9ca4f5cbf1d7d1647e3a0503ecfaa68209f643b49dab56f3d55bc`. It is a multisig with the same three old owners as mainnet and `authentication_key = 0x0`, so the steps match mainnet exactly. If `vault::initialize` was called from this publisher, its vault is `0x8199a319d324f793ef1b5fc3c1957cbea671a91d944099de444d442fdcbfbb0f`.

Owner changes are ordinary multisig proposals whose payload calls a `0x1::multisig_account` entry function with the multisig as signer.

### 1.1 Add the new owners

| Field | Value |
|-------|-------|
| Function | `0x1::multisig_account::add_owners` |
| Argument | `vector<address>`: the four new addresses |
| Proposed and approved by | Two old owners |

After execution: `owners` lists seven addresses, `num_signatures_required` is still `2`.

### 1.2 Every new key signs

Each new owner must propose once, approve once, execute once and reject once. Use transfers of `0.01` APT from the multisig to one of the owners.

| Owner | Propose | Approve | Execute | Reject |
|-------|---------|---------|---------|--------|
| 1 | | | | |
| 2 | | | | |
| 3 | | | | |
| 4 | | | | |

Fill each cell with the transaction hash.

### 1.3 Remove the old owners

| Field | Value |
|-------|-------|
| Function | `0x1::multisig_account::remove_owners` |
| Argument | `vector<address>`: `0x56ff…f597`, `0xc9ec…925a`, `0xd862…80ca` |
| Proposed and approved by | Two **new** owners only |

After execution: `owners` equals the four new addresses, threshold `2`. An approve from an old owner fails.

### 1.4 Publish with a real code change

1. Tag the commit.
2. Proposer builds the payload per `MULTISIG_DEPLOY_KEY.md` step 3 and creates the proposal in **Smart Contracts → Publish Contract**.
3. Approver checks out the same tag, builds the same payload with the same CLI version, and runs:

   ```text
   aptos multisig verify-proposal --multisig-address <multisig> --sequence-number <seq> --json-file publication.json --url https://fullnode.testnet.aptoslabs.com
   ```

4. Approve only if verification passes. Execute.
5. `0x1::code::PackageRegistry` `upgrade_number` increased by 1.

### 1.5 Admin calls through the vault

Skip if the testnet vault is not initialized. Each call sets the current value again, so nothing changes.

| Call | Arguments |
|------|-----------|
| `vault::set_operator` | vault address, current operator |
| `vault::set_performance_fee` | vault address, current `performance_fee_bps` |
| `vault::set_strategy_params` | vault address, current three params |
| `vault::sync_oracle_baseline_with_pyth_update` | vault address, Hermes update data |

The Pyth call is the one that can fail. Its update data is fixed when the proposal is created and can be stale by execution time, and the Pyth fee is withdrawn from the multisig account, which needs APT. Rehearse the workaround: right before Execute, anyone refreshes the feed with a separate `pyth::update_price_feeds` transaction. The stale data inside the proposal is then ignored and the call reads the fresh price.

### 1.6 Reject drill

In multisig v2 proposals execute strictly in sequence order. A pending proposal blocks every later one. One stolen key can fill the queue with proposals.

1. One owner creates an unannounced proposal.
2. Two other owners reject it (`reject_transaction`).
3. Any owner runs `execute_rejected_transaction`.
4. `get_pending_transactions` is empty and the next proposal executes.

### 1.7 Lost device drill

Pretend owner X is lost.

1. Two other owners run `swap_owner(to_swap_in = T, to_swap_out = X)`, with T a throwaway testnet key.
2. X can no longer approve.
3. Swap back: `swap_owner(to_swap_in = X, to_swap_out = T)`.

### Exit criteria

Mainnet starts only when all of these hold:

- [ ] Every cell of the 1.2 table has a hash.
- [ ] 1.3 done by new owners only.
- [ ] 1.4 publish passed `verify-proposal` and increased `upgrade_number`.
- [ ] 1.6 and 1.7 done.
- [ ] Backup from 0.2 exists and was checked (restore on a spare device or Ledger recovery check, then wipe the spare).
- [ ] Each new owner holds at least 0.2 APT on mainnet.
- [ ] Two old owner keys are available for step 2.2.

## Phase 2 — Mainnet

Do 2.2 to 2.4 on the same day. Between them the multisig has seven owners and any two of them can act.

### 2.1 Pre-checks

- `owners(0xd42e…)` is the three old owners, threshold `2`.
- `get_pending_transactions(0xd42e…)` is empty.
- `authentication_key` of `0xd42e…` is `0x0`.
- `VaultState.admin` is `0xd42e…`.

### 2.2 Add the new owners

`add_owners` with the four new addresses, proposed and approved by two old owners. After: seven owners, threshold `2`.

### 2.3 Prove the new keys on mainnet

Two new owners propose, approve and execute a `0.01` APT transfer from the multisig. Prefer that the second team member's key is one of them.

### 2.4 Remove the old owners

`remove_owners` with the three old addresses, proposed and approved by two new owners only.

### 2.5 Post-checks

- `owners(0xd42e…)` is the four new addresses, threshold `2`.
- An approve simulated from an old owner fails.
- Old owner keys: move their APT out, then remove them from Petra so they are not used by mistake.
- Testnet package `default` (`0x8a233984…baaffb`) still has the old owners. Either run 1.1 and 1.3 on it too or treat it as abandoned.
- Update the owners table in `MULTISIG_DEPLOY_KEY.md`.

## After the ceremony

| When | What |
|------|------|
| Every quarter | Each owner signs one testnet approval. Same keys, no mainnet cost. It proves the key and the device still work. |
| Always | Alert when `next_sequence_number` of `0xd42e…` grows (a new proposal) and when `PackageRegistry.upgrade_number` grows. |
| A device is lost | `swap_owner` it out within days. Do not wait until a second device is lost. |
| One key is suspected stolen | Reject its pending proposals, then `swap_owner` it out with two other owners. One key alone cannot execute anything. |
| Two keys are suspected stolen | The attacker can already act, because there is no timelock. Move first: `swap_owner` both out with the two remaining keys. |
| The second team member leaves | `swap_owner` their key for a new one before their last day. |
| A new vault is created | Call `vault::initialize` through the multisig. From a CLI key, that key becomes the admin of the new vault. |

## Record

Aptos CLI version used for builds:

| Phase | Step | Hash | Notes |
|-------|------|------|-------|
| 1 | 1.1 add owners | | |
| 1 | 1.3 remove owners | | |
| 1 | 1.4 publish | | `upgrade_number` → |
| 1 | 1.6 reject | | |
| 1 | 1.7 swap out / back | | |
| 2 | 2.2 add owners | | |
| 2 | 2.3 proof transfer | | |
| 2 | 2.4 remove owners | | |
