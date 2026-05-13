import * as ed from "@noble/ed25519";
import { challengeGeneration } from "./challenge";
import { bigIntToBytesLE, concatBytes } from "./encoding";
import { encodeToCurveTAI } from "./hashToCurve";
import { deriveScalar } from "./keypair";
import { generateNonce } from "./nonce";
import { CURVE_ORDER, C_LEN, Q_LEN } from "./suite";

/**
 * RFC 9381 §5.1 ECVRF_prove
 *
 *   1. Derive (x, Y) from SK via RFC 8032
 *   2. H = encode_to_curve(Y_bytes, alpha)
 *   3. Gamma = x * H
 *   4. k = nonce_generation(SK, point_to_string(H))
 *   5. c = challenge_generation(Y, H, Gamma, k*B, k*H)
 *   6. s = (k + c*x) mod q
 *   7. pi = point_to_string(Gamma) || int_to_string(c, cLen) || int_to_string(s, qLen)
 *
 * Returns the 80-byte proof and the encoded Gamma point.
 */
export function proveVRF(
  sk: Uint8Array,
  alpha: Uint8Array,
): { proof: Uint8Array; gamma: Uint8Array } {
  const { x, Y } = deriveScalar(sk);

  const H = encodeToCurveTAI(Y.toBytes(), alpha);
  const hString = H.toBytes();

  const Gamma = H.multiply(x);

  const k = generateNonce(sk, hString);
  // k could be 0 in extremely unlikely cases — would produce U=V=identity.
  // Spec doesn't require handling this since probability is ~2^-252.
  const U = ed.Point.BASE.multiply(k);
  const V = H.multiply(k);

  const c = challengeGeneration(Y, H, Gamma, U, V);

  const s = (k + c * x) % CURVE_ORDER;

  // Per RFC 9381 §5.5, int_to_string is little-endian for Ed25519.
  const proof = concatBytes(
    Gamma.toBytes(),
    bigIntToBytesLE(c, C_LEN),
    bigIntToBytesLE(s, Q_LEN),
  );

  return { proof, gamma: Gamma.toBytes() };
}
