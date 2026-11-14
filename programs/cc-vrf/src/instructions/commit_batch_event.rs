use anchor_lang::prelude::*;
use light_sdk::instruction::{account_meta::CompressedAccountMetaReadOnly, ValidityProof};

use crate::errors::VrfError;
use crate::events::VrfBatchCommitted;
use crate::instructions::prove_authority::prove_authority_read_only;
use crate::state::{VrfAuthority, BATCH_LEAF_VERSION, MAX_BATCH_COUNT};

/// Commits one Merkle root over `count` VRF results (batch spec v1) as a `VrfBatchCommitted` log. No account
/// writes; the authority is proven read-only exactly as in `commit_proof_event`.
#[derive(Accounts)]
pub struct CommitBatchEvent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn check_batch(root: &[u8; 32], count: u32, leaf_version: u8) -> Result<()> {
    require!(count >= 1, VrfError::EmptyBatch);
    require!(count <= MAX_BATCH_COUNT, VrfError::BatchTooLarge);
    require!(
        leaf_version == BATCH_LEAF_VERSION,
        VrfError::UnsupportedLeafVersion
    );
    require!(*root != [0u8; 32], VrfError::ZeroBatchRoot);
    Ok(())
}

#[allow(clippy::too_many_arguments)]
pub fn commit_batch_event_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CommitBatchEvent<'info>>,
    label: [u8; 32],
    root: [u8; 32],
    count: u32,
    leaf_version: u8,
    proof: ValidityProof,
    authority_account_meta: CompressedAccountMetaReadOnly,
    current_authority: VrfAuthority,
) -> Result<()> {
    check_batch(&root, count, leaf_version)?;
    prove_authority_read_only(
        ctx.accounts.owner.as_ref(),
        ctx.remaining_accounts,
        proof,
        &authority_account_meta,
        current_authority,
        &label,
    )?;
    emit!(VrfBatchCommitted {
        owner: ctx.accounts.owner.key(),
        label,
        root,
        count,
        leaf_version,
        ring_seq: None,
        committed_slot: Clock::get()?.slot,
    });
    Ok(())
}
