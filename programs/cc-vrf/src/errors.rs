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
}
