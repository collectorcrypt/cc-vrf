import { verifyVRF, vrfProofToHash, bytesToHex } from "@collectorcrypt/ecvrf";
import { sha256 } from "@noble/hashes/sha2.js";

/**
 * On-chain commitment record fetched from a VrfProofCommit compressed PDA.
 * Either the consumer fetches this themselves via fetchProofCommit() and
 * passes it in, or they construct it from raw fields if validating offline.
 */
export interface OnChainCommit {
  memoHash: Uint8Array;
  proofHash: Uint8Array;
  alphaHash: Uint8Array;
  committedSlot: bigint | number;
}

export interface VerifyEndToEndInput {
  /** The operator's published VRF public key (32 bytes Ed25519). */
  pk: Uint8Array;
  /** The exact alpha bytes the operator hashed and signed over. */
  alpha: Uint8Array;
  /** The 80-byte VRF proof the operator produced. */
  proof: Uint8Array;
  /** The on-chain commitment row, fetched from the program. */
  onChainCommit: OnChainCommit;
  /** Original memo string/bytes, used to verify the memo hash. */
  memo: string | Uint8Array;
}

export interface VerifyEndToEndResult {
  /**
   * True iff every check passed: ECVRF math, on-chain proof hash, on-chain
   * alpha hash, on-chain memo hash. Any failure flips this false.
   */
  valid: boolean;
  ecvrfValid: boolean;
  proofHashMatches: boolean;
  alphaHashMatches: boolean;
  memoHashMatches: boolean;
  /** SHA-512 (64-byte) beta derived from the proof, present iff `ecvrfValid`. */
  beta: Uint8Array | null;
  reasons: string[];
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Single-call full verification for a VRF outcome that's been committed
 * on-chain. Validates:
 *
 *   1. ECVRF math: `verifyVRF(pk, alpha, proof)` → true
 *   2. sha256(proof) == on-chain commit.proof_hash
 *   3. sha256(alpha) == on-chain commit.alpha_hash
 *   4. sha256(memo)  == on-chain commit.memo_hash
 *
 * If all four hold, the operator cannot have substituted the proof, alpha,
 * or memo after the fact — the result is provably tied to the on-chain
 * commitment.
 */
export function verifyEndToEnd(
  input: VerifyEndToEndInput,
): VerifyEndToEndResult {
  const reasons: string[] = [];

  const ecvrfValid = verifyVRF(input.pk, input.alpha, input.proof);
  if (!ecvrfValid) reasons.push("ecvrf-verify-failed");

  const computedProofHash = sha256(input.proof);
  const proofHashMatches = bytesEqual(
    computedProofHash,
    input.onChainCommit.proofHash,
  );
  if (!proofHashMatches) {
    reasons.push(
      `proof-hash-mismatch (computed=${bytesToHex(computedProofHash)} onchain=${bytesToHex(input.onChainCommit.proofHash)})`,
    );
  }

  const computedAlphaHash = sha256(input.alpha);
  const alphaHashMatches = bytesEqual(
    computedAlphaHash,
    input.onChainCommit.alphaHash,
  );
  if (!alphaHashMatches) reasons.push("alpha-hash-mismatch");

  const memoBytes =
    typeof input.memo === "string"
      ? new TextEncoder().encode(input.memo)
      : input.memo;
  const computedMemoHash = sha256(memoBytes);
  const memoHashMatches = bytesEqual(
    computedMemoHash,
    input.onChainCommit.memoHash,
  );
  if (!memoHashMatches) reasons.push("memo-hash-mismatch");

  const valid =
    ecvrfValid && proofHashMatches && alphaHashMatches && memoHashMatches;
  const beta = ecvrfValid ? vrfProofToHash(input.proof) : null;

  return {
    valid,
    ecvrfValid,
    proofHashMatches,
    alphaHashMatches,
    memoHashMatches,
    beta,
    reasons,
  };
}
