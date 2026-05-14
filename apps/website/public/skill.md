---
name: cc-vrf
description: Add Collector Crypt VRF — permissionless on-chain verifiable randomness for Solana, ~$0.0002 per call via Light Protocol compressed PDAs — to a Solana project. Use for dice rolls, NFT trait assignment, lottery draws, validator selection, or any onchain randomness where consumers need to verify the draw after the fact.
license: MIT
---

# cc-vrf · Verifiable Random Function for Solana

## What it is

**cc-vrf** is a standalone on-chain VRF system on Solana. Operators run RFC 9381 ECVRF (Ed25519, SHA-512, TAI variant) off-chain; an Anchor program locks each operator's public key on-chain and stores `sha256(proof)` per VRF call as a Light Protocol compressed PDA.

- **~$0.0002 per call** (batched) / ~$0.004 standalone
- **Permissionless** — no oracle network, no token, no subscription
- **Verifiable by anyone** — fetch the on-chain commit, fetch the operator-published proof, run `verifyEndToEnd` to confirm four invariants (ECVRF valid + proof/alpha/memo hashes match)
- **No on-chain cryptography** — the program only stores hashes; randomness is computed off-chain

## When to use it

- You need verifiable randomness on Solana and care about per-call cost.
- You're running an operator (you, your backend, an enclave, an MPC group) and want consumers to be able to audit any past draw.
- You want sub-second latency. The operator can produce a fresh proof and commit it in the same Solana tx context.

## When NOT to use it

- You want a fully on-chain randomness source with no off-chain operator. cc-vrf trusts the operator to honestly produce proofs (the on-chain commits make any deviation detectable, but the operator could in principle withhold). Use a threshold/MPC ECVRF setup if you need stronger guarantees.
- You're on EVM. cc-vrf is Solana-only.
- You need shared-state randomness consumed by many apps simultaneously. The model is one-operator-per-app or one-operator-as-service.

## Architecture

Two compressed PDAs:

| PDA | Seeds | Purpose |
|---|---|---|
| `VrfAuthority` | `["vrf_authority", owner_pubkey, label_bytes]` | Per-operator pubkey + suite + freeze/revoke flags. One owner can have many authorities by varying `label`. |
| `VrfProofCommit` | `["vrf_proof", authority_pda, memo_hash]` | Per-VRF-call commitment: `sha256(proof)`, `sha256(alpha)`, `sha256(memo)`, slot. Memo collision impossible by construction (memo_hash is part of the seed). |

Four instructions: `init_authority`, `freeze_authority`, `revoke_authority`, `commit_proof`.

## Add to your project

### 1. Install

```bash
pnpm add @collectorcrypt/vrf-client @lightprotocol/stateless.js \
        @coral-xyz/anchor @solana/web3.js @noble/hashes
```

If installing from source (packages not yet on npm):

```bash
git clone https://github.com/daxherrera/cc-vrf.git
cd cc-vrf && pnpm install
pnpm --filter @collectorcrypt/ecvrf build
pnpm --filter @collectorcrypt/vrf-client build
# then `pnpm link` from those package dirs, or use a workspace dep.
```

### 2. Pick an RPC

You need a Solana RPC that **also serves Light Photon** (the compressed-PDA indexer). Helius and Triton both do, on every cluster. The public `api.devnet.solana.com` does NOT serve Photon — `getValidityProofV0` will fail there.

```ts
import { createRpc } from "@lightprotocol/stateless.js";
const rpc = createRpc(HELIUS_URL, HELIUS_URL); // same URL serves both
```

### 3. Operator setup (one-time, per `(owner, label)` pair)

```ts
import {
  generateKeyPair,
  buildInitAuthorityIx,
  buildFreezeAuthorityIx,
  SUITE_EDWARDS25519_SHA512_TAI,
  getProgram,
} from "@collectorcrypt/vrf-client";
import * as anchor from "@coral-xyz/anchor";

// Operator keypair — store the secret somewhere safe (env var, KMS, etc.).
const { sk, pk } = generateKeyPair();

const provider = new anchor.AnchorProvider(connection, wallet, {
  commitment: "confirmed",
});
const program = getProgram(provider);

// Lock the public key on-chain (~$0.00001 + tx fee).
const { ix, authorityAddress } = await buildInitAuthorityIx(program, rpc, {
  owner: wallet.publicKey,
  pk,
  suite: SUITE_EDWARDS25519_SHA512_TAI,
  label: "my-app",
});
await provider.sendAndConfirm(new Transaction().add(ix), []);

// Optional but recommended for production: freeze the authority so the pk
// can never be changed (only one direction — no unfreeze).
const fr = await buildFreezeAuthorityIx(program, rpc, {
  owner: wallet.publicKey,
  label: "my-app",
});
await provider.sendAndConfirm(new Transaction().add(fr), []);
```

### 4. Per-call: prove + commit

```ts
import { sha256 } from "@noble/hashes/sha2.js";
import {
  proveVRF,
  vrfProofToHash,
  bytesToHex,
  buildCommitProofIx,
} from "@collectorcrypt/vrf-client";

async function rollFor(requestId: string) {
  // Alpha is whatever you want bound to this draw. Hash a memo with sha256
  // so it's 32 bytes — common patterns: request id, slot, user pubkey.
  const memo = `req-${requestId}`;
  const alpha = sha256(new TextEncoder().encode(memo));

  // 1. Off-chain: prove.
  const { proof } = proveVRF(sk, alpha);     // 80 bytes
  const beta = vrfProofToHash(proof);        // 64 bytes — your random output

  // 2. On-chain: commit sha256(proof) + sha256(alpha) + sha256(memo).
  const { ix, commitAddress } = await buildCommitProofIx(program, rpc, {
    owner: wallet.publicKey,
    label: "my-app",
    memo,
    alpha,
    proof,
  });
  await provider.sendAndConfirm(new Transaction().add(ix), []);

  // 3. Return proof + beta to the caller. They use this to verify later.
  return {
    memo,
    alpha: bytesToHex(alpha),
    proof: bytesToHex(proof),
    beta: bytesToHex(beta),
    commitAddress: commitAddress.toBase58(),
  };
}

// Map beta to your domain outcome.
const rollValue = Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1; // 1..100
```

### 5. Verifier side (anyone with the proof)

```ts
import {
  fetchAuthority,
  fetchProofCommit,
  verifyEndToEnd,
  hexToBytes,
} from "@collectorcrypt/vrf-client";

const auth = await fetchAuthority(program, rpc, operatorPubkey, "my-app");
const commit = await fetchProofCommit(program, rpc, auth.authorityAddress, memo);

const result = verifyEndToEnd({
  pk: Uint8Array.from(auth.decoded.pk),
  alpha: hexToBytes(alphaHex),
  proof: hexToBytes(proofHex),
  memo,
  onChainCommit: commit.onChainCommit,
});

// result.valid is true only if all four invariants hold:
//   ecvrfValid && proofHashMatches && alphaHashMatches && memoHashMatches
```

## Server-side operator (production pattern)

Run the operator as a serverless function (Vercel/Lambda/Cloudflare Worker) or daemon. Hold the secret key in `VRF_SECRET_KEY_HEX` (or KMS/Nitro Enclave for higher assurance). The endpoint returns `{ memo, alpha, proof, beta, commitAddress, txSignature }` to the caller; the caller verifies independently.

```ts
// Vercel Route Handler (pseudocode)
export async function POST(req: Request) {
  const { requestId } = await req.json();
  const sk = hexToBytes(process.env.VRF_SECRET_KEY_HEX!);
  // ... proveVRF + buildCommitProofIx + provider.sendAndConfirm ...
  return Response.json({ memo, alpha, proof, beta, txSignature });
}
```

## Trust model

- Trust the operator who locked the pk to honestly produce proofs.
- The on-chain commits make any deviation cryptographically detectable: silent key rotation is impossible (pk is locked), and proof withholding leaves an empty commit address that consumers can flag.
- The program itself does **two things only**: lock public keys, and store proof hashes. It does not custody keys or run cryptography.

## Common pitfalls

- **`Blockhash invalid` from wallet adapters**: the wallet's preflight RPC lags Helius. Fetch a `finalized` blockhash before signing.
- **`getValidityProofV0` fails**: your RPC doesn't serve Light Photon. Use a Helius/Triton endpoint, not the public Solana RPC.
- **`Buffer is not defined` in the browser**: install `buffer` and bind it: `globalThis.Buffer = Buffer`.
- **Authority already exists**: an `init_authority` call for an existing `(owner, label)` fails. Use a different label or accept the existing one.
- **memo collision**: the commit PDA's seed includes `sha256(memo)`. Same memo twice = same address = second commit fails. Use unique memos (request id, slot, etc.) — that's the replay protection, by design.

## Reference

- **Program ID:** `ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ` (same on devnet + mainnet)
- **Cluster:** devnet (mainnet pending)
- **Source:** https://github.com/daxherrera/cc-vrf
- **Spec:** RFC 9381 §5.5 (ECVRF-EDWARDS25519-SHA512-TAI, suite identifier `0x03`)
- **Compressed PDA backend:** Light Protocol v2 (`@lightprotocol/stateless.js` 0.23.x)
- **Tests:** 47 ECVRF interop + structure + negative-case tests (byte-exact vs the Rust reference impl), plus 16 SDK unit tests.

## Cost reference (per single VRF call)

- cc-vrf batched: **~$0.0002**
- cc-vrf standalone: ~$0.004
- ORAO VRF (Solana): ~$0.10
- Switchboard On-Demand VRF (Solana): ~$0.19
- Chainlink VRF v2.5 (Arbitrum): ~$0.15
- Chainlink VRF v2.5 (Ethereum L1): ~$2.00

(Pricing as of 2026-05-12. Pyth Entropy is EVM-only — not on Solana mainnet.)
