import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes } from "./encoding";
import {
  COFACTOR,
  HASH_LEN,
  PROOF_LEN,
  PROOF_TO_HASH_DST_BACK,
  PROOF_TO_HASH_DST_FRONT,
  PT_LEN,
  SUITE_STRING,
} from "./suite";

/**
 * RFC 9381 §5.2 ECVRF_proof_to_hash
 *
 *   beta_string = Hash(
 *     suite_string ||
 *     0x03 ||
 *     point_to_string(cofactor * Gamma) ||
 *     0x00
 *   )
 *
 * Returns a 64-byte beta_string (SHA-512 output) per the Ed25519 suite.
 */
export function vrfProofToHash(proof: Uint8Array): Uint8Array {
  if (proof.length !== PROOF_LEN) {
    throw new Error(`proof must be ${PROOF_LEN} bytes`);
  }
  const gammaBytes = proof.slice(0, PT_LEN);
  const Gamma = ed.Point.fromBytes(gammaBytes);
  if (Gamma.isSmallOrder() || !Gamma.isTorsionFree()) {
    throw new Error(
      "proof Gamma must be a non-small-order prime-subgroup point",
    );
  }
  const cofactorGamma = Gamma.multiply(COFACTOR);

  const suite = new Uint8Array([SUITE_STRING]);
  const front = new Uint8Array([PROOF_TO_HASH_DST_FRONT]);
  const back = new Uint8Array([PROOF_TO_HASH_DST_BACK]);
  const beta = sha512(concatBytes(suite, front, cofactorGamma.toBytes(), back));
  if (beta.length !== HASH_LEN) {
    throw new Error("internal: unexpected sha512 output length");
  }
  return beta;
}
