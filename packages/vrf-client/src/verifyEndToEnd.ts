import { verifyVRF, vrfProofToHash, bytesToHex } from "@collectorcrypt/ecvrf";
import { sha256 } from "@noble/hashes/sha2.js";
import { PublicKey } from "@solana/web3.js";
import { deriveAuthorityAddress } from "./addresses";
import { CC_VRF_PROGRAM_ID, SUITE_EDWARDS25519_SHA512_TAI } from "./constants";

export interface OnChainAuthority {
  authorityAddress?: PublicKey;
  owner: PublicKey;
  pk: Uint8Array;
  suite: number;
  frozen: boolean;
  revoked: boolean;
  label: Uint8Array;
}

/**
 * On-chain commitment record fetched from a VrfProofCommit compressed PDA.
 * Either the consumer fetches this themselves via fetchProofCommit() and
 * passes it in, or they construct it from raw fields if validating offline.
 */
export interface OnChainCommit {
  authority?: PublicKey;
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
  /** VRF suite. Omitted means RFC 9381 Ed25519-SHA512-TAI. */
  suite?: number;
}

export interface VerifyEndToEndResult {
  /**
   * True iff every check passed: ECVRF math, on-chain proof hash, on-chain
   * alpha hash, on-chain memo hash. Any failure flips this false.
   */
  valid: boolean;
  ecvrfValid: boolean;
  suiteSupported: boolean;
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
/**
 * Result of picking the canonical commit from a list of events for the same
 * `(authority, memo)`. The "canonical" commit is the unique event whose
 * `proof_hash` matches the SHA-256 of a proof that verifies under ECVRF.
 *
 * Because ECVRF proofs are deterministic for a given (pk, alpha), at most one
 * candidate can have a valid `proof_hash`. Extra events (which the chain
 * allows in event-mode) are simply garbage payloads — detectable, not a
 * successful forgery.
 */
export interface PickCanonicalResult {
  /** The single event whose committed hash matches the verifying proof, or null if none verify. */
  canonical: OnChainCommit | null;
  /** All candidates inspected, in the order supplied. */
  candidates: OnChainCommit[];
  /** Whether more than one event was found for the same memo. Informational. */
  duplicateMemoEvents: boolean;
  /** Whether more than one candidate's `proof_hash` matched a verifying proof (should be impossible if ECVRF is sound). */
  multipleVerifying: boolean;
}

export interface VerifyAuthorityCommitEndToEndInput extends Omit<
  VerifyEndToEndInput,
  "pk" | "suite"
> {
  /** Authority state fetched from the VrfAuthority compressed PDA. */
  authority: OnChainAuthority;
  /** Expected owner for the authority, usually the operator wallet. */
  expectedOwner?: PublicKey;
  /** Expected 32-byte authority label. */
  expectedLabel?: Uint8Array;
  /**
   * Optional sanity check: redundant against the address rederived from
   * `(owner, label)` inside the verifier. If provided, it must match the
   * derived address or `valid` flips false.
   */
  expectedAuthorityAddress?: PublicKey;
  /**
   * Optional program ID override. Defaults to the canonical cc-vrf program
   * ID and only needs to be set for forked deployments.
   */
  programId?: PublicKey;
  /** 64-byte beta fetched from a VrfProofCommitWithBeta account. */
  onChainBeta?: Uint8Array;
}

export interface VerifyAuthorityCommitEndToEndResult extends VerifyEndToEndResult {
  authorityFrozen: boolean;
  authorityNotRevoked: boolean;
  authorityOwnerMatches: boolean;
  authorityLabelMatches: boolean;
  commitAuthorityMatches: boolean;
  betaMatches: boolean | null;
}

/**
 * Resolve which committed event corresponds to a known-valid proof. Use this
 * when fetching event-mode commits where the chain doesn't enforce
 * one-commit-per-memo. Pass in all candidates from `fetchProofCommitEvents`
 * plus the proof bytes the operator gave you; you get back the unique
 * canonical row (or null if none match).
 */
export function pickCanonicalCommit(
  candidates: OnChainCommit[],
  proof: Uint8Array,
): PickCanonicalResult {
  const proofHash = sha256(proof);
  const matching = candidates.filter((c) => bytesEqual(proofHash, c.proofHash));
  return {
    canonical: matching[0] ?? null,
    candidates,
    duplicateMemoEvents: candidates.length > 1,
    multipleVerifying: matching.length > 1,
  };
}

export function verifyEndToEnd(
  input: VerifyEndToEndInput,
): VerifyEndToEndResult {
  const reasons: string[] = [];

  const suite = input.suite ?? SUITE_EDWARDS25519_SHA512_TAI;
  const suiteSupported = suite === SUITE_EDWARDS25519_SHA512_TAI;
  if (!suiteSupported) reasons.push(`unsupported-suite-${suite}`);

  const ecvrfValid =
    suiteSupported && verifyVRF(input.pk, input.alpha, input.proof);
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
    suiteSupported &&
    ecvrfValid &&
    proofHashMatches &&
    alphaHashMatches &&
    memoHashMatches;
  const beta = ecvrfValid ? vrfProofToHash(input.proof) : null;

  return {
    valid,
    ecvrfValid,
    suiteSupported,
    proofHashMatches,
    alphaHashMatches,
    memoHashMatches,
    beta,
    reasons,
  };
}

export function verifyAuthorityCommitEndToEnd(
  input: VerifyAuthorityCommitEndToEndInput,
): VerifyAuthorityCommitEndToEndResult {
  const base = verifyEndToEnd({
    pk: input.authority.pk,
    suite: input.authority.suite,
    alpha: input.alpha,
    proof: input.proof,
    onChainCommit: input.onChainCommit,
    memo: input.memo,
  });
  const reasons = [...base.reasons];

  const authorityFrozen = input.authority.frozen;
  if (!authorityFrozen) reasons.push("authority-not-frozen");

  const authorityNotRevoked = !input.authority.revoked;
  if (!authorityNotRevoked) reasons.push("authority-revoked");

  const authorityOwnerMatches = input.expectedOwner
    ? input.authority.owner.equals(input.expectedOwner)
    : true;
  if (!authorityOwnerMatches) reasons.push("authority-owner-mismatch");

  const authorityLabelMatches = input.expectedLabel
    ? bytesEqual(input.authority.label, input.expectedLabel)
    : true;
  if (!authorityLabelMatches) reasons.push("authority-label-mismatch");

  // Always rederive the canonical authority address from (owner, label) and
  // require the commit to point at it. This closes the prior footgun where a
  // hand-built OnChainAuthority + missing expectedAuthorityAddress silently
  // skipped the commit-to-authority binding.
  const programId = input.programId ?? CC_VRF_PROGRAM_ID;
  const derivedAuthorityAddress = deriveAuthorityAddress(
    input.authority.owner,
    input.authority.label,
    programId,
  );
  const commitAuthority = input.onChainCommit.authority;
  const commitAuthorityMatches =
    commitAuthority?.equals(derivedAuthorityAddress) === true;
  if (!commitAuthorityMatches) {
    reasons.push(
      commitAuthority
        ? "commit-authority-mismatch"
        : "commit-authority-missing",
    );
  }

  // If the caller passed their own expectedAuthorityAddress, it must also
  // match the derived one — otherwise the caller's expectation contradicts
  // the (owner, label) they supplied.
  const expectedAuthorityMatchesDerived = input.expectedAuthorityAddress
    ? input.expectedAuthorityAddress.equals(derivedAuthorityAddress)
    : true;
  if (!expectedAuthorityMatchesDerived) {
    reasons.push("expected-authority-address-mismatch");
  }

  const betaMatches = input.onChainBeta
    ? base.beta !== null && bytesEqual(input.onChainBeta, base.beta)
    : null;
  if (betaMatches === false) reasons.push("beta-mismatch");

  const valid =
    base.valid &&
    authorityFrozen &&
    authorityNotRevoked &&
    authorityOwnerMatches &&
    authorityLabelMatches &&
    commitAuthorityMatches &&
    expectedAuthorityMatchesDerived &&
    betaMatches !== false;

  return {
    ...base,
    valid,
    reasons,
    authorityFrozen,
    authorityNotRevoked,
    authorityOwnerMatches,
    authorityLabelMatches,
    commitAuthorityMatches,
    betaMatches,
  };
}
