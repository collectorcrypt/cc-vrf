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
  vrfStream,
  bytesToHex,
  hexToBytes,
} from "@collectorcrypt/ecvrf";
export type { VrfStream } from "@collectorcrypt/ecvrf";

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
  buildCommitProofIx,
  buildCommitProofEventIx,
  buildCommitProofWithBetaIx,
  fetchAuthority,
  fetchProofCommit,
  fetchProofCommitWithBeta,
  fetchProofCommitEvents,
  findProofCommitEvents,
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
  ProofCommitEventQuery,
  ProofCommitEventResult,
} from "./operations";

export {
  verifyEndToEnd,
  verifyAuthorityCommitEndToEnd,
  pickCanonicalCommit,
} from "./verifyEndToEnd";

export { ownProgramDataLines, decodeCcVrfTransaction } from "./logs";
export type { DecodedEvent, DecodedInstruction } from "./logs";

export {
  BATCH_LEAF_VERSION,
  MAX_BATCH_COUNT,
  batchLeafV1,
  batchLeafFromPack,
  batchNode,
  buildBatch,
  verifyInclusion,
  verifyBatchPath,
  buildCommitBatchEventIx,
  findBatchCommits,
  verifyBatchCommitEndToEnd,
} from "./batch";
export type {
  Batch,
  BatchCommit,
  BatchLeafFields,
  CommitBatchInput,
  VerifyBatchCommitInput,
  VerifyBatchCommitResult,
} from "./batch";

export {
  ROOT_RING_SEED,
  RING_CAPACITY,
  RING_ACCOUNT_LEN,
  RING_DISCRIMINATOR,
  deriveRootRingAddress,
  decodeRootRing,
  rootRingEntry,
  fetchRootRing,
  buildInitRootRingIx,
  buildCommitBatchRingIx,
} from "./ring";
export type { RootRing, RootRingEntry } from "./ring";

export {
  POSSESSION_DOMAIN,
  POSSESSION_MESSAGE_LEN,
  POSSESSION_DISCRIMINATOR,
  possessionMessage,
  signPossessionMessage,
  derivePossessionAddress,
  buildAttestPossessionIxs,
  fetchPossession,
} from "./possession";

export type {
  OnChainAuthority,
  OnChainCommit,
  VerifyAuthorityCommitEndToEndInput,
  VerifyAuthorityCommitEndToEndResult,
  VerifyEndToEndInput,
  VerifyEndToEndResult,
  PickCanonicalResult,
} from "./verifyEndToEnd";
