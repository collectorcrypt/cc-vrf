import * as ed from "@noble/ed25519";
import { challengeGeneration } from "./challenge";
import { bytesToBigIntLE } from "./encoding";
import { encodeToCurveTAI } from "./hashToCurve";
import { CURVE_ORDER, C_LEN, PROOF_LEN, PT_LEN, Q_LEN } from "./suite";

/**
 * RFC 9381 §5.3 ECVRF_verify
 *
 *   1. (Gamma, c, s) = decode_proof(pi)
 *   2. H = encode_to_curve(Y_bytes, alpha)
 *   3. U = s*B - c*Y
 *   4. V = s*H - c*Gamma
 *   5. c' = challenge_generation(Y, H, Gamma, U, V)
 *   6. accept iff c == c'
 *
 * Validation gates added per §5.3:
 *   - proof length is exactly 80
 *   - Gamma decodes to a valid Ed25519 point
 *   - s < q (otherwise reject)
 *   - Y decodes to a valid Ed25519 point
 */
export function verifyVRF(
  pk: Uint8Array,
  alpha: Uint8Array,
  proof: Uint8Array,
): boolean {
  if (proof.length !== PROOF_LEN) return false;
  if (pk.length !== PT_LEN) return false;

  const gammaBytes = proof.slice(0, PT_LEN);
  const cBytes = proof.slice(PT_LEN, PT_LEN + C_LEN);
  const sBytes = proof.slice(PT_LEN + C_LEN, PROOF_LEN);

  // Per RFC 9381 §5.5, string_to_int is little-endian for Ed25519.
  const c = bytesToBigIntLE(cBytes);
  const s = bytesToBigIntLE(sBytes);
  if (s >= CURVE_ORDER) return false;

  let Y: ed.Point;
  let Gamma: ed.Point;
  try {
    Y = ed.Point.fromBytes(pk);
    Gamma = ed.Point.fromBytes(gammaBytes);
  } catch {
    return false;
  }
  if (Y.isSmallOrder() || !Y.isTorsionFree()) return false;
  if (Gamma.isSmallOrder() || !Gamma.isTorsionFree()) return false;

  const H = encodeToCurveTAI(pk, alpha);

  // U = s*B - c*Y. Guard zero-scalar multiply (noble rejects n=0 in safe mode).
  const sB = s === 0n ? ed.Point.ZERO : ed.Point.BASE.multiply(s);
  const cY = c === 0n ? ed.Point.ZERO : Y.multiply(c);
  const U = sB.subtract(cY);

  // V = s*H - c*Gamma
  const sH = s === 0n ? ed.Point.ZERO : H.multiply(s);
  const cGamma = c === 0n ? ed.Point.ZERO : Gamma.multiply(c);
  const V = sH.subtract(cGamma);

  const cPrime = challengeGeneration(Y, H, Gamma, U, V);
  return c === cPrime;
}
