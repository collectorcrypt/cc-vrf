import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import {
  COFACTOR,
  ENCODE_TO_CURVE_DST_BACK,
  ENCODE_TO_CURVE_DST_FRONT,
  PT_LEN,
  SUITE_STRING,
} from "./suite";
import { concatBytes } from "./encoding";

const MAX_CTR = 256;

/**
 * RFC 9381 §5.4.1.1 ECVRF_encode_to_curve_try_and_increment
 *
 * For ECVRF-EDWARDS25519-SHA512-TAI:
 *   hash_string = SHA-512(
 *     suite_string(0x03) ||
 *     0x01 ||
 *     encode_to_curve_salt ||
 *     alpha_string ||
 *     ctr_byte ||
 *     0x00
 *   )
 *   H_candidate = first 32 bytes of hash_string
 *   try to decode H_candidate as an Ed25519 point
 *   if valid: H = cofactor * H_candidate (clears cofactor)
 *   if H is identity: increment ctr and retry
 *
 * The `encode_to_curve_salt` is the operator's public key per §5.5.
 */
export function encodeToCurveTAI(
  salt: Uint8Array,
  alpha: Uint8Array,
): ed.Point {
  const suiteBytes = new Uint8Array([SUITE_STRING]);
  const frontBytes = new Uint8Array([ENCODE_TO_CURVE_DST_FRONT]);
  const backBytes = new Uint8Array([ENCODE_TO_CURVE_DST_BACK]);

  for (let ctr = 0; ctr < MAX_CTR; ctr++) {
    const ctrBytes = new Uint8Array([ctr]);
    const hashInput = concatBytes(
      suiteBytes,
      frontBytes,
      salt,
      alpha,
      ctrBytes,
      backBytes,
    );
    const hash = sha512(hashInput);
    const candidate = hash.slice(0, PT_LEN);

    let point: ed.Point;
    try {
      point = ed.Point.fromBytes(candidate);
    } catch {
      continue;
    }

    const cleared = point.multiply(COFACTOR);
    if (cleared.equals(ed.Point.ZERO)) continue;

    return cleared;
  }

  throw new Error(
    "encode_to_curve_TAI: exceeded max counter without finding valid point",
  );
}
