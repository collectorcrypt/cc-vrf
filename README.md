# cc-vrf

A standalone, permissionless on-chain VRF (Verifiable Random Function) system for Solana, built on Light Protocol compressed PDAs and Anchor log events. Live on **devnet + mainnet** at program ID `ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ`.

- **Pure-JS ECVRF library** — `@collectorcrypt/ecvrf`. RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI. Byte-exact validated against an independent Rust reference (`vrf-rfc9381`) via 28 fixture-driven interop tests.
- **One proof, many random values** — `vrfStream(beta, ...path)` deterministically expands a single VRF output into an unbounded, domain-separated tree of typed values (`nextU32`, `nextRange`, `nextFloat`, `shuffle`, `pick`, `fork`). One on-chain commit can power thousands of dice rolls, card draws, or loot rolls; every value is reproducible — and therefore verifiable — by anyone holding the proof.
- **Solana program** — locks each operator's public key on-chain via `init_authority` + `freeze_authority`, then only accepts commits from frozen, unrevoked authorities. It offers three commit variants per VRF call: `commit_proof` (compressed PDA), `commit_proof_with_beta` (same PDA namespace + on-chain beta for cross-program reads), and `commit_proof_event` (verified authority + log event only). Batch mode commits one Merkle root over many VRF calls: `commit_batch_event` (log event only) and `commit_batch_ring` (also keeps the last 128 roots in an account other programs can read). `attest_possession` optionally proves that the operator holds the VRF key.
- **TypeScript SDK** — `@collectorcrypt/vrf-client`. Wraps the Anchor IDL, all the Light Protocol plumbing (validity proofs, packed accounts, address-tree-v2), event-log scanning, batch trees and inclusion paths, and ships `verifyEndToEnd`, `verifyAuthorityCommitEndToEnd`, `verifyBatchCommitEndToEnd`, and `pickCanonicalCommit`.
- **Rust verifier crate** — `crates/cc-vrf-verify` (`no_std`). Batch leaves, RFC 9162 inclusion checks, and root-ring readers for Solana programs that settle against committed roots.
- **Reference CLI demo** — `apps/dice-demo`. End-to-end lifecycle (init → freeze → roll → verify → simulate) for every commit mode, plus a `cost` command that measures real per-call SOL spend across the per-call modes and batch mode.

## Repository layout

```
programs/cc-vrf/             Solana program (Anchor 0.31.1 + light-sdk 0.23); integration tests in tests/it
crates/cc-vrf-verify/        Rust batch + root-ring verifier for consumer programs (own workspace)
tests/mock-consumer/         Test-only consumer program settling against the root ring (never deployed)
packages/ecvrf/              @collectorcrypt/ecvrf — RFC 9381 Ed25519 ECVRF
packages/vrf-client/         @collectorcrypt/vrf-client — TS SDK
apps/dice-demo/              End-to-end CLI demo
scripts/                     Pinned program build (build-sbf.sh), Light prover for the tests (test-prover.sh)
tooling/witnet-vector-gen/   Rust binary that emits RFC 9381 fixtures
target/                      Build outputs (cc_vrf.so + its sha256, IDL, TS types)
```

## Prerequisites

- Node 24+ and pnpm 9+
- Rust 1.91.0 (pinned by `rust-toolchain.toml`)
- Solana CLI with `cargo-build-sbf` and platform-tools v1.52 (`scripts/build-sbf.sh` passes `--tools-version v1.52 --arch v0`)
- Anchor 0.31.1 (`avm use 0.31.1`), for the IDL
- For the program tests: Light CLI 0.28.4 (its prover 2.0.7 and proving keys)

## Build everything

```bash
pnpm install
pnpm --filter @collectorcrypt/ecvrf build
pnpm --filter @collectorcrypt/vrf-client build
pnpm --filter @collectorcrypt/dice-demo build
bash scripts/build-sbf.sh                               # program binary: target/deploy/cc_vrf.so + .sha256
anchor idl build -p cc_vrf -o target/idl/cc_vrf.json    # IDL; then pnpm --filter @collectorcrypt/vrf-client refresh:idl
```

`scripts/build-sbf.sh` is the only build of the deployed binary: it pins the toolchain, builds with `--locked`, fails on a stack-offset warning, and writes the sha256 next to the `.so`. `anchor build` uses the machine's default platform tools and produces a different binary; do not deploy it. The build also produces the mock consumer used by the tests (`SKIP_MOCK=1` skips it).

## Run the test suites

```bash
# 68 tests: 28 RFC 9381 byte-exact interop + structure + round-trip + negative cases + stream expander
pnpm --filter @collectorcrypt/ecvrf test

# 57 tests: SDK pure-function tests (verifyEndToEnd math, authority checks, PDA + with-beta derivation,
# pickCanonicalCommit, batch vectors + inclusion negatives, ring and possession codecs, log decoding)
pnpm --filter @collectorcrypt/vrf-client test

# 2 tests: demo CLI state-file round-trip
pnpm --filter @collectorcrypt/dice-demo test

# Or all of the above:
pnpm test

# Rust verifier crate: the batch vector corpus, inclusion negatives, ring reader
cargo test --manifest-path crates/cc-vrf-verify/Cargo.toml

# Program (light-program-test on LiteSVM, one test binary): RC1 wire pins, IDL superset, RC1-vs-new
# differential, batch, ring, possession, and the mock consumer
bash scripts/build-sbf.sh
bash scripts/test-prover.sh
CARGO_BUILD_JOBS=4 cargo test -p cc-vrf --test it -- --test-threads=2
bash scripts/test-prover.sh stop
```

Live on-chain smoke tests are gated on `CC_VRF_SMOKE=1` — see `apps/dice-demo/test/smoke.test.ts` and the "End-to-end devnet smoke" section below.

### Regenerating RFC 9381 fixtures

`packages/ecvrf/test/fixtures/rfc9381-vectors.json` is generated from the `vrf-rfc9381` Rust crate. To refresh:

```bash
cd tooling/witnet-vector-gen
cargo run --release --quiet > ../../packages/ecvrf/test/fixtures/rfc9381-vectors.json
```

## How the on-chain layer works

**Compressed accounts + events.** Light Protocol compressed PDAs cost far less to create than normal Solana PDAs; event-mode commits skip the per-call commit PDA entirely but still prove the frozen authority read-only.

| Account / Event | Seeds | Purpose |
|---|---|---|
| `VrfAuthority` | `["vrf_authority", owner, label]` | Per-operator pubkey + suite + freeze/revoke flags. One owner can have many authorities by varying `label`. Nothing sets `revoked` since v2. |
| `VrfProofCommit` | `["vrf_proof", authority, memo_hash]` | Registry-mode per-call commitment: `sha256(proof)`, `sha256(alpha)`, `sha256(memo)`, slot. Memo collision impossible by construction. |
| `VrfProofCommitWithBeta` | `["vrf_proof", authority, memo_hash]` | Same address namespace as `VrfProofCommit`, plus the full 64-byte ECVRF `beta` — readable by other Solana programs via Light SDK CPI. A memo can use either registry mode, not both. |
| `VrfProofCommitted` (event) | — | Event-mode commitment. No on-chain account; lives in the tx log. Scanned via `getSignaturesForAddress` + `getTransaction` on any Solana RPC. |
| `VrfBatchCommitted` (event) | — | Batch-mode commitment: `root`, `count`, `leaf_version`, and `ring_seq` for ring commits. Lives in the tx log. |
| `VrfRootRing` | `["root_ring", authority]` | Regular (uncompressed) 7,352-byte account: the authority's last 128 batch roots, readable by any program without CPI. Rent ≈ 0.038 SOL. |
| `VrfPossession` | `["vrf_pop", authority]` | Regular 80-byte account (authority, pk, slot). It exists only if the VRF key signed the possession message. |
| `VrfPossessionAttested` (event) | — | Emitted once, by `attest_possession`. |

**Nine instructions.**

| Instruction | Effect |
|---|---|
| `init_authority(pk, suite, label)` | Creates a fresh `VrfAuthority` owned by signer. |
| `freeze_authority` | One-way: sets `frozen=true`. After this, the pk and suite are permanent. |
| `commit_proof(memo_hash, proof_hash, alpha_hash)` | **Registry mode.** Requires a frozen, unrevoked authority and writes a new compressed PDA. Chain enforces one registry commit per memo. |
| `commit_proof_with_beta(memo_hash, proof_hash, alpha_hash, beta_lo, beta_hi)` | **Registry + beta.** Same address namespace as `commit_proof`, but additionally stores the 64-byte beta so other programs can read it via Light SDK CPI. The same memo cannot also have a plain registry commit. |
| `commit_proof_event(label, memo_hash, proof_hash, alpha_hash)` | **Event mode.** Proves the frozen, unrevoked authority read-only and emits a `VrfProofCommitted` log instead of writing a commit PDA. Verifier must handle duplicate-memo events via `pickCanonicalCommit`. |
| `commit_batch_event(label, root, count, leaf_version)` | **Batch mode.** Proves the authority read-only like event mode and emits one `VrfBatchCommitted` log for a Merkle root over `count` VRF results (1 ≤ `count` ≤ 2^20, `leaf_version` = 1). No account writes. |
| `init_root_ring(label)` | Creates the authority's `VrfRootRing`. Owner only, once. |
| `commit_batch_ring(label, root, count, leaf_version, expected_seq)` | **Batch + ring.** `commit_batch_event`, plus the root written to `entries[seq % 128]`. `expected_seq` must equal the ring's `next_seq`, so a retried transaction cannot insert a root twice. |
| `attest_possession(label)` | **Opt-in key-possession proof.** Requires one Ed25519 precompile instruction in the same transaction in which the authority's VRF key signs the 114-byte message `"ccvrf-authority-v1" ‖ program_id ‖ owner ‖ label`, then creates `VrfPossession`. |

Every instruction except `init_authority` also takes the Light validity proof, the authority's account meta, and the current `VrfAuthority`; the SDK builders fill them in.

v2 removed `revoke_authority`. It was owner-only and one-way, so anyone holding an operator's owner key could stop that operator's commits for good, and `@collectorcrypt/vrf-client` 0.1.x then reported every earlier commit of that authority as invalid. The `revoked` flag and the commit-time check stay for authorities revoked before v2; from vrf-client 0.2.0, verifiers report the flag as information only.

## Choosing a commit mode

| Property | Registry | Registry + beta | Event | Batch (+ ring) |
|---|---|---|---|---|
| Instruction | `commit_proof` | `commit_proof_with_beta` | `commit_proof_event` | `commit_batch_event` (`commit_batch_ring`) |
| Storage | Compressed PDA | Compressed PDA + 64-byte beta | Solana log event | One log event per Merkle root over many calls (ring: also the last 128 roots in an account) |
| Authority requirement | frozen + unrevoked | frozen + unrevoked | frozen + unrevoked | frozen + unrevoked |
| **Measured per-call cost (devnet)** | **~$0.0027** | **~$0.0027** | **~$0.0009** | not yet measured; same transaction shape as event mode, paid once per root |
| **Per 100k calls** | **~$270** | **~$270** | **~$90** | ~$0.90 at 100 calls per root (estimate) |
| Chain-enforced replay protection | yes | yes | no (verifier-side via `pickCanonicalCommit`) | no (verifier-side, as event mode) |
| Commit RPC requirement | Photon-capable (Helius dev plan or equiv.) | Photon-capable | Photon-capable for the authority proof; event scanning uses any Solana RPC | Photon-capable for the authority proof; verification needs `getTransaction` on the batch signature (an archival RPC for old batches) |
| Other programs can read the random value | hash only | yes (Light SDK CPI) | only via same-tx CPI from operator | ring: yes (root + count in a regular account, inclusion checked with `cc-vrf-verify`) |
| Best for | Public lotteries, audit trails | On-chain games consumed by another program | High-throughput logs where verifier-side duplicate handling is acceptable | High volume: one commit a minute covers any number of calls |

Costs above are measured by `cc-vrf-demo cost 100` against devnet with a Helius dev RPC at SOL ≈ $180 (2026-05-18). Event mode still proves the frozen authority read-only — that's a Light CPI plus the log emit — and is 3.00x cheaper than registry mode per call. Run `pnpm cc-vrf-demo cost <N>` yourself to benchmark against your own RPC + priority-fee strategy; it also measures batch mode (`--batch-size=N`).

## What event mode loses (and what it doesn't)

Event mode skips the per-call commit PDA, but it shifts one piece of work from the chain to the verifier: the chain accepts multiple `VrfProofCommitted` events for the same memo, so a verifier has to detect duplicates and pick the canonical one. The instruction still proves the authority is frozen and unrevoked before emitting the event. **Duplicates cannot change the random value** — RFC 9381 ECVRF output is unique: for a given `(pk, alpha)`, every proof that verifies yields the same 64-byte beta. (Only the key holder can make a second valid proof, by choosing another nonce, and it still yields that beta.)

The risk isn't fraud (the math forbids it), it's an **"inability to prove which event is canonical"** without running ECVRF. What happens for each verifier strategy:

| Scenario | Naive verifier (picks latest) | Careful verifier (`verifyAuthorityCommitEndToEnd` + `pickCanonicalCommit`) |
|---|---|---|
| 1 real event | accepts real proof | accepts real proof |
| Real event, then garbage event later | accepts garbage | rejects garbage (ECVRF fails), accepts real |
| Garbage event first, then real event later | accepts real (lucky — latest happens to be real) | accepts real proof |
| Two distinct garbage events, no real one | accepts garbage | rejects both — attack detected |
| Operator pre-commits many memos, picks favorable later | same risk as registry mode (protocol-level memo selection issue, mitigated by letting the user choose the memo) | same |

`@collectorcrypt/vrf-client` ships `pickCanonicalCommit` plus `verifyAuthorityCommitEndToEnd` to handle duplicate detection, authority lifecycle checks, suite checks, and beta checks. If your verifier uses them, event mode keeps the same cryptographic soundness as registry mode; it only gives up chain-enforced memo uniqueness.

## Batch mode

`commit_batch_event` commits one 32-byte Merkle root for many VRF results; `commit_batch_ring` commits the same root and also stores it in the authority's root ring. The tree format is batch spec v1 (`leaf_version` = 1) and is permanent: a change needs a new leaf version.

- **Leaf:** `SHA256(0x00 ‖ "ccvrf-batch-v1" ‖ SHA256(memo) ‖ SHA256(alpha) ‖ SHA256(proof) ‖ beta)`, with the 80-byte proof and the 64-byte beta.
- **Node:** `SHA256(0x01 ‖ left ‖ right)`. The root is the RFC 9162 Merkle tree hash over the leaves in index order.
- **Verify one result:** rebuild its leaf from (memo, alpha, proof, beta), then check its RFC 9162 inclusion path (§2.1.3.2) against the root and the `count` from the commit. Take the count from the chain, never from whoever asks you to verify: a path encodes only left/right turns, so one path verifies under every count that gives the tree the same shape (index 5 verifies for counts 9 through 16). Never accept a bare 32-byte leaf either.
- `@collectorcrypt/vrf-client` (`buildBatch`, `verifyBatchCommitEndToEnd`) and `crates/cc-vrf-verify` implement the same rules and check the same vector file, `crates/cc-vrf-verify/vectors/batch-v1.json`.

As in event mode, the chain does not stop one memo from appearing in two batches, and as in event mode a duplicate cannot change the result: the leaf binds `SHA256(proof)` next to beta, and every valid proof for `(pk, alpha)` gives the same beta.

**Root ring.** A 7,352-byte account at `["root_ring", authority]` (rent ≈ 0.038 SOL): a header (version, bump, capacity 128, `next_seq`, authority, owner, label) and 128 entries of `(seq, slot, root, count, leaf_version)`. Root `seq` sits at `entries[seq % 128]` and stays live while `seq != 0 && seq < next_seq && entries[seq % 128].seq == seq`; commit `seq + 128` overwrites it. A program settling against the ring should:

1. Pin the authority, and check the ring's owner (the cc-vrf program), address, and header authority.
2. Recompute alpha from its own request data.
3. Record each settled `alpha_hash`, so a request settles once.
4. Copy ("latch") an entry before 128 newer commits evict it.
5. Refund a request whose result is not committed within a timeout, so the operator gains nothing by withholding one.

`tests/mock-consumer` follows these rules, using `crates/cc-vrf-verify`. Settling one leaf of a 5-leaf batch costs about 15k CU. One user opening many packs needs only one alpha and `vrfStream`; the ring is for many independent requests settled across transactions.

**Key possession.** `attest_possession` is opt-in. The VRF key Ed25519-signs the 114-byte message `"ccvrf-authority-v1" ‖ program_id ‖ owner ‖ label`, the program checks it through the Ed25519 precompile, and it creates `["vrf_pop", authority]`; the account's existence is the attestation. ECVRF and Ed25519 derive their nonces from the same half of `SHA-512(sk)`, so the VRF key must never Ed25519-sign a 32-byte message. `signPossessionMessage` in the SDK signs only the possession message.

## End-to-end devnet smoke

The CLI demo is the easiest way to see everything working. You need a funded devnet keypair (`solana airdrop 2`) and an RPC URL that also serves Light Photon (Helius dev plans work out of the box).

```bash
export CC_VRF_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
export CC_VRF_PAYER_KEYPAIR=$HOME/.config/solana/id.json

# One-time: deploy the program to your devnet address.
anchor deploy --provider.cluster devnet

# Now exercise the lifecycle:
cd apps/dice-demo
pnpm cc-vrf-demo init                # creates VRF keypair + init_authority on chain
pnpm cc-vrf-demo freeze              # locks the pk permanently

# Registry mode (compressed PDA):
pnpm cc-vrf-demo roll                # commit_proof, prints value 1..100
pnpm cc-vrf-demo verify              # fetch PDA + verifyAuthorityCommitEndToEnd
pnpm cc-vrf-demo simulate 50         # 50 back-to-back roll+verify cycles

# Registry + beta mode (PDA + on-chain beta for cross-program reads):
pnpm cc-vrf-demo roll-with-beta      # commit_proof_with_beta
pnpm cc-vrf-demo verify-with-beta    # PDA fetch, ECVRF check, beta == vrfProofToHash(proof)

# Event mode (no commit PDA; still proves the frozen authority):
pnpm cc-vrf-demo roll-event          # commit_proof_event, emits a log
pnpm cc-vrf-demo verify-event        # reads the stored tx's logs, pickCanonicalCommit, full verify
pnpm cc-vrf-demo simulate-event 50

# Batch mode (one commit per Merkle root over many rolls):
pnpm cc-vrf-demo roll-batch 8        # commit_batch_event for 8 rolls
pnpm cc-vrf-demo verify-batch        # root + count from the tx, proof + path from local state
pnpm cc-vrf-demo init-ring           # one-time: the root ring (~0.038 SOL rent)
pnpm cc-vrf-demo roll-ring 8         # commit_batch_ring: also writes the root into the ring
pnpm cc-vrf-demo verify-batch        # also reports whether the ring entry is still live

# Optional, one-time: prove the VRF key signs for this authority
pnpm cc-vrf-demo attest

# Measure real per-call cost for every mode (default N=100, batch size 100):
pnpm cc-vrf-demo cost 100 --sol-usd=180 --batch-size=100
```

To run the smoke test as part of `pnpm test`:

```bash
CC_VRF_SMOKE=1 CC_VRF_SMOKE_PAYER=$HOME/.config/solana/id.json \
  pnpm --filter @collectorcrypt/dice-demo test
```

## Security model

The program does **four** things and only four things:

1. **Register public keys.** `init_authority` creates a compressed authority for one `(owner, label, pk, suite)` tuple. The only supported suite today is RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI (`0x03`).
2. **Mark authorities ready.** `freeze_authority` is one-way, and all commit instructions require `frozen=true` and `revoked=false`.
3. **Commit proof hashes or batch roots** (and optionally beta values). Registry modes create a compressed commit record; event and batch modes emit a log after proving the authority read-only; ring commits also write the root to the authority's ring. The operator cannot replace a committed proof without detection.
4. **Record key possession**, opt-in: `attest_possession` checks an Ed25519 signature by the authority's VRF key over a fixed message.

The program does **not** custody keys, evaluate randomness, or run ECVRF verification on-chain. Each operator runs their own VRF (env vars, Nitro Enclave, threshold scheme — their choice) and posts hashes. Verifiers pull the on-chain commit plus the operator-published proof and run `verifyAuthorityCommitEndToEnd` from `@collectorcrypt/vrf-client`.

**Trust model:** trust the operator who registered and froze the pk to honestly produce VRF proofs. The on-chain commitments make proof substitution detectable. In registry mode the chain also enforces one registry commit per memo across plain and beta variants; in event mode memo uniqueness shifts to the verifier (see "What event mode loses" above).

**Trustless on-chain consumption is not in scope.** No Solana program can today verify an RFC 9381 ECVRF proof in a single tx — there's no Ed25519 ECVRF precompile and the curve math costs ~200k+ CU per verify in BPF. The `commit_proof_with_beta` variant and the root ring let other programs *read* the random value cheaply, but those programs still trust the operator (whose pk is frozen on chain) for the ECVRF step. Auditors can detect mismatches after the fact by fetching the proof off-chain and re-running the math; because a batch leaf binds `SHA256(proof)` next to beta, a beta that does not match its proof is publicly provable.

## Cost

Measured against devnet on 2026-05-18, SOL ≈ $180. Run `pnpm cc-vrf-demo cost <N>` to reproduce against your own RPC and priority-fee setup. At a fraction of a cent per call, this is about as cheap as verifiable on-chain randomness gets.

| Monthly VRF calls | cc-vrf registry (~$0.0027) | cc-vrf event (~$0.0009) |
|---|---:|---:|
| 10k | $27/mo | $9/mo |
| 100k | $270/mo | $90/mo |
| 1M | $2,700/mo | $900/mo |
| 10M | $27,000/mo | $9,000/mo |

The `commit_proof_with_beta` variant costs the same as plain registry mode in our benchmark — the extra 64 bytes per leaf is absorbed into the same Light Protocol slot. It uses the same address namespace as plain registry mode, so a single `(authority, memo)` can only choose one of the two registry shapes.

Batch mode pays one event-mode-sized transaction per root, whatever the number of calls under it: at one root a minute, that is 1,440 transactions a day. A ring commit adds a write to an account the operator already paid for (≈ 0.038 SOL once).

Our cost to provide this as permissionless public infrastructure: $0 ongoing. The program lives on Solana; each operator pays only their own tx fees against their own authority.

## License

MIT.
