# @collectorcrypt/ecvrf

A dependency-light, **pure-JavaScript** implementation of the RFC 9381 **ECVRF-EDWARDS25519-SHA512-TAI** verifiable random function, plus a deterministic stream expander that turns one VRF output into an unbounded tree of typed random values.

A VRF lets a key holder produce, for any input `alpha`, a random output `beta` together with a proof `pi`. Anyone holding the public key can check that `beta` is the unique correct output for `(pk, alpha)` — the prover cannot bias it, and the result is reproducible by every verifier. This package is the cryptographic core of [cc-vrf](https://github.com/collectorcrypt/cc-vrf), a permissionless on-chain VRF system for Solana, but it has **no Solana dependency** and works anywhere modern JS runs (Node, Deno, Bun, browsers).

- **RFC 9381 compliant.** Implements `ECVRF_prove`, `ECVRF_verify`, and `ECVRF_proof_to_hash` for ciphersuite `0x03` (`ECVRF-EDWARDS25519-SHA512-TAI`), the "try-and-increment" hash-to-curve variant.
- **Byte-exact, validated.** Checked against the published RFC 9381 §A.4 test vectors and cross-validated against an independent Rust reference implementation via fixture-driven interop tests.
- **Synchronous.** No `await`, no async setup ceremony — `proveVRF`/`verifyVRF` return directly. Built on [`@noble/ed25519`](https://github.com/paulmillr/noble-curves) v3 and [`@noble/hashes`](https://github.com/paulmillr/noble-hashes) v2.
- **One proof → many values.** `vrfStream(beta, ...path)` deterministically expands a single 64-byte `beta` into an unbounded, domain-separated stream of `u32`/range/float/shuffle/pick values. One VRF evaluation can power thousands of reproducible dice rolls, card draws, or loot rolls.

## Install

```bash
npm install @collectorcrypt/ecvrf
# or: pnpm add @collectorcrypt/ecvrf  /  yarn add @collectorcrypt/ecvrf
```

ESM and TypeScript types are included.

## Quick start

```ts
import {
  generateKeyPair,
  proveVRF,
  verifyVRF,
  vrfProofToHash,
  bytesToHex,
} from "@collectorcrypt/ecvrf";

// 1. One-time: a VRF keypair. `sk` is a 32-byte Ed25519 seed, `pk` is the 32-byte public key.
const { sk, pk } = generateKeyPair();

// 2. Prover: evaluate the VRF over some input (alpha can be any bytes).
const alpha = new TextEncoder().encode("game:42|round:7");
const { proof } = proveVRF(sk, alpha); // proof is exactly 80 bytes

// 3. Anyone: verify the proof against (pk, alpha).
const ok = verifyVRF(pk, alpha, proof); // true

// 4. Anyone: derive the canonical 64-byte random output (beta).
const beta = vrfProofToHash(proof);
console.log(bytesToHex(beta));
```

`verifyVRF` is the whole security story: it returns `true` only for the one proof a holder of `sk` could have produced for that exact `alpha`. A tampered `alpha`, `pk`, or `proof` returns `false`.

## Turning one proof into many random values

A single 80-byte proof yields a single 64-byte `beta`. `vrfStream` expands that `beta` into as many typed values as you need, deterministically and with domain separation, so one on-chain VRF commitment can drive an entire game's worth of outcomes — all reproducible by anyone holding the proof.

```ts
import { vrfProofToHash, vrfStream } from "@collectorcrypt/ecvrf";

const beta = vrfProofToHash(proof);

// Open a named stream. The path ("loot") is domain-separated from other paths.
const s = vrfStream(beta, "loot");

const roll = s.nextRange(1, 101);          // integer in [1, 101) → 1..100
const f = s.nextFloat();                    // float in [0, 1) with 53 bits of entropy
const card = s.pick(["A", "K", "Q", "J"]);  // uniform element
const deck = s.shuffle([1, 2, 3, 4, 5]);    // unbiased Fisher–Yates, returns a new array
const raw = s.nextBytes(16);                // 16 raw bytes
const big = s.nextU64();                     // bigint, full 64 bits

// Forks are independent sub-streams under an extended path.
const combat = s.fork("combat");            // == vrfStream(beta, "loot", "combat")
const isCrit = combat.nextFloat() < 0.1;
```

**Determinism guarantee.** Block `i` of a stream is `SHA-512("ecvrf-expand-v1" || beta || encode(path) || u64_be(i))`, where `encode(path)` is length-prefixed so distinct path arrays can never collide. Anyone with the same `beta` and the same `path` reconstructs byte-identical values — that's what makes expanded outcomes verifiable, not just the raw `beta`. The `ecvrf-expand-v1` tag is disjoint from the RFC 9381 §5.2 `proof_to_hash` domain, so a stream value can never collide with another VRF's `beta`.

## API reference

All functions are **synchronous**. Byte arrays are `Uint8Array`.

### VRF core

| Export | Signature | Notes |
|---|---|---|
| `generateKeyPair()` | `() => { sk: Uint8Array; pk: Uint8Array }` | Fresh keypair. `sk` = 32-byte Ed25519 seed, `pk` = 32-byte compressed public point `Y = x·B` (RFC 8032 §5.1.5). |
| `publicKeyFromSeed(sk)` | `(sk: Uint8Array) => Uint8Array` | Derive the 32-byte public key from an existing 32-byte seed. |
| `deriveScalar(sk)` | `(sk: Uint8Array) => { x: bigint; Y: Point }` | Low-level: the clamped secret scalar `x` (reduced mod the group order) and the public point `Y`. |
| `proveVRF(sk, alpha)` | `(sk: Uint8Array, alpha: Uint8Array) => { proof: Uint8Array; gamma: Uint8Array }` | RFC 9381 §5.1. Returns the **80-byte** proof `pi = Gamma‖c‖s` and the 32-byte encoded `Gamma`. |
| `verifyVRF(pk, alpha, proof)` | `(pk: Uint8Array, alpha: Uint8Array, proof: Uint8Array) => boolean` | RFC 9381 §5.3. `true` iff the proof is valid. Returns `false` (never throws) on wrong lengths, non-canonical/small-order points, `s ≥ q`, or a failed challenge. |
| `vrfProofToHash(proof)` | `(proof: Uint8Array) => Uint8Array` | RFC 9381 §5.2. Returns the **64-byte** `beta`. **Throws** if `proof` isn't 80 bytes or `Gamma` isn't a prime-order point. |

> `verifyVRF` and `vrfProofToHash` are independent: verify gates on `(pk, alpha)`; `proof_to_hash` only needs the proof. A correct pipeline calls `verifyVRF` first and only trusts `beta` once it returns `true`.

### Stream expander

`vrfStream(beta, ...path): VrfStream` — open a deterministic stream. **Throws** if `beta` isn't 64 bytes.

The returned `VrfStream` is stateful (each draw advances the cursor):

| Method | Signature | Behavior |
|---|---|---|
| `nextBytes(n)` | `(n: number) => Uint8Array` | `n` raw bytes. |
| `nextU32()` | `() => number` | Unsigned 32-bit integer. |
| `nextU64()` | `() => bigint` | Unsigned 64-bit integer. |
| `nextRange(minInclusive, maxExclusive)` | `(min: number, max: number) => number` | Unbiased integer in `[min, max)` via rejection sampling. Bounds must be integers, `max > min`, range ≤ 2³². |
| `nextFloat()` | `() => number` | Float in `[0, 1)` with 53 bits of precision. |
| `pick(arr)` | `<T>(arr: readonly T[]) => T` | Uniform element. Throws on empty array. |
| `shuffle(arr)` | `<T>(arr: readonly T[]) => T[]` | Unbiased Fisher–Yates; returns a **new** array (input untouched). |
| `fork(...label)` | `(...label: string[]) => VrfStream` | Independent sub-stream at the extended path. |
| `beta` / `path` | `readonly Uint8Array` / `readonly string[]` | The stream's inputs (defensive copies). |

### Encoding helpers & constants

Byte/bigint utilities: `bytesToHex`, `hexToBytes`, `concatBytes`, `bytesEqual`, `bytesToBigIntBE`, `bytesToBigIntLE`, `bigIntToBytesBE`, `bigIntToBytesLE`.

Suite constants: `SUITE_STRING` (`0x03`), `PROOF_LEN` (`80`), `PT_LEN` (`32`), `Q_LEN` (`32`), `C_LEN` (`16`), `HASH_LEN` (`64`).

## Conformance & validation

This implementation follows RFC 9381 strictly for the Ed25519-SHA512-TAI suite:

- **§5.1 `ECVRF_prove`**, **§5.3 `ECVRF_verify`**, **§5.2 `ECVRF_proof_to_hash`**
- **§5.4.1.1 `encode_to_curve`** using the try-and-increment (TAI) method
- **§5.4.2 / §5.4.3** challenge and nonce generation
- Little-endian `int_to_string` / `string_to_int` per the Ed25519 suite (§5.5)

Verification rejects small-order and non-torsion-free points and requires `s < q`, matching the §5.3 validation gates. The test suite checks the published RFC 9381 §A.4 vectors byte-for-byte and cross-validates `prove`/`verify`/`proof_to_hash` against the independent Rust `vrf-rfc9381` crate, so a proof produced here verifies under that reference and vice versa.

```bash
pnpm --filter @collectorcrypt/ecvrf test
```

## Security notes

- **Keep `sk` secret.** It's a 32-byte Ed25519 seed; anyone with it can produce proofs as you.
- **Always `verifyVRF` before trusting a proof**, then derive `beta` with `vrfProofToHash`. Never trust a `beta` from an unverified proof.
- **`alpha` must be exact.** Verification is over the precise `alpha` bytes; a different encoding is a different input and won't verify.
- This is application-level Ed25519 curve math (not constant-time across every path); it's designed for VRF prove/verify, not as a general signing library.

## Related

- [`@collectorcrypt/vrf-client`](https://www.npmjs.com/package/@collectorcrypt/vrf-client) — TypeScript SDK that commits and verifies these proofs against the cc-vrf Solana program (and re-exports `proveVRF`, `verifyVRF`, `vrfProofToHash`, etc.).
- [cc-vrf monorepo](https://github.com/collectorcrypt/cc-vrf) — the full on-chain VRF system, security model, and cost comparison.

## License

MIT.
