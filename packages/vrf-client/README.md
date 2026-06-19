# @collectorcrypt/vrf-client

TypeScript SDK for the **cc-vrf** on-chain verifiable-random-function program on Solana. It wraps the Anchor IDL, all of the Light Protocol compressed-PDA plumbing (validity proofs, packed accounts, address-tree-v2), event-log scanning, and the RFC 9381 ECVRF math — so you can register a VRF key, commit proofs, and verify outcomes end-to-end with a single import.

cc-vrf is a permissionless, standalone VRF system. The program is live on **devnet + mainnet** at `ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ`. It registers operator public keys on-chain, freezes them, and accepts cheap proof commitments; the actual ECVRF evaluation happens off-chain (each operator runs their own [`@collectorcrypt/ecvrf`](https://www.npmjs.com/package/@collectorcrypt/ecvrf)), and anyone can verify a committed outcome against the chain. See the [cc-vrf monorepo](https://github.com/collectorcrypt/cc-vrf) for the full architecture, security model, and cost comparison.

## What it does

- **Register & lock keys.** Build the `init_authority` / `freeze_authority` / `revoke_authority` instructions. An authority binds one `(owner, label, pk, suite)` tuple; freezing makes the key permanent.
- **Commit proofs in three modes.** `commit_proof` (compressed-PDA registry), `commit_proof_with_beta` (registry + the 64-byte VRF output stored on-chain for cross-program reads), and `commit_proof_event` (no PDA — just a verified log event, ~3× cheaper).
- **Fetch & decode** authorities, commits, with-beta commits, and event-mode commitments — including paginated event-log scanning over a plain RPC.
- **Verify end-to-end.** `verifyEndToEnd` and `verifyAuthorityCommitEndToEnd` check the ECVRF math, the on-chain proof/alpha/memo hashes, the authority lifecycle (frozen, not revoked, owner/label), the commit→authority binding, and optionally the on-chain beta — in one synchronous call. `pickCanonicalCommit` resolves duplicate event-mode commits.
- **Re-exports the ECVRF primitives** so you don't need a second import to produce or verify proofs.

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

| | `commit_proof` (registry) | `commit_proof_with_beta` | `commit_proof_event` |
|---|---|---|---|
| Builder | `buildCommitProofIx` | `buildCommitProofWithBetaIx` | `buildCommitProofEventIx` |
| Storage | compressed PDA | compressed PDA + 64-byte beta | Solana log event (no PDA) |
| Other programs read the value | hash only | **yes** (via Light SDK CPI) | only via same-tx CPI |
| Chain-enforced one-commit-per-memo | yes | yes (shares the registry address) | **no** — verifier-side |
| Relative per-call cost | baseline | ~same as baseline | ~3× cheaper |
| Fetch with | `fetchProofCommit` | `fetchProofCommitWithBeta` | `fetchProofCommitEvents` + `pickCanonicalCommit` |

`commit_proof` and `commit_proof_with_beta` share the same compressed-PDA address namespace, so a given `(authority, memo)` can use **one or the other**, not both. `buildCommitProofWithBetaIx` takes an extra `beta` field and asserts `beta === vrfProofToHash(proof)`.

### Event mode and duplicate resolution

Event mode skips the per-call PDA, so the chain does **not** enforce one commit per memo — `fetchProofCommitEvents` can return more than one row for the same `(owner, label, memo)`. Because ECVRF proofs are deterministic for a fixed `(pk, alpha)`, at most one candidate can carry a valid proof hash; the rest are detectable noise, not forgeries. Resolve them before verifying:

```ts
import {
  fetchProofCommitEvents,
  pickCanonicalCommit,
  verifyAuthorityCommitEndToEnd,
} from "@collectorcrypt/vrf-client";

// Event-log scanning only needs a plain Connection (provider.connection works).
const events = await fetchProofCommitEvents(program, provider.connection, owner, label, memo);
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

## API reference

### Program handle

- `getProgram(provider: AnchorProvider): Program` — build an Anchor `Program` for cc-vrf from a provider (the provider's wallet signs state-mutating instructions). The IDL is vendored into the package.

### Constants

- `CC_VRF_PROGRAM_ID: PublicKey` — canonical mainnet/devnet program ID. Pass a `programId` override to the address/verify helpers for forked deployments.
- `SUITE_EDWARDS25519_SHA512_TAI: number` — `0x03`, the only supported suite.

### Instruction builders (async; need a Photon-capable `Rpc`)

| Builder | Returns | Notes |
|---|---|---|
| `buildInitAuthorityIx(program, rpc, input)` | `{ ix, authorityAddress }` | `input: InitAuthorityInput` (`owner`, `pk` 32 bytes, `suite`, `label`). |
| `buildFreezeAuthorityIx(program, rpc, input)` | `ix` | `input: FreezeAuthorityInput` (`owner`, `label`). One-way. |
| `buildRevokeAuthorityIx(program, rpc, input)` | `ix` | Informational; historical proofs stay verifiable. |
| `buildCommitProofIx(program, rpc, input)` | `{ ix, commitAddress }` | `input: CommitProofInput` (`owner`, `label`, `memo`, `alpha`, `proof` 80 bytes). Verifies the proof before building. |
| `buildCommitProofWithBetaIx(program, rpc, input)` | `{ ix, commitAddress }` | `CommitProofInput & { beta: Uint8Array }` (64 bytes; must equal `vrfProofToHash(proof)`). |
| `buildCommitProofEventIx(program, rpc, input)` | `ix` | `CommitProofInput`. Emits a `VrfProofCommitted` log instead of a PDA. |

`label` and `memo` accept a `string` (UTF-8) or `Uint8Array`; labels encode to exactly 32 bytes (`encodeLabel` right-pads).

### Fetchers & decoders

- `fetchAuthority(program, rpc, owner, label)` → `{ authorityAddress, account, decoded, onChainAuthority } | null`
- `fetchProofCommit(program, rpc, authority, memo)` → `{ commitAddress, account, decoded, onChainCommit } | null`
- `fetchProofCommitWithBeta(program, rpc, authority, memo)` → `{ …, onChainCommit, beta } | null` (reassembles the 64-byte beta from its two halves)
- `fetchProofCommitEvents(program, connection, owner, label, memo, { limit? })` → `ProofCommitEvent[]` (oldest→newest; paginates `getSignaturesForAddress`, default `limit` 1000; uses a plain `Connection`)
- `decodeAuthority` / `decodeProofCommit` / `decodeProofCommitWithBeta` `(program, dataBytes)` — low-level Borsh decoders.

### Verification (pure, synchronous — no RPC)

- `verifyEndToEnd(input: VerifyEndToEndInput): VerifyEndToEndResult` — checks ECVRF math + `sha256(proof|alpha|memo)` against the commit. `result.valid` is the AND of every check; `result.beta` is the 64-byte output when `ecvrfValid`; `result.reasons` lists failure codes.
- `verifyAuthorityCommitEndToEnd(input): VerifyAuthorityCommitEndToEndResult` — everything `verifyEndToEnd` does **plus** authority `frozen`, `!revoked`, optional `expectedOwner`/`expectedLabel`, the commit→authority binding (always rederived from `(owner, label)`), and an optional `onChainBeta` match. Use this for any real verification.
- `pickCanonicalCommit(candidates: OnChainCommit[], proof): PickCanonicalResult` — returns the unique candidate whose `proofHash` matches the given proof (`canonical`), plus `duplicateMemoEvents` / `multipleVerifying` flags.

### Address & hashing helpers (pure)

- `deriveAuthorityAddress(owner, label, programId)` — compressed-PDA address; seeds `["vrf_authority", owner, label]` (label must be 32 bytes).
- `deriveProofCommitAddress(authority, memoHash, programId)` / `deriveProofCommitWithBetaAddress(...)` — seeds `["vrf_proof", authority, memoHash]` (shared namespace).
- `memoHash(memo)` / `alphaHash(alpha)` / `proofHash(proof)` — SHA-256 convenience wrappers.
- `encodeLabel(label: string): Uint8Array` — UTF-8, right-padded to 32 bytes (throws if >32 bytes encoded).

### Light Protocol context builders (advanced)

`forceLightV2`, `buildCreateContext`, `buildCommitProofContext`, `buildReadOnlyAuthorityContext`, `buildMutateContext` — assemble the validity-proof bundle + packed remaining-accounts the program expects. The `build*Ix` helpers use these internally; reach for them directly only when composing custom transactions.

### Re-exported from `@collectorcrypt/ecvrf`

`generateKeyPair`, `publicKeyFromSeed`, `proveVRF`, `verifyVRF`, `vrfProofToHash`, `bytesToHex`, `hexToBytes` — so producing and verifying proofs needs only this one package.

### Exported types

`InitAuthorityInput`, `FreezeAuthorityInput`, `CommitProofInput`, `ProofCommitEvent`, `OnChainAuthority`, `OnChainCommit`, `VerifyEndToEndInput`, `VerifyEndToEndResult`, `VerifyAuthorityCommitEndToEndInput`, `VerifyAuthorityCommitEndToEndResult`, `PickCanonicalResult`.

## Trust model

The program registers public keys, marks them ready (`freeze`), and stores proof-hash commitments — it does **not** custody keys, evaluate randomness, or run ECVRF on-chain (no Solana program can verify an RFC 9381 ECVRF proof in a single tx today). You trust the operator who froze the key to evaluate the VRF honestly; the on-chain commitments make any after-the-fact proof substitution detectable, and `verifyAuthorityCommitEndToEnd` is what makes that detection one function call. Full discussion in the [monorepo README](https://github.com/collectorcrypt/cc-vrf).

## Related

- [`@collectorcrypt/ecvrf`](https://www.npmjs.com/package/@collectorcrypt/ecvrf) — the underlying RFC 9381 ECVRF library + stream expander.
- [cc-vrf monorepo](https://github.com/collectorcrypt/cc-vrf) — program, CLI demo, security model, and measured costs.

## License

MIT.
