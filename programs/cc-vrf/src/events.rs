use anchor_lang::prelude::*;

/// Event-mode commitment emitted by `commit_proof_event`. Unlike `VrfProofCommit`,
/// this never creates a compressed PDA — it just lives in the transaction log.
///
/// Off-chain verifiers reconstruct the authority address from `(owner, label)`
/// using the same seed derivation as a `VrfAuthority`, then look up the
/// authority's compressed PDA for the published pk / suite / frozen state.
///
/// Replay protection is moved from the chain to the verifier: an operator
/// could emit two events with the same `memo_hash` and different
/// `proof_hash`es. ECVRF output is unique per (pk, alpha): every proof that
/// verifies yields the same beta, so duplicates cannot change the result;
/// verifiers match `proof_hash` against the proof they hold.
#[event]
pub struct VrfProofCommitted {
    /// The signer who emitted this commit. Implicitly the authority owner —
    /// off-chain verifiers re-derive the authority address from (owner, label).
    pub owner: Pubkey,
    /// 32-byte authority label, matches the seed used by `VrfAuthority`.
    pub label: [u8; 32],
    pub memo_hash: [u8; 32],
    pub proof_hash: [u8; 32],
    pub alpha_hash: [u8; 32],
    pub committed_slot: u64,
}

/// One Merkle root over `count` VRF results (batch spec v1), from `commit_batch_event` (`ring_seq: None`) or
/// `commit_batch_ring` (`ring_seq: Some(seq)`). Verify a leaf with `count`; see crates/cc-vrf-verify.
#[event]
pub struct VrfBatchCommitted {
    pub owner: Pubkey,
    pub label: [u8; 32],
    pub root: [u8; 32],
    pub count: u32,
    pub leaf_version: u8,
    pub ring_seq: Option<u64>,
    pub committed_slot: u64,
}

/// `attest_possession` succeeded: the VRF key signed the possession message for this authority.
#[event]
pub struct VrfPossessionAttested {
    pub authority: [u8; 32],
    pub owner: Pubkey,
    pub label: [u8; 32],
    pub pk: [u8; 32],
    pub slot: u64,
}
