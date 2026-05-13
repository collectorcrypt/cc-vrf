import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToBigIntLE, concatBytes } from "./encoding";
import { CURVE_ORDER } from "./suite";

/**
 * RFC 9381 §5.4.2.2 ECVRF Nonce Generation From RFC 8032
 *
 * For the EDWARDS25519-SHA512 suites:
 *   hashed_sk_string         = SHA-512(SK)
 *   truncated_hashed_sk      = hashed_sk_string[32..64]
 *   k_string                 = SHA-512(truncated_hashed_sk || h_string)
 *   k                        = string_to_int(k_string) mod q
 *
 * Per RFC 9381 §5.5, the Ed25519 ciphersuite explicitly overrides §3.2:
 * `string_to_int` is little-endian (LSB-first) for ECVRF-EDWARDS25519-*.
 */
export function generateNonce(sk: Uint8Array, hString: Uint8Array): bigint {
  if (sk.length !== 32) {
    throw new Error("SK must be 32 bytes");
  }
  const hashedSk = sha512(sk);
  const truncatedHashedSk = hashedSk.slice(32, 64);
  const kString = sha512(concatBytes(truncatedHashedSk, hString));
  const k = bytesToBigIntLE(kString) % CURVE_ORDER;
  return k;
}
