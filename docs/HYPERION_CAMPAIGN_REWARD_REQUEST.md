# Hyperion: campaign reward claim integration (request for support)

This note records the message to send to the Hyperion team when following up on **campaign rewards** (`0xbefca24468c1cce695166e97c90adbd9fc07e4889e6dd1c647bed4bc237e1736::reward`) for the YAB vault (object-based LP).

**Context in this repo**

- Normal CLMM flows use `vault_signer` from `ExtendRef` and call Hyperion **`public fun`** APIs (`pool_v3`, `router_v3`, `position_v3`); Hyperion sees the **vault object address** as the acting account.
- Campaign `reward` exposes **`claim_reward_by_pool` / `claim_all_reward` only as `public entry`**, so they cannot be invoked from `vault.move` with `vault_signer`.
- Claiming from CLI with an EOA can abort with **`E_USER_NOT_EXISTS`** if rewards are keyed to the **vault address** while `entry` uses the **transaction sender** as `signer`.

---

## Draft message (English — copy to Hyperion)

**Subject / title:** Request: non-entry campaign reward claim (or equivalent) for vault / object LP on Aptos

Hi Hyperion team,

We’re building **YAB**, an Aptos vault protocol that runs liquidity on Hyperion CLMM. The vault is implemented as an **`object::Object`** with an **`ExtendRef`**. For normal DEX interactions we use **`object::generate_signer_for_extending`** and pass that **`vault_signer`** into your **`pool_v3` / `router_v3` / `position_v3` `public fun` APIs**, so Hyperion sees the **vault object address** as the acting account—this works well.

We’re integrating **campaign rewards** from your package  
`0xbefca24468c1cce695166e97c90adbd9fc07e4889e6dd1c647bed4bc237e1736::reward`.

**Issue**

- `claim_reward_by_pool` and `claim_all_reward` are exposed only as **`public entry`** functions with `&signer`.
- In Move, **`entry` functions cannot be called from another module**, so our `vault` module cannot perform the claim internally using **`vault_signer`** in the same way we do for `pool_v3::claim_rewards`.
- When we invoke `claim_reward_by_pool` from the Aptos CLI with an **EOA** (e.g. admin/operator), simulation fails with **`E_USER_NOT_EXISTS`**, which suggests campaign rewards are attributed to a **different “user” identity** (we believe the **vault object address**—consistent with `get_claimable_reward` / `get_claimable_reward_by_pool` being called with the **vault** as the first address argument).

So we appear to be in a situation where:

- rewards accrue to **address V** (vault object), but  
- **`entry` claim** only accepts **the transaction sender’s signer**, not a programmatic **`vault_signer`** from `ExtendRef`.

**What we need**

We’d like your guidance on the **supported** way to claim campaign rewards when the LP / entitled account is an **object without a traditional Ed25519 key**, and the protocol operator only signs transactions to our vault module.

**Questions**

1. **Who is the canonical `user` / reward account** for campaign emissions tied to our CLMM position—the **vault object address**, the **position** address, or something else? How does that map to `get_claimable_reward` / `get_claimable_reward_by_pool`?

2. Is there (or can you add) a **`public fun`** (non-entry) variant, e.g.  
   `claim_reward_by_pool_for(claimer: &signer, reward_user: address, pool: address)`  
   (or equivalent), where:
   - **`reward_user`** is the vault object address that actually holds the entitlement, and  
   - **`claimer`** is an authorized party (operator/multisig) you define, **or**  
   - **`claimer`** is **`vault_signer`** and the function is callable from a **friend / same-package** integration you approve?

3. If you already support a **different pattern** (e.g. registration linking an EOA to the vault, sponsored tx, object-as-sender, batch entry, etc.), could you point us to **docs or example txs** for **object-based vaults**?

4. If no near-term API change is possible, what is your **recommended operational workaround** for protocols like ours (if any)?

We’re happy to share our vault address, pool address, and sample view results if that helps you confirm the `user` model.

Thanks,  
[Name / project / contact]

---

## Optional on-chain references (fill before sending)

| Item | Value |
|------|--------|
| YAB vault package | `Move.toml` / published address |
| Vault object | From deployment / `docs/MAINNET.md` |
| Hyperion DEX package | `[addresses].dex_contract` in `Move.toml` |
| Campaign reward module | `0xbefca24468c1cce695166e97c90adbd9fc07e4889e6dd1c647bed4bc237e1736` |

Related internal doc: operator summary — `docs/MAINNET.md` (section *Hyperion campaign rewards (no on-chain vault ingest yet)*).
