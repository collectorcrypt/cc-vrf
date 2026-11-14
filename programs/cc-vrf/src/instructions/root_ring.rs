use anchor_lang::prelude::*;
use light_sdk::instruction::{account_meta::CompressedAccountMetaReadOnly, ValidityProof};

use crate::errors::VrfError;
use crate::events::VrfBatchCommitted;
use crate::instructions::{
    commit_batch_event::check_batch, prove_authority::prove_authority_read_only,
};
use crate::state::{RingEntry, VrfAuthority, VrfRootRing, RING_CAPACITY, RING_SEED, RING_VERSION};

/// One ring per authority, at `["root_ring", authority_address]`. The Light accounts stay in
/// `remaining_accounts`; the ring is always a named account.
#[derive(Accounts)]
#[instruction(label: [u8; 32], proof: ValidityProof, authority_account_meta: CompressedAccountMetaReadOnly)]
pub struct InitRootRing<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + core::mem::size_of::<VrfRootRing>(),
        seeds = [RING_SEED, authority_account_meta.address.as_ref()],
        bump,
    )]
    pub root_ring: AccountLoader<'info, VrfRootRing>,
    pub system_program: Program<'info, System>,
}

pub fn init_root_ring_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, InitRootRing<'info>>,
    label: [u8; 32],
    proof: ValidityProof,
    authority_account_meta: CompressedAccountMetaReadOnly,
    current_authority: VrfAuthority,
) -> Result<()> {
    let authority = prove_authority_read_only(
        ctx.accounts.owner.as_ref(),
        ctx.remaining_accounts,
        proof,
        &authority_account_meta,
        current_authority,
        &label,
    )?;
    let mut ring = ctx.accounts.root_ring.load_init()?;
    ring.version = RING_VERSION;
    ring.bump = ctx.bumps.root_ring;
    ring.capacity = RING_CAPACITY as u16;
    ring.next_seq = 1; // seq 0 marks an empty entry
    ring.authority = authority;
    ring.owner = ctx.accounts.owner.key();
    ring.label = label;
    Ok(())
}

#[derive(Accounts)]
pub struct CommitBatchRing<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(mut)]
    pub root_ring: AccountLoader<'info, VrfRootRing>,
}

/// `commit_batch_event` plus a ring write at `entries[seq % 128]`. `expected_seq` must equal `next_seq`, so a
/// retried transaction cannot insert the same root twice.
#[allow(clippy::too_many_arguments)]
pub fn commit_batch_ring_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CommitBatchRing<'info>>,
    label: [u8; 32],
    root: [u8; 32],
    count: u32,
    leaf_version: u8,
    expected_seq: u64,
    proof: ValidityProof,
    authority_account_meta: CompressedAccountMetaReadOnly,
    current_authority: VrfAuthority,
) -> Result<()> {
    check_batch(&root, count, leaf_version)?;
    {
        let ring = ctx.accounts.root_ring.load()?;
        require!(
            ring.version == RING_VERSION,
            VrfError::UnsupportedRingVersion
        );
        require!(
            ring.authority == authority_account_meta.address,
            VrfError::RingAuthorityMismatch
        );
        require!(ring.next_seq == expected_seq, VrfError::RingSeqMismatch);
    }
    prove_authority_read_only(
        ctx.accounts.owner.as_ref(),
        ctx.remaining_accounts,
        proof,
        &authority_account_meta,
        current_authority,
        &label,
    )?;

    let committed_slot = Clock::get()?.slot;
    {
        let mut ring = ctx.accounts.root_ring.load_mut()?;
        let next = expected_seq
            .checked_add(1)
            .ok_or(VrfError::RingSeqMismatch)?;
        ring.entries[(expected_seq % RING_CAPACITY as u64) as usize] = RingEntry {
            seq: expected_seq,
            slot: committed_slot,
            root,
            count,
            leaf_version,
            _pad: [0; 3],
        };
        ring.next_seq = next;
    }
    emit!(VrfBatchCommitted {
        owner: ctx.accounts.owner.key(),
        label,
        root,
        count,
        leaf_version,
        ring_seq: Some(expected_seq),
        committed_slot,
    });
    Ok(())
}
