use anchor_lang::prelude::*;

/// Event-mode commitment emitted by `commit_proof_event`. Unlike `VrfProofCommit`,
/// this never creates a compressed PDA — it just lives in the transaction log.
///
/// Off-chain verifiers reconstruct the authority address from `(owner, label)`
/// using the same seed derivation as a `VrfAuthority`, then look up the
/// authority's compressed PDA for the published pk / suite / frozen state.
///
/// Replay protection is moved from the chain to the verifier: a malicious
/// operator could emit two events with the same `memo_hash` and different
/// `proof_hash`es. The VRF proof is deterministic given the pk + alpha, so at
/// most one of those would pass ECVRF verification — verifiers must scan for
/// duplicates and pick the canonical commit.
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
