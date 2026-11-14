---
name: cc-vrf
description: Add Collector Crypt VRF — permissionless, verifiable randomness for Solana — to a project. Commit one Merkle root per batch of results (one ~0.00001 SOL transaction for up to 1,048,576 results), or one commit per result. Use for dice rolls, loot and gacha draws, NFT trait assignment, lotteries, validator selection, or any randomness that consumers must be able to verify after the fact.
license: MIT
---

# cc-vrf · Verifiable Random Function for Solana

## What it is

**cc-vrf** is a standalone VRF system on Solana. An operator runs RFC 9381 ECVRF (Ed25519, SHA-512, TAI) off-chain. An Anchor program registers and freezes the operator's public key on-chain, then records commitments to the operator's results, so anyone can check any past result against a key that can never change.

- **Batch commits**: one transaction commits a Merkle root over any number of results (1 to 1,048,576). Cost is per batch, not per result.
- **Per-result commits**: one transaction per result, as a compressed account (readable on-chain) or a log event.
- **Permissionless**: no oracle network, no token, no subscription. Anyone can register an authority.
- **Verifiable by anyone**: fetch the frozen authority and the commit, take the operator-published proof, and run the SDK's end-to-end verifier.
- **No on-chain ECVRF**: the program stores hashes and roots; the randomness is computed and verified off-chain (or in your program, with `crates/cc-vrf-verify`).

## When to use it

- You need verifiable randomness on Solana, at any volume, cheaply.
- You run the operator (your backend, an enclave, an MPC group) and want users, partners or auditors to be able to check any past draw.
- You want the result immediately: the operator proves at request time and hands back `proof` + `beta` at once; the commit follows.

## When NOT to use it

- You want randomness with no off-chain operator at all. cc-vrf trusts the operator to produce proofs; the commits make any substitution detectable, but an operator could withhold a result (a liveness failure consumers can flag). Use a threshold/MPC ECVRF setup if you need more.
- You're on EVM only. cc-vrf commits on Solana (an EVM app can still use it: commit on Solana, verify anywhere).
- You need one randomness beacon shared by many unrelated apps. The model is one operator per app, or one operator as a service.

## Pick a commit mode

| Mode | Instruction | On-chain | Cost | Use when |
|---|---|---|---|---|
| **Batch, event** | `commit_batch_event` | one `VrfBatchCommitted` event per batch | ~6,500–8,000 lamports per batch | high volume, verification off-chain (most apps) |
| **Batch, ring** | `commit_batch_ring` | the event + the root in a 128-entry ring account | same per batch, plus ~0.038 SOL ring rent once | another program must read the root on-chain |
| Per result, event | `commit_proof_event` | one `VrfProofCommitted` event per result | ~6,400–7,500 lamports per result | low volume, one result per transaction |
| Per result, registry | `commit_proof` / `commit_proof_with_beta` | one compressed account per result | ~22,500 lamports per result | another program must read one result (`beta`) on-chain |

For the Collector Crypt gacha (~64k results/day across Solana, EVM and partner rails), one batch every 5 minutes takes commits from ~0.79 SOL/day (per pack) to ~0.002 SOL/day.

## Availability

- **Program**: `ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ`, the same ID on devnet and mainnet. Upgrades go through the Squads vault `2Ef85QR7xrGJPdSvFcDz6X9ctqUoSptpi4vsnejpPAZQ`.
- **v2** (batch commits, the root ring, `attest_possession`; `revoke_authority` removed) is **live on devnet**. Mainnet is being upgraded; until then mainnet has the per-result instructions only. Build and test on devnet now: the batch format is final.
- **SDK**: `@collectorcrypt/vrf-client` 0.2.0 has the v2 API. Until the mainnet upgrade it's on the `next` tag (`latest` is 0.1.5, per-result only).

## Architecture

Accounts and events:

| Item | Seeds | Purpose |
|---|---|---|
| `VrfAuthority` (compressed) | `["vrf_authority", owner, label]` | The operator's public key + suite + frozen flag. One owner can hold many authorities by varying `label`. |
| `VrfProofCommit` (compressed) | `["vrf_proof", authority, memo_hash]` | Per-result commitment: `sha256(proof)`, `sha256(alpha)`, `sha256(memo)`, slot. One per memo, by construction. |
| `VrfProofCommitWithBeta` (compressed) | `["vrf_proof", authority, memo_hash]` | Same namespace, plus the 64-byte `beta` for on-chain consumers. |
| `VrfProofCommitted` | event | Per-result commitment in the transaction logs. |
| `VrfBatchCommitted` | event | `{owner, label, root, count, leaf_version, ring_seq, committed_slot}`: one Merkle root over many results. |
| `VrfRootRing` (account) | `["root_ring", authority]` | The last 128 batch roots, for programs that settle on-chain. |
| `VrfPossession` (account) | `["vrf_pop", authority]` | Exists iff the VRF key signed the possession message (`attest_possession`, opt-in). |

Nine instructions: `init_authority`, `freeze_authority`, `commit_proof`, `commit_proof_with_beta`, `commit_proof_event`, `commit_batch_event`, `init_root_ring`, `commit_batch_ring`, `attest_possession`. There is no revoke: a frozen authority can't be changed or shut off. (The `revoked` flag only remains for authorities revoked before v2; it never invalidates a commit.)

### Batch format (v1, final)

```text
leaf = SHA-256(0x00 ‖ "ccvrf-batch-v1" ‖ SHA-256(memo) ‖ SHA-256(alpha) ‖ SHA-256(proof) ‖ beta)
node = SHA-256(0x01 ‖ left ‖ right)
root = RFC 9162 Merkle tree hash over the leaves in index order
```

`memo` as UTF-8, `alpha` 32 bytes, `proof` the 80-byte ECVRF proof, `beta` the 64-byte output. A result's inclusion path is its RFC 9162 §2.1.3.2 path, leaf level first. `count` comes from the on-chain commit. `leaf_version` is `1`; a different leaf would get a new version.

## Add to your project

### 1. Install

```bash
pnpm add @collectorcrypt/vrf-client@next @lightprotocol/stateless.js \
        @coral-xyz/anchor @solana/web3.js @noble/hashes
```

`@collectorcrypt/vrf-client` re-exports the ECVRF functions from `@collectorcrypt/ecvrf` (`proveVRF`, `verifyVRF`, `vrfProofToHash`, `generateKeyPair`, `publicKeyFromSeed`).

### 2. Pick an RPC

You need a Solana RPC that **also serves the ZK Compression API (Light Photon)**, the compressed-account indexer: Helius and Triton do, on every cluster. The public `api.*.solana.com` endpoints don't, and `getValidityProofV0` fails there.

```ts
import { createRpc } from "@lightprotocol/stateless.js";
const rpc = createRpc(HELIUS_URL, HELIUS_URL); // one URL serves both
```

Verifying old batch events also needs an RPC that serves historical transactions.

### 3. Operator setup (once per `(owner, label)`)

```ts
import * as anchor from "@coral-xyz/anchor";
import { Transaction } from "@solana/web3.js";
import {
  generateKeyPair, getProgram, buildInitAuthorityIx, buildFreezeAuthorityIx, SUITE_EDWARDS25519_SHA512_TAI,
} from "@collectorcrypt/vrf-client";

// The VRF key. Keep the secret in a secret store (env var, KMS, enclave).
const { sk, pk } = generateKeyPair();

const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
const program = getProgram(provider);

// Register the public key, then freeze it. Freezing is one-way, and every commit requires it.
const { ix, authorityAddress } = await buildInitAuthorityIx(program, rpc, {
  owner: wallet.publicKey, pk, suite: SUITE_EDWARDS25519_SHA512_TAI, label: "my-app",
});
await provider.sendAndConfirm(new Transaction().add(ix), []);
const freeze = await buildFreezeAuthorityIx(program, rpc, { owner: wallet.publicKey, label: "my-app" });
await provider.sendAndConfirm(new Transaction().add(freeze), []);
```

Optional, once: prove publicly that you hold the VRF key. The SDK signs only the exact 114-byte possession message. Never sign anything else with the VRF key: ECVRF and Ed25519 share the nonce derivation.

```ts
import { buildAttestPossessionIxs, fetchPossession } from "@collectorcrypt/vrf-client";

const { ixs } = await buildAttestPossessionIxs(program, rpc, { owner: wallet.publicKey, label: "my-app", vrfSecretKey: sk });
await provider.sendAndConfirm(new Transaction().add(...ixs), []);
const pop = await fetchPossession(connection, authorityAddress); // { address, pk, slot } once attested
```

### 4. Prove at request time, commit in batches (recommended)

Prove each request as it arrives and return the result immediately. Commit everything since the last batch on a timer (every few minutes, or every N results).

```ts
import { sha256 } from "@noble/hashes/sha2.js";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import {
  proveVRF, vrfProofToHash, bytesToHex, batchLeafV1, buildBatch, buildCommitBatchEventIx,
} from "@collectorcrypt/vrf-client";

// At request time: alpha binds the draw. Use a unique memo per request (request id, order id…).
function prove(memo: string) {
  const alpha = sha256(new TextEncoder().encode(memo));
  const { proof } = proveVRF(sk, alpha);   // 80 bytes
  const beta = vrfProofToHash(proof);      // 64 bytes: the random output
  return { memo, alpha, proof, beta };     // return beta (and proof) to the caller now
}

// On a timer: one root over everything proved since the last batch.
async function commitBatch(results: ReturnType<typeof prove>[]) {
  const batch = buildBatch(results.map((r) => batchLeafV1(r)));
  const ix = await buildCommitBatchEventIx(program, rpc, {
    owner: wallet.publicKey, label: "my-app", root: batch.root, count: batch.count,
  });
  // An authority older than a few hours proves through ZK (~121k CU); a fresh one ~24k.
  const tx = new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }), ix);
  const signature = await provider.sendAndConfirm(tx, []);
  // Store, per result: the batch signature, its index, and its path. Callers need all three to verify.
  return results.map((r, i) => ({
    memo: r.memo, alpha: bytesToHex(r.alpha), proof: bytesToHex(r.proof), beta: bytesToHex(r.beta),
    signature, index: i, count: batch.count, path: batch.path(i).map(bytesToHex),
  }));
}

// Map beta to your outcome, e.g. a roll in 1..100:
const roll = (beta: Uint8Array) => Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1;
```

Persist each result before you broadcast the batch (signature, index, path), so a crash between sending and recording never leaves a landed root you can't serve paths for. Publishing every leaf of a batch (for example at `/batch/<signature>`) lets anyone rebuild the whole root without you.

### 5. Verify a batched result (anyone)

```ts
import { PublicKey } from "@solana/web3.js";
import {
  encodeLabel, fetchAuthority, findBatchCommits, hexToBytes, verifyBatchCommitEndToEnd,
} from "@collectorcrypt/vrf-client";

// r = what the operator published for one result: memo, alpha, proof, signature, index, path (+ root).
const owner = new PublicKey(OPERATOR_OWNER);
const { commits } = await findBatchCommits(program, connection, r.signature);
// One transaction may hold several roots: use the one this result's path proves into.
const auth = await fetchAuthority(program, rpc, owner, "my-app");
const tries = commits
  .filter((c) => c.owner.equals(owner))
  .map((batch) => verifyBatchCommitEndToEnd({
    authority: auth!.onChainAuthority, batch, memo: r.memo,
    alpha: hexToBytes(r.alpha), proof: hexToBytes(r.proof),
    index: r.index, path: r.path.map((h: string) => hexToBytes(h)),
    expectedOwner: owner, expectedLabel: encodeLabel("my-app"),
  }));
const result = tries.find((t) => t.leafInBatch) ?? tries[0];
// result.valid: ECVRF valid, leaf in the committed root (with the on-chain count), authority frozen, owner and label match.
```

`verifyBatchPath` checks a leaf against a root and count without any RPC; `batchLeafV1` rebuilds a leaf from its four fields.

### 6. Settle on-chain with the ring (only if a program must read the root)

```ts
import { buildInitRootRingIx, buildCommitBatchRingIx, fetchRootRing, rootRingEntry } from "@collectorcrypt/vrf-client";

const { ix: init } = await buildInitRootRingIx(program, rpc, { owner: wallet.publicKey, label: "my-app" }); // once, ~0.038 SOL rent
await provider.sendAndConfirm(new Transaction().add(init), []);

const { ix, seq } = await buildCommitBatchRingIx(program, rpc, {
  owner: wallet.publicKey, label: "my-app", root: batch.root, count: batch.count,
}); // expectedSeq is read from the ring, so a retried send can't insert twice
await provider.sendAndConfirm(new Transaction().add(ComputeBudgetProgram.setComputeUnitLimit({ units: 150_000 }), ix), []);

const ring = await fetchRootRing(connection, authorityAddress);
const entry = rootRingEntry(ring!.data, seq); // { seq, slot, root, count, leafVersion }, or null once evicted
```

In your program, read the ring account and call `cc_vrf_verify::verify_leaf_v1` (Rust crate `crates/cc-vrf-verify`, no CPI) with the result's fields, index and path. The ring keeps 128 roots: settle (or copy the entry) before 128 newer batches evict it, pin the authority and ring addresses, recompute `alpha` from your own inputs, and record each settled `alpha_hash` so a result can't settle twice.

### Per-result commits (simplest, one transaction each)

```ts
import { buildCommitProofIx } from "@collectorcrypt/vrf-client"; // or buildCommitProofEventIx, buildCommitProofWithBetaIx

const { ix, commitAddress } = await buildCommitProofIx(program, rpc, { owner: wallet.publicKey, label: "my-app", memo, alpha, proof });
await provider.sendAndConfirm(new Transaction().add(ix), []);
// verify: fetchProofCommit + verifyAuthorityCommitEndToEnd; for events: findProofCommitEvents + pickCanonicalCommit
```

## Trust model

- Trust the operator who registered and froze the key to produce a proof for every request. ECVRF allows exactly one valid output per `(key, alpha)`, so the operator can't choose a result; it could only withhold one.
- Commits make substitution detectable: a different proof or result for a committed request no longer matches the committed hashes or root.
- Withholding is visible: a request with no commit after the operator's batch interval is a liveness failure your app can refund or flag.
- The program doesn't custody keys or run ECVRF. A frozen authority can't be revoked, so its history can't be hidden.

## Common pitfalls

- **Batch `count` from the commit, never from the caller.** One path shape fits several tree sizes; the end-to-end verifier takes `count` from the event.
- **Rebuild the leaf from its fields.** Never accept a bare 32-byte leaf from anyone.
- **Several roots in one transaction.** `findBatchCommits` returns all of them; verify against the one the path proves into.
- **Compute budget.** Aged authorities prove through ZK: ~121k CU for a batch commit, ~131k for `attest_possession`. Set a limit of ~150k.
- **`getValidityProofV0` fails**: your RPC doesn't serve the ZK Compression API. Use Helius or Triton.
- **Old batches not found**: the event is in the transaction, not an account; use an RPC with transaction history.
- **`Blockhash invalid` from wallet adapters**: the wallet's preflight RPC lags. Fetch a `finalized` blockhash before signing.
- **`Buffer is not defined` in the browser**: install `buffer` and set `globalThis.Buffer = Buffer`.
- **Authority already exists**: `init_authority` for an existing `(owner, label)` fails. Use a new label or the existing authority.
- **Memo reuse (per-result modes)**: the commit's address includes `sha256(memo)`, so a second commit for a memo fails. Use unique memos; that's the replay protection.

## Reference

- **Program ID:** `ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ` (devnet + mainnet; v2 on devnet, mainnet upgrade in progress)
- **Browse operators:** https://vrf.collectorcrypt.com/#/lookup
- **Verify a result:** https://vrf.collectorcrypt.com/#/verify (`mode=batch` with `sig`, `index`, `path`)
- **Source:** https://github.com/collectorcrypt/cc-vrf (program, SDK, `crates/cc-vrf-verify`, dice demo)
- **An integration:** the Collector Crypt gacha commits every pack in 5-minute batches (devnet now, mainnet at the upgrade): https://docs.collectorcrypt.com/gacha/vrf#checking-a-batched-pack
- **Spec:** RFC 9381 §5.5 (ECVRF-EDWARDS25519-SHA512-TAI, suite `0x03`); RFC 9162 §2.1 (Merkle tree hash, inclusion paths)
- **Compressed accounts:** Light Protocol v2 (`@lightprotocol/stateless.js` 0.23.x)
- **Tests:** 68 ECVRF tests (byte-exact vs the Rust reference), 57 SDK tests, 23 on-chain integration suites, and a 117-case adversarial suite run on devnet.

## Cost reference (devnet, 2026-11-13)

| | Per transaction | Per result |
|---|---|---|
| Batch commit (event), 1,000 results | ~8,000 lamports (5,000 base + priority) | ~8 lamports |
| Batch commit (ring) | same | same, after ~0.038 SOL ring rent once |
| Per-result event | ~6,400–7,500 lamports | ~6,400–7,500 lamports |
| Per-result registry (+ beta) | ~22,500 lamports (includes the compressed-account fee) | ~22,500 lamports |
| `attest_possession` (once) | fee + ~0.0011 SOL possession-account rent | — |

Run `pnpm cc-vrf-demo cost <N>` to measure against your own RPC and priority fee.
