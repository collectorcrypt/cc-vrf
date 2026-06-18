/**
 * @collector-crypt/ecvrf
 *
 * RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI implementation.
 *
 * Strict compliance with RFC 9381 §5.5 ciphersuite definition and validated
 * against the published test vectors in RFC 9381 §A.4.
 */

export { generateKeyPair, publicKeyFromSeed, deriveScalar } from "./keypair";
export { proveVRF } from "./prove";
export { verifyVRF } from "./verify";
export { vrfProofToHash } from "./proofToHash";
export { vrfStream, type VrfStream } from "./expand";
export {
  bytesToHex,
  hexToBytes,
  concatBytes,
  bytesEqual,
  bytesToBigIntBE,
  bytesToBigIntLE,
  bigIntToBytesBE,
  bigIntToBytesLE,
} from "./encoding";
export {
  SUITE_STRING,
  PROOF_LEN,
  PT_LEN,
  Q_LEN,
  C_LEN,
  HASH_LEN,
} from "./suite";
