use anchor_lang::prelude::*;

#[error_code]
pub enum VrfError {
    #[msg("Authority is frozen and cannot be modified")]
    AuthorityFrozen,
    #[msg("Authority is already frozen")]
    AlreadyFrozen,
    #[msg("Authority is revoked")]
    AuthorityRevoked,
    #[msg("Signer is not the authority owner")]
    NotOwner,
    #[msg("Label exceeds 32 bytes")]
    LabelTooLong,
    #[msg("Unsupported VRF suite identifier")]
    UnsupportedSuite,
    #[msg("Invalid public key length")]
    InvalidPublicKeyLength,
}
