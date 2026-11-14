# @collectorcrypt/vrf-client

TypeScript SDK for the **cc-vrf** on-chain verifiable-random-function program on Solana. It wraps the Anchor IDL, all of the Light Protocol compressed-PDA plumbing (validity proofs, packed accounts, address-tree-v2), event-log scanning, and the RFC 9381 ECVRF math — so you can register a VRF key, commit proofs, and verify outcomes end-to-end with a single import.

cc-vrf is a permissionless, standalone VRF system. The program is live on **devnet + mainnet** at `ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ`. It registers operator public keys on-chain, freezes them, and accepts cheap proof commitments; the actual ECVRF evaluation happens off-chain (each operator runs their own [`@collectorcrypt/ecvrf`](https://www.npmjs.com/package/@collectorcrypt/ecvrf)), and anyone can verify a committed outcome against the chain. See the [cc-vrf monorepo](https://github.com/collectorcrypt/cc-vrf) for the full architecture, security model, and cost comparison.

## What it does

- **Register & lock keys.** Build the `init_authority` / `freeze_authority` instructions, and optionally `attest_possession` (proof that the operator holds the VRF key). An authority binds one `(owner, label, pk, suite)` tuple; freezing makes the key permanent.
- **Commit proofs in three per-call modes.** `commit_proof` (compressed-PDA registry), `commit_proof_with_beta` (registry + the 64-byte VRF output stored on-chain for cross-program reads), and `commit_proof_event` (no PDA — just a verified log event, ~3× cheaper).
- **Commit many proofs at once.** Batch mode builds one Merkle tree over many VRF results and commits its root: `commit_batch_event` (a log event) or `commit_batch_ring` (also kept in the authority's root ring, which other programs can read).
- **Fetch & decode** authorities, commits, with-beta commits, event-mode commitments (by known signature, or by paginated wallet-history scanning over a plain RPC), batch commits, root rings, and possession attestations.
- **Verify end-to-end.** `verifyEndToEnd` and `verifyAuthorityCommitEndToEnd` check the ECVRF math, the on-chain proof/alpha/memo hashes, the authority lifecycle (frozen, owner/label), the commit→authority binding, and optionally the on-chain beta — in one synchronous call. `verifyBatchCommitEndToEnd` does the same for one result in a batch. `pickCanonicalCommit` resolves duplicate event-mode commits. A revoked flag is reported in `notes` and never invalidates a commit.
- **Re-exports the ECVRF primitives** (including `vrfStream`) so you don't need a second import to produce or verify proofs.

## Install

```bash
npm install @collectorcrypt/vrf-client
# or: pnpm add @collectorcrypt/vrf-client  /  yarn add @collectorcrypt/vrf-client
```

Pulls in `@coral-xyz/anchor` (^0.32), `@solana/web3.js` (^1.98), `@lightprotocol/stateless.js` (^0.23), and `@collectorcrypt/ecvrf`. ESM + TypeScript types included; the program IDL is vendored, so the SDK is browser-safe.

> **RPC requirement.** Creating and reading compressed accounts needs a **Photon-capable** Solana RPC (e.g. a Helius dev plan). Pure verification and event-log scanning work against any standard RPC.

## Quick start — full lifecycle

```ts
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { createRpc } from "@lightprotocol/stateless.js";
import {
  getProgram,
  generateKeyPair,
  proveVRF,
  vrfProofToHash,
  SUITE_EDWARDS25519_SHA512_TAI,
  buildInitAuthorityIx,
  buildFreezeAuthorityIx,
  buildCommitProofIx,
  fetchAuthority,
  fetchProofCommit,
  verifyAuthorityCommitEndToEnd,
  asTx,
} from "@collectorcrypt/vrf-client";

// Photon-capable RPC + an Anchor provider whose wallet is the operator/owner.
const rpc = createRpc(RPC_URL); // e.g. https://devnet.helius-rpc.com/?api-key=...
const wallet = new Wallet(payerKeypair);
const provider = new AnchorProvider(rpc, wallet, { commitment: "confirmed" });
const program = getProgram(provider);

// 1. Operator: generate a VRF keypair and register the public key as an authority.
const { sk, pk } = generateKeyPair();
const label = "gacha";
const { ix: initIx } = await buildInitAuthorityIx(program, rpc, {
  owner: wallet.publicKey,
  pk,
  suite: SUITE_EDWARDS25519_SHA512_TAI,
  label,
});
await provider.sendAndConfirm(asTx(initIx));

// 2. Freeze it — one-way. The pk and suite are now permanent; commits are only accepted after this.
const freezeIx = await buildFreezeAuthorityIx(program, rpc, { owner: wallet.publicKey, label });
await provider.sendAndConfirm(asTx(freezeIx));

// 3. Per VRF call: evaluate off-chain, then commit the hashes on-chain.
const memo = "draw:user-123:2026-06-19";        // unique per call; user-chosen is ideal
const alpha = new TextEncoder().encode(memo);
const { proof } = proveVRF(sk, alpha);            // 80-byte ECVRF proof
const { ix: commitIx } = await buildCommitProofIx(program, rpc, {
  owner: wallet.publicKey,
  label,
  memo,
  alpha,
  proof,
});
await provider.sendAndConfirm(asTx(commitIx));

// 4. Any verifier: pull the on-chain authority + commit and verify the whole story.
const auth = await fetchAuthority(program, rpc, wallet.publicKey, label);
const commit = await fetchProofCommit(program, rpc, auth!.authorityAddress, memo);
const result = verifyAuthorityCommitEndToEnd({
  authority: auth!.onChainAuthority,
  onChainCommit: commit!.onChainCommit,
  alpha,
  proof,
  memo,
  expectedOwner: wallet.publicKey,
});
console.log(result.valid);   // true — ECVRF + on-chain hashes + frozen authority all check out
console.log(result.reasons); // [] (populated with specific failure codes when invalid)

// 5. Derive the random value(s) from the verified proof.
const beta = vrfProofToHash(proof); // 64-byte canonical output; feed to vrfStream() for typed values
```

The `build*Ix` helpers **build** instructions (verifying the proof against the authority pk first) but never sign or send — you submit them with your own provider/wallet, so the SDK stays agnostic about transaction assembly, priority fees, and signing.

## Commit modes

| | `commit_proof` (registry) | `commit_proof_with_beta` | `commit_proof_event` | `commit_batch_event` / `commit_batch_ring` |
|---|---|---|---|---|
| Builder | `buildCommitProofIx` | `buildCommitProofWithBetaIx` | `buildCommitProofEventIx` | `buildCommitBatchEventIx` / `buildCommitBatchRingIx` |
| Storage | compressed PDA | compressed PDA + 64-byte beta | Solana log event (no PDA) | one log event per Merkle root (ring: also the last 128 roots in an account) |
| Other programs read the value | hash only | **yes** (via Light SDK CPI) | only via same-tx CPI | ring: **yes** (root + count in a regular account) |
| Chain-enforced one-commit-per-memo | yes | yes (shares the registry address) | **no** — verifier-side | **no** — verifier-side |
| Relative per-call cost | baseline | ~same as baseline | ~3× cheaper | one event-sized transaction per root, shared by every call in it |
| Fetch with | `fetchProofCommit` | `fetchProofCommitWithBeta` | `findProofCommitEvents` + `pickCanonicalCommit` | `findBatchCommits(signature)` |

`commit_proof` and `commit_proof_with_beta` share the same compressed-PDA address namespace, so a given `(authority, memo)` can use **one or the other**, not both. `buildCommitProofWithBetaIx` takes an extra `beta` field and asserts `beta === vrfProofToHash(proof)`.

### Event mode and duplicate resolution

Event mode skips the per-call PDA, so the chain does **not** enforce one commit per memo — `findProofCommitEvents` can return more than one row for the same `(owner, label, memo)`. ECVRF output is unique for a fixed `(pk, alpha)`: every proof that verifies yields the same beta, so extra events cannot change the result. Keep the candidate whose `proofHash` matches the proof you hold, then verify it:

```ts
import {
  findProofCommitEvents,
  pickCanonicalCommit,
  verifyAuthorityCommitEndToEnd,
} from "@collectorcrypt/vrf-client";

// Event lookup only needs a plain Connection (provider.connection works). Pass the commit's signature when you
// have it; without one, the owner's wallet history is scanned and `truncated` says whether the scan was complete.
const { events } = await findProofCommitEvents(program, provider.connection, owner, label, memo, { signature });
const { canonical, duplicateMemoEvents } = pickCanonicalCommit(
  events.map((e) => e.onChainCommit),
  proof,
);
if (!canonical) throw new Error("no event matches a verifying proof");

const result = verifyAuthorityCommitEndToEnd({
  authority: auth!.onChainAuthority,
  onChainCommit: canonical,
  alpha,
  proof,
  memo,
  expectedOwner: owner,
});
```

A naive verifier that just "picks the latest event" without running ECVRF can be misled — `pickCanonicalCommit` + `verifyAuthorityCommitEndToEnd` close that gap and keep event mode as cryptographically sound as registry mode.

### Batch mode

One commit covers many VRF results: hash each result into a batch spec v1 leaf, build the RFC 9162 tree, and commit its root and leaf count. Publish each result with its index, its path, and the commit signature.

```ts
import {
  batchLeafV1,
  buildBatch,
  buildCommitBatchEventIx,
  findBatchCommits,
  fetchAuthority,
  proveVRF,
  verifyBatchCommitEndToEnd,
  vrfProofToHash,
  asTx,
} from "@collectorcrypt/vrf-client";

// Operator: prove each call, build one tree, commit its root.
const results = memos.map((memo) => {
  const alpha = new TextEncoder().encode(memo);
  const { proof } = proveVRF(sk, alpha);
  return { memo, alpha, proof, beta: vrfProofToHash(proof) };
});
const batch = buildBatch(results.map((r) => batchLeafV1(r)));
const ix = await buildCommitBatchEventIx(program, rpc, {
  owner: wallet.publicKey,
  label,
  root: batch.root,
  count: batch.count,
});
const signature = await provider.sendAndConfirm(asTx(ix));
// Publish per result: memo, alpha, proof, index, batch.path(index), signature.

// Verifier: the root and count come from the chain, never from the publisher.
const { commits } = await findBatchCommits(program, provider.connection, signature);
const auth = await fetchAuthority(program, rpc, commits[0].owner, commits[0].label);
const result = verifyBatchCommitEndToEnd({
  authority: auth!.onChainAuthority,
  batch: commits[0],
  memo,
  alpha,
  proof,
  index,
  path,
  expectedOwner: wallet.publicKey,
});
console.log(result.valid, result.reasons);
```

The verifier rebuilds the leaf from the result (beta is recomputed from the proof) and checks the path against the committed `count`. A path alone does not fix the count: one path verifies under every count that gives the tree the same shape, so never take the count from the publisher. `crates/cc-vrf-verify` is the Rust equivalent for on-chain consumers; both check the same vector file.

**Root ring.** Run `buildInitRootRingIx` once (a 7,352-byte account, rent ≈ 0.038 SOL), then commit with `buildCommitBatchRingIx`, which writes the root to `entries[seq % 128]` at the ring's `next_seq`. A retried transaction with the same `expectedSeq` is refused, so a root is never inserted twice. `fetchRootRing` + `rootRingEntry(data, seq)` read an entry while it is live; commit `seq + 128` overwrites it.

**Key possession.** `buildAttestPossessionIxs` returns two instructions (Ed25519 precompile, then `attest_possession`) to send in one transaction. The VRF key signs the 114-byte message `"ccvrf-authority-v1" ‖ program_id ‖ owner ‖ label`. ECVRF and Ed25519 derive their nonces from the same half of `SHA-512(sk)`, so the VRF key must never Ed25519-sign anything else; `signPossessionMessage` refuses any other message. `fetchPossession` returns the recorded attestation, or null.

## API reference

### Program handle

- `getProgram(provider: AnchorProvider): Program` — build an Anchor `Program` for cc-vrf from a provider (the provider's wallet signs state-mutating instructions). The IDL is vendored into the package.

### Constants

- `CC_VRF_PROGRAM_ID: PublicKey` — canonical mainnet/devnet program ID. Pass a `programId` override to the address/verify helpers for forked deployments.
- `SUITE_EDWARDS25519_SHA512_TAI: number` — `0x03`, the only supported suite.
- `BATCH_LEAF_VERSION` (1), `MAX_BATCH_COUNT` (2^20) — batch spec v1 and the largest `count` the program accepts.
- `ROOT_RING_SEED`, `RING_CAPACITY` (128), `RING_ACCOUNT_LEN` (7,352), `RING_DISCRIMINATOR` — root ring layout.
- `POSSESSION_DOMAIN` (`"ccvrf-authority-v1"`), `POSSESSION_MESSAGE_LEN` (114), `POSSESSION_DISCRIMINATOR` — possession message and account.

### Instruction builders (async; need a Photon-capable `Rpc`)

| Builder | Returns | Notes |
|---|---|---|
| `buildInitAuthorityIx(program, rpc, input)` | `{ ix, authorityAddress }` | `input: InitAuthorityInput` (`owner`, `pk` 32 bytes, `suite`, `label`). |
| `buildFreezeAuthorityIx(program, rpc, input)` | `ix` | `input: FreezeAuthorityInput` (`owner`, `label`). One-way. |
| `buildCommitProofIx(program, rpc, input)` | `{ ix, commitAddress }` | `input: CommitProofInput` (`owner`, `label`, `memo`, `alpha`, `proof` 80 bytes). Verifies the proof before building. |
| `buildCommitProofWithBetaIx(program, rpc, input)` | `{ ix, commitAddress }` | `CommitProofInput & { beta: Uint8Array }` (64 bytes; must equal `vrfProofToHash(proof)`). |
| `buildCommitProofEventIx(program, rpc, input)` | `ix` | `CommitProofInput`. Emits a `VrfProofCommitted` log instead of a PDA. |
| `buildCommitBatchEventIx(program, rpc, input)` | `ix` | `input: CommitBatchInput` (`owner`, `label`, `root` 32 non-zero bytes, `count` 1..2^20, optional `leafVersion` = 1). Emits a `VrfBatchCommitted` log. |
| `buildInitRootRingIx(program, rpc, input)` | `{ ix, ringAddress }` | `{ owner, label }`. Creates the root ring; once per authority. |
| `buildCommitBatchRingIx(program, rpc, input)` | `{ ix, ringAddress, seq }` | `CommitBatchInput & { expectedSeq?: bigint }` (default: the ring's `next_seq`). |
| `buildAttestPossessionIxs(program, rpc, input)` | `{ ixs, attestationAddress }` | `{ owner, label, vrfSecretKey?, signature? }`: the VRF secret key, or a signature made elsewhere (an HSM) over `possessionMessage`. Send `ixs` in order, in one transaction. |

`label` and `memo` accept a `string` (UTF-8) or `Uint8Array`; labels encode to exactly 32 bytes (`encodeLabel` right-pads). v2 removed `revoke_authority`, and with it `buildRevokeAuthorityIx`.

### Fetchers & decoders

- `fetchAuthority(program, rpc, owner, label)` → `{ authorityAddress, account, decoded, onChainAuthority } | null`
- `fetchProofCommit(program, rpc, authority, memo)` → `{ commitAddress, account, decoded, onChainCommit } | null`
- `fetchProofCommitWithBeta(program, rpc, authority, memo)` → `{ …, onChainCommit, beta } | null` (reassembles the 64-byte beta from its two halves)
- `findProofCommitEvents(program, connection, owner, label, memo, { signature?, limit? })` → `{ events, truncated, unfetchedSignatures }`. With `signature`, reads that one transaction (the reliable path for a committer). Without it, pages the owner's history up to `limit` (default 1000) signatures; `truncated` and `unfetchedSignatures` say when an empty result is not conclusive.
- `fetchProofCommitEvents(program, connection, owner, label, memo, { signature?, limit? })` → `ProofCommitEvent[]` (oldest→newest; `findProofCommitEvents` without the completeness flags)
- `findBatchCommits(program, connection, signature)` → `{ commits: BatchCommit[], unfetched }` — the `VrfBatchCommitted` events of one successful transaction (falls back to decoding its instructions when the RPC returned no usable log)
- `fetchRootRing(connection, authorityAddress)` → `{ address, data, ring } | null`; `decodeRootRing(data)`; `rootRingEntry(data, seq)` → the live entry or null
- `fetchPossession(connection, authorityAddress)` → `{ address, authority, pk, slot } | null`
- `decodeAuthority` / `decodeProofCommit` / `decodeProofCommitWithBeta` `(program, dataBytes)` — low-level Borsh decoders.
- `decodeCcVrfTransaction(program, tx)` / `ownProgramDataLines(logs, programId)` — the events and instructions cc-vrf itself wrote in a transaction; `Program data:` lines printed by other programs are ignored.

### Verification (pure, synchronous — no RPC)

- `verifyEndToEnd(input: VerifyEndToEndInput): VerifyEndToEndResult` — checks ECVRF math + `sha256(proof|alpha|memo)` against the commit. `result.valid` is the AND of every check; `result.beta` is the 64-byte output when `ecvrfValid`; `result.reasons` lists failure codes.
- `verifyAuthorityCommitEndToEnd(input): VerifyAuthorityCommitEndToEndResult` — everything `verifyEndToEnd` does **plus** authority `frozen`, optional `expectedOwner`/`expectedLabel`, the commit→authority binding (always rederived from `(owner, label)`), and an optional `onChainBeta` match. A revoked authority is reported in `notes` (`authority-revoked`) and does not change `valid`. Use this for any real verification.
- `verifyBatchCommitEndToEnd(input): VerifyBatchCommitResult` — one result in a batch: ECVRF math, the rebuilt leaf against the committed root and count, the leaf version, authority `frozen`, the batch→authority binding, optional `expectedOwner`/`expectedLabel`.
- `pickCanonicalCommit(candidates: OnChainCommit[], proof): PickCanonicalResult` — returns the unique candidate whose `proofHash` matches the given proof (`canonical`), plus `duplicateMemoEvents` / `multipleVerifying` flags.

### Batch helpers (pure)

- `batchLeafV1({ memo, alpha, proof, beta })` — the v1 leaf. `batchLeafFromPack({ memo, alphaHex, proofHex, betaHex? })` builds it from hex fields, recomputing beta from the proof (throws if a stored beta disagrees).
- `buildBatch(leaves)` → `{ root, count, path(index) }`; `batchNode(left, right)`.
- `verifyBatchPath({ root, count, index, fields, path })` rebuilds the leaf and checks inclusion; `verifyInclusion(root, count, index, leaf, path)` is the bare RFC 9162 §2.1.3.2 check.

### Address & hashing helpers (pure)

- `deriveAuthorityAddress(owner, label, programId)` — compressed-PDA address; seeds `["vrf_authority", owner, label]` (label must be 32 bytes).
- `deriveProofCommitAddress(authority, memoHash, programId)` / `deriveProofCommitWithBetaAddress(...)` — seeds `["vrf_proof", authority, memoHash]` (shared namespace).
- `deriveRootRingAddress(authority, programId?)` — `["root_ring", authority]`; `derivePossessionAddress(authority, programId?)` — `["vrf_pop", authority]` (regular PDAs).
- `possessionMessage(owner, label, programId?)` — the 114-byte message; `signPossessionMessage(vrfSecretKey, message)` signs it and nothing else.
- `memoHash(memo)` / `alphaHash(alpha)` / `proofHash(proof)` — SHA-256 convenience wrappers.
- `encodeLabel(label: string): Uint8Array` — UTF-8, right-padded to 32 bytes (throws if >32 bytes encoded).

### Light Protocol context builders (advanced)

`forceLightV2`, `buildCreateContext`, `buildCommitProofContext`, `buildReadOnlyAuthorityContext`, `buildMutateContext` — assemble the validity-proof bundle + packed remaining-accounts the program expects. The `build*Ix` helpers use these internally; reach for them directly only when composing custom transactions.

### Re-exported from `@collectorcrypt/ecvrf`

`generateKeyPair`, `publicKeyFromSeed`, `proveVRF`, `verifyVRF`, `vrfProofToHash`, `vrfStream`, `bytesToHex`, `hexToBytes` — so producing and verifying proofs needs only this one package.

### Exported types

`InitAuthorityInput`, `FreezeAuthorityInput`, `CommitProofInput`, `ProofCommitEvent`, `ProofCommitEventQuery`, `ProofCommitEventResult`, `OnChainAuthority`, `OnChainCommit`, `VerifyEndToEndInput`, `VerifyEndToEndResult`, `VerifyAuthorityCommitEndToEndInput`, `VerifyAuthorityCommitEndToEndResult`, `PickCanonicalResult`, `Batch`, `BatchCommit`, `BatchLeafFields`, `CommitBatchInput`, `VerifyBatchCommitInput`, `VerifyBatchCommitResult`, `RootRing`, `RootRingEntry`, `DecodedEvent`, `DecodedInstruction`, `VrfStream`.

## Trust model

The program registers public keys, marks them ready (`freeze`), and stores proof-hash commitments and batch roots — it does **not** custody keys, evaluate randomness, or run ECVRF on-chain (no Solana program can verify an RFC 9381 ECVRF proof in a single tx today). You trust the operator who froze the key to evaluate the VRF honestly; the on-chain commitments make any after-the-fact proof substitution detectable, and `verifyAuthorityCommitEndToEnd` / `verifyBatchCommitEndToEnd` make that detection one function call. Full discussion in the [monorepo README](https://github.com/collectorcrypt/cc-vrf).

## Related

- [`@collectorcrypt/ecvrf`](https://www.npmjs.com/package/@collectorcrypt/ecvrf) — the underlying RFC 9381 ECVRF library + stream expander.
- [cc-vrf monorepo](https://github.com/collectorcrypt/cc-vrf) — program, CLI demo, security model, and measured costs.

## License

MIT.
