import { PublicKey } from "@solana/web3.js";

/**
 * Default mainnet program ID (renounced upgrade authority post-deploy).
 * Override via `new VrfClient({ programId })` for devnet/local testing.
 */
export const CC_VRF_PROGRAM_ID = new PublicKey(
  "5haPNg9hUP6EYXbUM8fWJr38VQQHj8X7ECnAkEctZe2c",
);

export const AUTHORITY_SEED = new TextEncoder().encode("vrf_authority");
export const PROOF_COMMIT_SEED = new TextEncoder().encode("vrf_proof");

/** RFC 9381 §7.5 IANA suite identifier. */
export const SUITE_EDWARDS25519_SHA512_TAI = 0x03;
export const SUITE_EDWARDS25519_SHA512_ELL2 = 0x04;
