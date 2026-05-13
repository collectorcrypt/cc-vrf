use anchor_lang::prelude::*;
use light_sdk::{LightDiscriminator, LightHasher};

/// IANA suite identifier for ECVRF-EDWARDS25519-SHA512-TAI per RFC 9381 §7.5.
pub const SUITE_EDWARDS25519_SHA512_TAI: u8 = 0x03;
/// IANA suite identifier for ECVRF-EDWARDS25519-SHA512-ELL2.
pub const SUITE_EDWARDS25519_SHA512_ELL2: u8 = 0x04;

/// Per-operator authority. Locks a published VRF public key on-chain so the
/// operator cannot silently rotate to a different secret key. The
/// `frozen` flag is one-way: once set, the pk and suite are permanent.
/// `revoked` is informational — a soft-deprecation flag for graceful key
/// rotation (the operator creates a new authority and marks the old one
/// revoked; historical proofs remain verifiable against the old pk).
///
/// Stored as a Light compressed PDA. Seeds:
///   ["vrf_authority", owner_pubkey, label_bytes]
#[event]
#[derive(Clone, Debug, Default, LightDiscriminator, LightHasher)]
pub struct VrfAuthority {
    #[hash]
    pub owner: Pubkey,
    #[hash]
    pub pk: [u8; 32],
    pub suite: u8,
    pub frozen: bool,
    pub revoked: bool,
    #[hash]
    pub label: [u8; 32],
    pub created_slot: u64,
}

impl VrfAuthority {
    pub const SEED_PREFIX: &'static [u8] = b"vrf_authority";
}

/// One per VRF call. Stores a cryptographic commitment to the proof bytes.
/// The actual proof is held off-chain by the operator (in DB or wherever);
/// what lives on-chain is `sha256(proof_bytes)`, plus convenience hashes of
/// the memo and alpha for verifiers.
///
/// Stored as a Light compressed PDA. Seeds:
///   ["vrf_proof", authority_pda_pubkey, memo_hash]
///
/// Memo collision within an authority is impossible because `memo_hash` is
/// part of the seed (also gives free replay protection).
#[event]
#[derive(Clone, Debug, Default, LightDiscriminator, LightHasher)]
pub struct VrfProofCommit {
    #[hash]
    pub authority: Pubkey,
    #[hash]
    pub memo_hash: [u8; 32],
    #[hash]
    pub proof_hash: [u8; 32],
    #[hash]
    pub alpha_hash: [u8; 32],
    pub committed_slot: u64,
}

impl VrfProofCommit {
    pub const SEED_PREFIX: &'static [u8] = b"vrf_proof";
}
