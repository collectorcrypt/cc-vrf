import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToBigIntLE } from "./encoding";
import { CURVE_ORDER } from "./suite";

/**
 * Derive the VRF secret scalar `x` and public point `Y` from an Ed25519
 * seed `SK` (32 bytes), per RFC 8032 §5.1.5.
 *
 *   h = SHA-512(SK)
 *   x_bytes = h[0..32]
 *   clamp(x_bytes):
 *     x_bytes[0]  &= 248      // clear low 3 bits
 *     x_bytes[31] &= 127      // clear high bit
 *     x_bytes[31] |= 64       // set second-highest bit
 *   x = string_to_int(x_bytes) read little-endian
 *   Y = x * B
 */
export function deriveScalar(sk: Uint8Array): {
  x: bigint;
  Y: ed.Point;
} {
  if (sk.length !== 32) {
    throw new Error("SK must be 32 bytes");
  }
  const h = sha512(sk);
  const xBytes = new Uint8Array(h.slice(0, 32));
  xBytes[0] &= 248;
  xBytes[31] &= 127;
  xBytes[31] |= 64;
  // Clamped x for Ed25519 is in [2^254, 2^255), which exceeds the group
  // order q (~2^252). Reduce mod q before scalar multiplication; this is
  // equivalent in the group and required by noble's range check.
  const x = bytesToBigIntLE(xBytes) % CURVE_ORDER;
  const Y = ed.Point.BASE.multiply(x);
  return { x, Y };
}

/**
 * Generate a fresh ECVRF keypair. `sk` is a 32-byte Ed25519 seed; `pk` is the
 * 32-byte compressed point Y = x*B per RFC 8032 §5.1.5.
 */
export function generateKeyPair(): { sk: Uint8Array; pk: Uint8Array } {
  const sk = ed.utils.randomSecretKey();
  const { Y } = deriveScalar(sk);
  return { sk, pk: Y.toBytes() };
}

/**
 * Derive the public key from an existing 32-byte seed.
 */
export function publicKeyFromSeed(sk: Uint8Array): Uint8Array {
  const { Y } = deriveScalar(sk);
  return Y.toBytes();
}
