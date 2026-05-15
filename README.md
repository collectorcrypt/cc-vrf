# cc-vrf

A standalone, permissionless on-chain VRF (Verifiable Random Function) system for Solana, built on Light Protocol compressed PDAs and Anchor log events.

- **Pure-JS ECVRF library** — `@collectorcrypt/ecvrf`. RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI. Byte-exact validated against an independent Rust reference (`vrf-rfc9381`) via 28 fixture-driven interop tests.
- **Solana program** — locks each operator's public key on-chain via `init_authority` + `freeze_authority`, and offers three commit variants per VRF call: `commit_proof` (compressed PDA), `commit_proof_with_beta` (PDA + on-chain beta for cross-program reads), and `commit_proof_event` (log event only, ~3x cheaper).
- **TypeScript SDK** — `@collectorcrypt/vrf-client`. Wraps the Anchor IDL, all the Light Protocol plumbing (validity proofs, packed accounts, address-tree-v2), event-log scanning, and ships a single `verifyEndToEnd` (plus `pickCanonicalCommit` for event-mode duplicate detection).
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
# 47 tests: 28 RFC 9381 byte-exact interop + structure + round-trip + negative cases
pnpm --filter @collectorcrypt/ecvrf test

# 23 tests: SDK pure-function tests (verifyEndToEnd math, PDA + with-beta derivation, pickCanonicalCommit)
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

**Compressed accounts + events.** Light Protocol compressed PDAs cost ~$0.00001 to create (vs ~$0.0016 for a normal Solana PDA); event-mode commits cost less still because they skip the PDA entirely.

| Account / Event | Seeds | Purpose |
|---|---|---|
| `VrfAuthority` | `["vrf_authority", owner, label]` | Per-operator pubkey + suite + freeze/revoke flags. One owner can have many authorities by varying `label`. |
| `VrfProofCommit` | `["vrf_proof", authority, memo_hash]` | Registry-mode per-call commitment: `sha256(proof)`, `sha256(alpha)`, `sha256(memo)`, slot. Memo collision impossible by construction. |
| `VrfProofCommitWithBeta` | `["vrf_proof_b", authority, memo_hash]` | Same as above plus the full 64-byte ECVRF `beta` — readable by other Solana programs via Light SDK CPI. |
| `VrfProofCommitted` (event) | — | Event-mode commitment. No on-chain account; lives in the tx log. Scanned via `getSignaturesForAddress` + `getTransaction` on any Solana RPC. |

**Six instructions.**

| Instruction | Effect |
|---|---|
| `init_authority(pk, suite, label)` | Creates a fresh `VrfAuthority` owned by signer. |
| `freeze_authority` | One-way: sets `frozen=true`. After this, the pk and suite are permanent. |
| `revoke_authority` | Sets `revoked=true`. Informational only — historical proofs remain verifiable. |
| `commit_proof(memo_hash, proof_hash, alpha_hash)` | **Registry mode.** Writes a new compressed PDA. Chain enforces one commit per memo. |
| `commit_proof_with_beta(memo_hash, proof_hash, alpha_hash, beta_lo, beta_hi)` | **Registry + beta.** Same as `commit_proof` but additionally stores the 64-byte beta so other programs can read it via Light SDK CPI. Same per-call cost. |
| `commit_proof_event(label, memo_hash, proof_hash, alpha_hash)` | **Event mode.** Emits a `VrfProofCommitted` log instead of writing a PDA. ~3x cheaper. No Photon RPC required. Verifier must handle duplicate-memo events via `pickCanonicalCommit`. |

## Choosing a commit mode

| Property | Registry | Registry + beta | Event |
|---|---|---|---|
| Instruction | `commit_proof` | `commit_proof_with_beta` | `commit_proof_event` |
| Storage | Compressed PDA | Compressed PDA + 64-byte beta | Solana log event |
| **Measured per-call cost (devnet)** | **~$0.0024** | **~$0.0024** | **~$0.0008** |
| **Per 100k calls** | **~$240** | **~$240** | **~$80** |
| Chain-enforced replay protection | yes | yes | no (verifier-side via `pickCanonicalCommit`) |
| RPC requirement | Photon-capable (Helius dev plan or equiv.) | Photon-capable | **any Solana RPC** |
| Other programs can read the random value | hash only | yes (Light SDK CPI) | only via same-tx CPI from operator |
| Best for | Public lotteries, audit trails | On-chain games consumed by another program | Gacha, internal randomness, high-throughput, no Photon ops |

Costs above are measured by `cc-vrf-demo cost` against devnet with a Helius dev RPC at SOL ≈ $160. Real production cost depends on priority-fee market conditions. Run `pnpm cc-vrf-demo cost <N>` yourself to benchmark against your own RPC + priority-fee strategy.

## What event mode loses (and what it doesn't)

Event mode is the cheapest and simplest to deploy, but it shifts one piece of work from the chain to the verifier: the chain accepts multiple `VrfProofCommitted` events for the same memo, so a verifier has to detect duplicates and pick the canonical one. **The deterministic VRF proof is always recoverable from the event list** — RFC 9381 ECVRF guarantees exactly one valid 80-byte proof per `(pk, alpha)`, so there can be at most one cryptographically-valid event among duplicates.

The risk isn't fraud (the math forbids it), it's an **"inability to prove which event is canonical"** without running ECVRF. What happens for each verifier strategy:

| Scenario | Naive verifier (picks latest) | Careful verifier (verifyEndToEnd + pickCanonicalCommit) |
|---|---|---|
| 1 real event | accepts real proof | accepts real proof |
| Real event, then garbage event later | accepts garbage | rejects garbage (ECVRF fails), accepts real |
| Garbage event first, then real event later | accepts real (lucky — latest happens to be real) | accepts real proof |
| Two distinct garbage events, no real one | accepts garbage | rejects both — attack detected |
| Operator pre-commits many memos, picks favorable later | same risk as registry mode (protocol-level memo selection issue, mitigated by letting the user choose the memo) | same |

`@collectorcrypt/vrf-client` ships `pickCanonicalCommit` to handle the duplicate-detection logic correctly. If your verifier uses it, event mode is equivalent in soundness to registry mode at a fraction of the cost.

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
pnpm cc-vrf-demo verify              # fetch PDA + verifyEndToEnd
pnpm cc-vrf-demo simulate 50         # 50 back-to-back roll+verify cycles

# Registry + beta mode (PDA + on-chain beta for cross-program reads):
pnpm cc-vrf-demo roll-with-beta      # commit_proof_with_beta
pnpm cc-vrf-demo verify-with-beta    # PDA fetch, ECVRF check, beta == vrfProofToHash(proof)

# Event mode (~3x cheaper, no Photon RPC needed):
pnpm cc-vrf-demo roll-event          # commit_proof_event, emits a log
pnpm cc-vrf-demo verify-event        # scans tx logs, pickCanonicalCommit, verify
pnpm cc-vrf-demo simulate-event 50

# Measure real per-call cost for all three modes (default N=100):
pnpm cc-vrf-demo cost 50 --sol-usd=160
```

To run the smoke test as part of `pnpm test`:

```bash
CC_VRF_SMOKE=1 CC_VRF_SMOKE_PAYER=$HOME/.config/solana/id.json \
  pnpm --filter @collectorcrypt/dice-demo test
```

## Security model

The program does **two** things and only two things:

1. **Lock public keys.** Once an authority is frozen, the operator cannot silently rotate to a different secret key.
2. **Commit proof hashes** (and optionally beta values). Every VRF call gets a permanent on-chain record. The operator cannot hide an unfavorable proof after the fact.

The program does **not** custody keys, evaluate randomness, or run cryptography on-chain. Each operator runs their own VRF (env vars, Nitro Enclave, threshold scheme — their choice) and posts hashes. Verifiers pull the on-chain commit plus the operator-published proof and run `verifyEndToEnd` from `@collectorcrypt/vrf-client`.

**Trust model:** trust the operator who locked the pk to honestly produce VRF proofs. The on-chain commitments make any deviation (silent key rotation, proof withholding) cryptographically detectable. In registry mode the chain *also* enforces one-commit-per-memo; in event mode that responsibility shifts to the verifier (see "What event mode loses" above).

**Trustless on-chain consumption is not in scope.** No Solana program can today verify an RFC 9381 ECVRF proof in a single tx — there's no Ed25519 ECVRF precompile and the curve math costs ~200k+ CU per verify in BPF. The `commit_proof_with_beta` variant lets other programs *read* the random value cheaply, but those programs still trust the operator (whose pk is frozen on chain). Auditors can detect mismatches after the fact by fetching the proof off-chain and re-running the math.

## Cost comparison

Measured against devnet, SOL ≈ $160. Run `pnpm cc-vrf-demo cost <N>` to reproduce.

| Monthly VRF calls | Switchboard (~$0.45) | cc-vrf registry (~$0.0024) | cc-vrf event (~$0.0008) |
|---|---:|---:|---:|
| 10k | $4,500/mo | $24/mo | $8/mo |
| 100k | $45,000/mo | $240/mo | $80/mo |
| 1M | $450,000/mo | $2,400/mo | $800/mo |
| 10M | $4.5M/mo | $24,000/mo | $8,000/mo |

The `commit_proof_with_beta` variant costs the same as plain registry mode in our benchmark — the extra 64 bytes per leaf is absorbed into the same Light Protocol slot.

Our cost to provide this as permissionless public infrastructure: $0 ongoing. The program lives on Solana; each operator pays only their own tx fees against their own authority.

## License

MIT.
