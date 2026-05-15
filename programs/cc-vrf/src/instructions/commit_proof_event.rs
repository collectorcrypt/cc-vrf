use anchor_lang::prelude::*;

use crate::events::VrfProofCommitted;

/// Event-mode commit: emits a `VrfProofCommitted` log entry instead of creating
/// a compressed PDA. ~5x cheaper than `commit_proof` because there's no Light
/// CPI, no validity proof, no address-tree slot, and no state-tree slot.
///
/// Trade-off: no on-chain replay protection. The seed-derived PDA was
/// previously enforcing memo uniqueness; with events, that becomes a
/// verifier-side rule (detect duplicate `memo_hash`es and prefer the proof
/// that satisfies the VRF math).
///
/// The signer is implicitly the owner of the authority the event references —
/// verifiers derive `authority_address = derive_address(["vrf_authority",
/// signer, label], ADDRESS_TREE_V2, program_id)` to find the corresponding
/// VrfAuthority record off-chain.
#[derive(Accounts)]
pub struct CommitProofEvent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn commit_proof_event_handler(
    ctx: Context<CommitProofEvent>,
    label: [u8; 32],
    memo_hash: [u8; 32],
    proof_hash: [u8; 32],
    alpha_hash: [u8; 32],
) -> Result<()> {
    emit!(VrfProofCommitted {
        owner: ctx.accounts.owner.key(),
        label,
        memo_hash,
        proof_hash,
        alpha_hash,
        committed_slot: Clock::get()?.slot,
    });
    Ok(())
}
