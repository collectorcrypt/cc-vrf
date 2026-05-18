import * as ed from "@noble/ed25519";

/**
 * RFC 9381 §7.5 IANA suite identifier for ECVRF-EDWARDS25519-SHA512-TAI.
 * Note: 0x04 is the ELL2 variant. This package implements TAI only.
 */
export const SUITE_STRING = 0x03;

export const PT_LEN = 32;
export const Q_LEN = 32;
export const C_LEN = 16;
export const PROOF_LEN = PT_LEN + C_LEN + Q_LEN;
export const HASH_LEN = 64;

export const COFACTOR = 8n;

export const CURVE_ORDER = ed.Point.CURVE().n;

export const ENCODE_TO_CURVE_DST_FRONT = 0x01;
export const ENCODE_TO_CURVE_DST_BACK = 0x00;

export const CHALLENGE_DST_FRONT = 0x02;
export const CHALLENGE_DST_BACK = 0x00;

export const PROOF_TO_HASH_DST_FRONT = 0x03;
export const PROOF_TO_HASH_DST_BACK = 0x00;
