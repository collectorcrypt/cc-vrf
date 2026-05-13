# cc-vrf

A standalone, permissionless on-chain VRF (Verifiable Random Function) system for Solana, built on Light Protocol compressed PDAs.

- **Pure-JS ECVRF library** — `@collectorcrypt/ecvrf`. RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI. Byte-exact validated against an independent Rust reference (`vrf-rfc9381`) via 28 fixture-driven interop tests.
- **Solana program** — locks each operator's public key on-chain via `init_authority` + `freeze_authority`, and records `sha256(proof)` per VRF call via `commit_proof`. Compressed PDAs everywhere, no rent burn.
- **TypeScript SDK** — `@collectorcrypt/vrf-client`. Wraps the Anchor IDL, all the Light Protocol plumbing (validity proofs, packed accounts, address-tree-v2), and ships a single `verifyEndToEnd` function for full provable-fairness checks.
- **Reference CLI demo** — `apps/dice-demo`. End-to-end lifecycle (init → freeze → roll → verify → simulate) you can run on devnet before integrating anywhere.

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

# 16 tests: SDK pure-function tests (verifyEndToEnd math, PDA derivation)
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

**Two compressed PDAs.** Light Protocol compressed PDAs cost ~$0.00001 to create (vs ~$0.0016 for a normal Solana PDA).

| Account | Seeds | Purpose |
|---|---|---|
| `VrfAuthority` | `["vrf_authority", owner, label]` | Per-operator pubkey + suite + freeze/revoke flags. One owner can have many authorities by varying `label`. |
| `VrfProofCommit` | `["vrf_proof", authority, memo_hash]` | Per-VRF-call commitment: `sha256(proof)`, `sha256(alpha)`, `sha256(memo)`, slot. Memo collision impossible by construction. |

**Four instructions.**

| Instruction | Effect |
|---|---|
| `init_authority(pk, suite, label)` | Creates a fresh `VrfAuthority` owned by signer. |
| `freeze_authority` | One-way: sets `frozen=true`. After this, the pk and suite are permanent. |
| `revoke_authority` | Sets `revoked=true`. Informational only — historical proofs remain verifiable. |
| `commit_proof(memo_hash, proof_hash, alpha_hash)` | Posts a per-call commitment. Authority owner only. |

## End-to-end devnet smoke

The CLI demo is the easiest way to see everything working. You need a funded devnet keypair (`solana airdrop 2`) and an RPC URL that also serves Light Photon (Helius dev plans work out of the box).

```bash
export CC_VRF_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_KEY
export CC_VRF_PAYER_KEYPAIR=$HOME/.config/solana/id.json

# One-time: deploy the program to your devnet address.
anchor deploy --provider.cluster devnet

# Now exercise the lifecycle:
cd apps/dice-demo
pnpm cc-vrf-demo init        # creates VRF keypair + init_authority on chain
pnpm cc-vrf-demo freeze      # locks the pk permanently
pnpm cc-vrf-demo roll        # one VRF call: prove + commit, prints value 1..100
pnpm cc-vrf-demo verify      # fetches on-chain commit, runs verifyEndToEnd
pnpm cc-vrf-demo simulate 50 # 50 rolls back-to-back, expects all to verify
```

To run the smoke test as part of `pnpm test`:

```bash
CC_VRF_SMOKE=1 CC_VRF_SMOKE_PAYER=$HOME/.config/solana/id.json \
  pnpm --filter @collectorcrypt/dice-demo test
```

## Security model

The program does **two** things and only two things:

1. **Lock public keys.** Once an authority is frozen, the operator cannot silently rotate to a different secret key.
2. **Commit proof hashes.** Every VRF call gets a permanent on-chain record. The operator cannot hide an unfavorable proof after the fact.

The program does **not** custody keys, evaluate randomness, or run cryptography on-chain. Each operator runs their own VRF (env vars, Nitro Enclave, threshold scheme — their choice) and posts hashes. Verifiers pull the on-chain commit plus the operator-published proof and run `verifyEndToEnd` from `@collectorcrypt/vrf-client`.

**Trust model:** trust the operator who locked the pk to honestly produce VRF proofs. The on-chain commitments make any deviation (silent key rotation, proof withholding) cryptographically detectable.

## Cost comparison

| Monthly VRF calls | Switchboard (~$0.45) | cc-vrf standalone (~$0.004) | cc-vrf batched (~$0.0002) |
|---|---:|---:|---:|
| 10k | $4,500/mo | $40/mo | $2/mo |
| 100k | $45,000/mo | $400/mo | $20/mo |
| 1M | $450,000/mo | $4,000/mo | $200/mo |
| 10M | $4.5M/mo | $40,000/mo | $2,000/mo |

Our cost to provide this as permissionless public infrastructure: $0 ongoing. The program lives on Solana; each operator pays only their own tx fees against their own authority.

## License

MIT.
