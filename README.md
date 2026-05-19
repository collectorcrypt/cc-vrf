# cc-vrf

A standalone, permissionless on-chain VRF (Verifiable Random Function) system for Solana, built on Light Protocol compressed PDAs and Anchor log events.

- **Pure-JS ECVRF library** — `@collectorcrypt/ecvrf`. RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI. Byte-exact validated against an independent Rust reference (`vrf-rfc9381`) via 28 fixture-driven interop tests.
- **One proof, many random values** — `vrfStream(beta, ...path)` deterministically expands a single VRF output into an unbounded, domain-separated tree of typed values (`nextU32`, `nextRange`, `nextFloat`, `shuffle`, `pick`, `fork`). One on-chain commit can power thousands of dice rolls, card draws, or loot rolls; every value is reproducible — and therefore verifiable — by anyone holding the proof.
- **Solana program** — locks each operator's public key on-chain via `init_authority` + `freeze_authority`, then only accepts commits from frozen, unrevoked authorities. It offers three commit variants per VRF call: `commit_proof` (compressed PDA), `commit_proof_with_beta` (same PDA namespace + on-chain beta for cross-program reads), and `commit_proof_event` (verified authority + log event only).
- **TypeScript SDK** — `@collectorcrypt/vrf-client`. Wraps the Anchor IDL, all the Light Protocol plumbing (validity proofs, packed accounts, address-tree-v2), event-log scanning, and ships `verifyEndToEnd`, `verifyAuthorityCommitEndToEnd`, and `pickCanonicalCommit`.
- **Reference CLI demo** — `apps/dice-demo`. End-to-end lifecycle (init → freeze → roll → verify → simulate) plus a `cost` command that measures real per-call SOL spend across all three modes.

## Repository layout

```
programs/cc-vrf/             Solana program (Anchor 0.31.1 + light-sdk 0.23)
packages/ecvrf/              @collectorcrypt/ecvrf — RFC 9381 Ed25519 ECVRF
packages/vrf-client/         @collectorcrypt/vrf-client — TS SDK
apps/dice-demo/              End-to-end CLI demo
tooling/witnet-vector-gen/   Rust binary that emits RFC 9381 fixtures
target/                      Anchor build outputs (cc_vrf.so, IDL, TS types)
```

## Prerequisites

- Node 24+ and pnpm 9+
- Rust toolchain
- Solana CLI 1.18+ (`solana-keygen`, `solana`)
- Anchor 0.31.1 (`avm use 0.31.1`)

## Build everything

```bash
pnpm install
pnpm --filter @collectorcrypt/ecvrf build
pnpm --filter @collectorcrypt/vrf-client build
pnpm --filter @collectorcrypt/dice-demo build
anchor build
```

## Run the test suites

```bash
# 68 tests: 28 RFC 9381 byte-exact interop + structure + round-trip + negative cases + stream expander
pnpm --filter @collectorcrypt/ecvrf test

# 26 tests: SDK pure-function tests (verifyEndToEnd math, authority checks, PDA + with-beta derivation, pickCanonicalCommit)
pnpm --filter @collectorcrypt/vrf-client test

# 2 tests: demo CLI state-file round-trip
pnpm --filter @collectorcrypt/dice-demo test

# Or all of the above:
pnpm test
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
| `VrfAuthority` | `["vrf_authority", owner, label]` | Per-operator pubkey + suite + freeze/revoke flags. One owner can have many authorities by varying `label`. |
| `VrfProofCommit` | `["vrf_proof", authority, memo_hash]` | Registry-mode per-call commitment: `sha256(proof)`, `sha256(alpha)`, `sha256(memo)`, slot. Memo collision impossible by construction. |
| `VrfProofCommitWithBeta` | `["vrf_proof", authority, memo_hash]` | Same address namespace as `VrfProofCommit`, plus the full 64-byte ECVRF `beta` — readable by other Solana programs via Light SDK CPI. A memo can use either registry mode, not both. |
| `VrfProofCommitted` (event) | — | Event-mode commitment. No on-chain account; lives in the tx log. Scanned via `getSignaturesForAddress` + `getTransaction` on any Solana RPC. |

**Six instructions.**

| Instruction | Effect |
|---|---|
| `init_authority(pk, suite, label)` | Creates a fresh `VrfAuthority` owned by signer. |
| `freeze_authority` | One-way: sets `frozen=true`. After this, the pk and suite are permanent. |
| `revoke_authority` | Sets `revoked=true`. Informational only — historical proofs remain verifiable. |
| `commit_proof(memo_hash, proof_hash, alpha_hash)` | **Registry mode.** Requires a frozen, unrevoked authority and writes a new compressed PDA. Chain enforces one registry commit per memo. |
| `commit_proof_with_beta(memo_hash, proof_hash, alpha_hash, beta_lo, beta_hi)` | **Registry + beta.** Same address namespace as `commit_proof`, but additionally stores the 64-byte beta so other programs can read it via Light SDK CPI. The same memo cannot also have a plain registry commit. |
| `commit_proof_event(label, memo_hash, proof_hash, alpha_hash)` | **Event mode.** Proves the frozen, unrevoked authority read-only and emits a `VrfProofCommitted` log instead of writing a commit PDA. Verifier must handle duplicate-memo events via `pickCanonicalCommit`. |

## Choosing a commit mode

| Property | Registry | Registry + beta | Event |
|---|---|---|---|
| Instruction | `commit_proof` | `commit_proof_with_beta` | `commit_proof_event` |
| Storage | Compressed PDA | Compressed PDA + 64-byte beta | Solana log event |
| Authority requirement | frozen + unrevoked | frozen + unrevoked | frozen + unrevoked |
| **Measured per-call cost (devnet)** | **~$0.0027** | **~$0.0027** | **~$0.0009** |
| **Per 100k calls** | **~$270** | **~$270** | **~$90** |
| Chain-enforced replay protection | yes | yes | no (verifier-side via `pickCanonicalCommit`) |
| Commit RPC requirement | Photon-capable (Helius dev plan or equiv.) | Photon-capable | Photon-capable for the authority proof; event scanning uses any Solana RPC |
| Other programs can read the random value | hash only | yes (Light SDK CPI) | only via same-tx CPI from operator |
| Best for | Public lotteries, audit trails | On-chain games consumed by another program | High-throughput logs where verifier-side duplicate handling is acceptable |

Costs above are measured by `cc-vrf-demo cost 100` against devnet with a Helius dev RPC at SOL ≈ $180 (2026-05-18). Event mode still proves the frozen authority read-only — that's a Light CPI plus the log emit — and is 3.00x cheaper than registry mode per call. Run `pnpm cc-vrf-demo cost <N>` yourself to benchmark against your own RPC + priority-fee strategy.

## What event mode loses (and what it doesn't)

Event mode skips the per-call commit PDA, but it shifts one piece of work from the chain to the verifier: the chain accepts multiple `VrfProofCommitted` events for the same memo, so a verifier has to detect duplicates and pick the canonical one. The instruction still proves the authority is frozen and unrevoked before emitting the event. **The deterministic VRF proof is always recoverable from the event list** — RFC 9381 ECVRF guarantees exactly one valid 80-byte proof per `(pk, alpha)`, so there can be at most one cryptographically-valid event among duplicates.

The risk isn't fraud (the math forbids it), it's an **"inability to prove which event is canonical"** without running ECVRF. What happens for each verifier strategy:

| Scenario | Naive verifier (picks latest) | Careful verifier (`verifyAuthorityCommitEndToEnd` + `pickCanonicalCommit`) |
|---|---|---|
| 1 real event | accepts real proof | accepts real proof |
| Real event, then garbage event later | accepts garbage | rejects garbage (ECVRF fails), accepts real |
| Garbage event first, then real event later | accepts real (lucky — latest happens to be real) | accepts real proof |
| Two distinct garbage events, no real one | accepts garbage | rejects both — attack detected |
| Operator pre-commits many memos, picks favorable later | same risk as registry mode (protocol-level memo selection issue, mitigated by letting the user choose the memo) | same |

`@collectorcrypt/vrf-client` ships `pickCanonicalCommit` plus `verifyAuthorityCommitEndToEnd` to handle duplicate detection, authority lifecycle checks, suite checks, and beta checks. If your verifier uses them, event mode keeps the same cryptographic soundness as registry mode; it only gives up chain-enforced memo uniqueness.

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
pnpm cc-vrf-demo verify-event        # scans tx logs, pickCanonicalCommit, full verify
pnpm cc-vrf-demo simulate-event 50

# Measure real per-call cost for all three modes (default N=100):
pnpm cc-vrf-demo cost 100 --sol-usd=180
```

To run the smoke test as part of `pnpm test`:

```bash
CC_VRF_SMOKE=1 CC_VRF_SMOKE_PAYER=$HOME/.config/solana/id.json \
  pnpm --filter @collectorcrypt/dice-demo test
```

## Security model

The program does **three** things and only three things:

1. **Register public keys.** `init_authority` creates a compressed authority for one `(owner, label, pk, suite)` tuple. The only supported suite today is RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI (`0x03`).
2. **Mark authorities ready.** `freeze_authority` is one-way, and all commit instructions require `frozen=true` and `revoked=false`.
3. **Commit proof hashes** (and optionally beta values). Registry modes create a compressed commit record; event mode emits a log after proving the authority read-only. The operator cannot replace a committed proof without detection.

The program does **not** custody keys, evaluate randomness, or run ECVRF verification on-chain. Each operator runs their own VRF (env vars, Nitro Enclave, threshold scheme — their choice) and posts hashes. Verifiers pull the on-chain commit plus the operator-published proof and run `verifyAuthorityCommitEndToEnd` from `@collectorcrypt/vrf-client`.

**Trust model:** trust the operator who registered and froze the pk to honestly produce VRF proofs. The on-chain commitments make proof substitution detectable. In registry mode the chain also enforces one registry commit per memo across plain and beta variants; in event mode memo uniqueness shifts to the verifier (see "What event mode loses" above).

**Trustless on-chain consumption is not in scope.** No Solana program can today verify an RFC 9381 ECVRF proof in a single tx — there's no Ed25519 ECVRF precompile and the curve math costs ~200k+ CU per verify in BPF. The `commit_proof_with_beta` variant lets other programs *read* the random value cheaply, but those programs still trust the operator (whose pk is frozen on chain). Auditors can detect mismatches after the fact by fetching the proof off-chain and re-running the math.

## Cost comparison

Measured against devnet on 2026-05-18, SOL ≈ $180. Run `pnpm cc-vrf-demo cost <N>` to reproduce against your own RPC and priority-fee setup.

| Monthly VRF calls | Switchboard (~$0.45) | cc-vrf registry (~$0.0027) | cc-vrf event (~$0.0009) |
|---|---:|---:|---:|
| 10k | $4,500/mo | $27/mo | $9/mo |
| 100k | $45,000/mo | $270/mo | $90/mo |
| 1M | $450,000/mo | $2,700/mo | $900/mo |
| 10M | $4.5M/mo | $27,000/mo | $9,000/mo |

The `commit_proof_with_beta` variant costs the same as plain registry mode in our benchmark — the extra 64 bytes per leaf is absorbed into the same Light Protocol slot. It uses the same address namespace as plain registry mode, so a single `(authority, memo)` can only choose one of the two registry shapes.

Our cost to provide this as permissionless public infrastructure: $0 ongoing. The program lives on Solana; each operator pays only their own tx fees against their own authority.

## License

MIT.
