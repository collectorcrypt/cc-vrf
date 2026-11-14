import { PublicKey } from "@solana/web3.js";

/**
 * cc-vrf program ID on mainnet and devnet. Upgrades: Squads vault 2Ef85QR7xrGJPdSvFcDz6X9ctqUoSptpi4vsnejpPAZQ (mainnet).
 * Forks pass their own programId to getProgram / the derive helpers.
 */
export const CC_VRF_PROGRAM_ID = new PublicKey(
  "ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ",
);

export const AUTHORITY_SEED = new TextEncoder().encode("vrf_authority");
export const PROOF_COMMIT_SEED = new TextEncoder().encode("vrf_proof");
export const PROOF_COMMIT_WITH_BETA_SEED = PROOF_COMMIT_SEED;

/** RFC 9381 §7.5 IANA suite identifier. */
export const SUITE_EDWARDS25519_SHA512_TAI = 0x03;
