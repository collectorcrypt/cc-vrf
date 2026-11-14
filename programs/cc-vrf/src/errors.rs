use anchor_lang::prelude::*;

#[error_code]
pub enum VrfError {
    #[msg("Authority is frozen and cannot be modified")]
    AuthorityFrozen,
    #[msg("Authority is already frozen")]
    AlreadyFrozen,
    #[msg("Authority must be frozen before committing proofs")]
    AuthorityNotFrozen,
    #[msg("Authority is revoked")]
    AuthorityRevoked,
    #[msg("Signer is not the authority owner")]
    NotOwner,
    #[msg("Authority label does not match the requested label")]
    AuthorityLabelMismatch,
    #[msg("Authority address does not match owner and label seeds")]
    AuthorityAddressMismatch,
    #[msg("Label exceeds 32 bytes")]
    LabelTooLong,
    #[msg("Unsupported VRF suite identifier")]
    UnsupportedSuite,
    #[msg("Invalid public key length")]
    InvalidPublicKeyLength,
    // v2 additions, appended so 6000-6009 never move.
    #[msg("Batch count must be at least 1")]
    EmptyBatch,
    #[msg("Batch count exceeds 2^20")]
    BatchTooLarge,
    #[msg("Unsupported batch leaf version")]
    UnsupportedLeafVersion,
    #[msg("Batch root must not be zero")]
    ZeroBatchRoot,
    #[msg("Root ring belongs to a different authority")]
    RingAuthorityMismatch,
    #[msg("Root ring sequence does not match expected_seq")]
    RingSeqMismatch,
    #[msg("Unsupported root ring version")]
    UnsupportedRingVersion,
    #[msg("Missing Ed25519 signature instruction")]
    MissingEd25519Instruction,
    #[msg("More than one Ed25519 signature instruction")]
    MultipleEd25519Instructions,
    #[msg("Malformed Ed25519 signature instruction")]
    MalformedEd25519Instruction,
    #[msg("Ed25519 instruction references another instruction's data")]
    Ed25519IndirectReference,
    #[msg("Ed25519 public key is not the authority's VRF key")]
    PossessionKeyMismatch,
    #[msg("Ed25519 message is not the possession message")]
    PossessionMessageMismatch,
}
