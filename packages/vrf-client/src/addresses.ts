import { PublicKey } from "@solana/web3.js";
import {
  batchAddressTree,
  deriveAddressSeedV2,
  deriveAddressV2,
} from "@lightprotocol/stateless.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { AUTHORITY_SEED, PROOF_COMMIT_SEED, PROOF_COMMIT_WITH_BETA_SEED } from "./constants";

/**
 * Derive the compressed-PDA address of a VrfAuthority. This is the address
 * the Light state Merkle tree indexes — NOT a Solana account address.
 *
 * Seeds: ["vrf_authority", owner_pubkey, label_bytes]
 */
export function deriveAuthorityAddress(
  owner: PublicKey,
  label: Uint8Array,
  programId: PublicKey,
): PublicKey {
  if (label.length !== 32) {
    throw new Error("label must be exactly 32 bytes");
  }
  const seed = deriveAddressSeedV2([AUTHORITY_SEED, owner.toBytes(), label]);
  return deriveAddressV2(seed, new PublicKey(batchAddressTree), programId);
}

/**
 * Derive the compressed-PDA address of a VrfProofCommit.
 *
 * Seeds: ["vrf_proof", authority_pubkey, memo_hash]
 */
export function deriveProofCommitAddress(
  authority: PublicKey,
  memoHash: Uint8Array,
  programId: PublicKey,
): PublicKey {
  if (memoHash.length !== 32) {
    throw new Error("memoHash must be exactly 32 bytes");
  }
  const seed = deriveAddressSeedV2([
    PROOF_COMMIT_SEED,
    authority.toBytes(),
    memoHash,
  ]);
  return deriveAddressV2(seed, new PublicKey(batchAddressTree), programId);
}

/**
 * Derive the compressed-PDA address of a VrfProofCommitWithBeta. Uses a
 * different seed prefix so these records live alongside, not on top of,
 * regular VrfProofCommit records — same authority can use both modes for
 * different memos.
 *
 * Seeds: ["vrf_proof_b", authority_pubkey, memo_hash]
 */
export function deriveProofCommitWithBetaAddress(
  authority: PublicKey,
  memoHash: Uint8Array,
  programId: PublicKey,
): PublicKey {
  if (memoHash.length !== 32) {
    throw new Error("memoHash must be exactly 32 bytes");
  }
  const seed = deriveAddressSeedV2([
    PROOF_COMMIT_WITH_BETA_SEED,
    authority.toBytes(),
    memoHash,
  ]);
  return deriveAddressV2(seed, new PublicKey(batchAddressTree), programId);
}

/** Convenience: SHA-256 a UTF-8 memo string. */
export function memoHash(memo: string | Uint8Array): Uint8Array {
  const input = typeof memo === "string" ? new TextEncoder().encode(memo) : memo;
  return sha256(input);
}

/** Convenience: SHA-256 the alpha bytes. */
export function alphaHash(alpha: Uint8Array): Uint8Array {
  return sha256(alpha);
}

/** Convenience: SHA-256 the proof bytes. */
export function proofHash(proof: Uint8Array): Uint8Array {
  return sha256(proof);
}

/**
 * Pad a short utf-8 label to 32 bytes (right-padded with zeroes). Useful for
 * human-readable labels like "gacha" or "lottery".
 */
export function encodeLabel(label: string): Uint8Array {
  const bytes = new TextEncoder().encode(label);
  if (bytes.length > 32) {
    throw new Error(`label "${label}" exceeds 32 bytes encoded`);
  }
  const padded = new Uint8Array(32);
  padded.set(bytes, 0);
  return padded;
}
