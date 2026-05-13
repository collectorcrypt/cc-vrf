import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToBigIntLE, concatBytes } from "./encoding";
import {
  CHALLENGE_DST_BACK,
  CHALLENGE_DST_FRONT,
  C_LEN,
  SUITE_STRING,
} from "./suite";

/**
 * RFC 9381 §5.4.3 ECVRF_challenge_generation
 *
 *   str = suite_string || 0x02 ||
 *         point_to_string(P1) || point_to_string(P2) || point_to_string(P3) ||
 *         point_to_string(P4) || point_to_string(P5) ||
 *         0x00
 *   c_string = Hash(str)
 *   truncated_c_string = c_string[0..cLen-1]
 *   c = string_to_int(truncated_c_string)
 *
 * For Ed25519-SHA512: cLen = 16. Per RFC 9381 §5.5, string_to_int is
 * little-endian (LSB-first) for the Ed25519 ciphersuite, overriding §3.2.
 * The 5 points are (Y, H, Gamma, U, V).
 */
export function challengeGeneration(
  Y: ed.Point,
  H: ed.Point,
  Gamma: ed.Point,
  U: ed.Point,
  V: ed.Point,
): bigint {
  const suite = new Uint8Array([SUITE_STRING]);
  const front = new Uint8Array([CHALLENGE_DST_FRONT]);
  const back = new Uint8Array([CHALLENGE_DST_BACK]);

  const str = concatBytes(
    suite,
    front,
    Y.toBytes(),
    H.toBytes(),
    Gamma.toBytes(),
    U.toBytes(),
    V.toBytes(),
    back,
  );

  const cString = sha512(str);
  const truncated = cString.slice(0, C_LEN);
  return bytesToBigIntLE(truncated);
}
