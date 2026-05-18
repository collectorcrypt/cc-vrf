/**
 * @collectorcrypt/vrf-client
 *
 * TypeScript SDK for the cc-vrf on-chain VRF program. Wraps the Anchor IDL,
 * Light Protocol compressed-PDA plumbing, and the RFC 9381 ECVRF library so
 * consumers can publish, commit, and verify VRF proofs with one import.
 */

// Re-export the ECVRF primitives so consumers don't need a second import.
export {
  generateKeyPair,
  publicKeyFromSeed,
  proveVRF,
  verifyVRF,
  vrfProofToHash,
  bytesToHex,
  hexToBytes,
} from "@collectorcrypt/ecvrf";

export { CC_VRF_PROGRAM_ID, SUITE_EDWARDS25519_SHA512_TAI } from "./constants";

export {
  deriveAuthorityAddress,
  deriveProofCommitAddress,
  deriveProofCommitWithBetaAddress,
  memoHash,
  alphaHash,
  proofHash,
  encodeLabel,
} from "./addresses";

export {
  forceLightV2,
  buildCreateContext,
  buildCommitProofContext,
  buildReadOnlyAuthorityContext,
  buildMutateContext,
} from "./light";

export { getProgram } from "./program";

export {
  buildInitAuthorityIx,
  buildFreezeAuthorityIx,
  buildRevokeAuthorityIx,
  buildCommitProofIx,
  buildCommitProofEventIx,
  buildCommitProofWithBetaIx,
  fetchAuthority,
  fetchProofCommit,
  fetchProofCommitWithBeta,
  fetchProofCommitEvents,
  decodeAuthority,
  decodeProofCommit,
  decodeProofCommitWithBeta,
  asTx,
} from "./operations";

export type {
  InitAuthorityInput,
  FreezeAuthorityInput,
  CommitProofInput,
  ProofCommitEvent,
} from "./operations";

export {
  verifyEndToEnd,
  verifyAuthorityCommitEndToEnd,
  pickCanonicalCommit,
} from "./verifyEndToEnd";

export type {
  OnChainAuthority,
  OnChainCommit,
  VerifyAuthorityCommitEndToEndInput,
  VerifyAuthorityCommitEndToEndResult,
  VerifyEndToEndInput,
  VerifyEndToEndResult,
  PickCanonicalResult,
} from "./verifyEndToEnd";
