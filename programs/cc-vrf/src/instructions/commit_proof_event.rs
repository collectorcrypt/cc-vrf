use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    constants::ADDRESS_TREE_V2,
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::{account_meta::CompressedAccountMetaReadOnly, ValidityProof},
};

use crate::errors::VrfError;
use crate::events::VrfProofCommitted;
use crate::state::VrfAuthority;
use crate::LIGHT_CPI_SIGNER;

/// Event-mode commit: proves the authority read-only and emits a
/// `VrfProofCommitted` log entry instead of creating a compressed PDA. It still
/// skips the new-address/state-tree output, but it now requires the same frozen
/// authority check as the registry modes.
///
/// Trade-off: no on-chain replay protection. The seed-derived PDA was
/// previously enforcing memo uniqueness; with events, that becomes a
/// verifier-side rule (detect duplicate `memo_hash`es and prefer the proof
/// that satisfies the VRF math).
///
/// The signer is the owner of the authority the event references. The supplied
/// label must match the authority data and the seed-derived authority address.
#[derive(Accounts)]
pub struct CommitProofEvent<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn commit_proof_event_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CommitProofEvent<'info>>,
    proof: ValidityProof,
    authority_account_meta: CompressedAccountMetaReadOnly,
    current_authority: VrfAuthority,
    label: [u8; 32],
    memo_hash: [u8; 32],
    proof_hash: [u8; 32],
    alpha_hash: [u8; 32],
) -> Result<()> {
    let owner_key = ctx.accounts.owner.key();
    require!(current_authority.owner == owner_key, VrfError::NotOwner);
    require!(
        current_authority.label == label,
        VrfError::AuthorityLabelMismatch
    );
    require!(current_authority.frozen, VrfError::AuthorityNotFrozen);
    require!(!current_authority.revoked, VrfError::AuthorityRevoked);

    let address_tree_pubkey = Pubkey::new_from_array(ADDRESS_TREE_V2);
    let (authority_address, _) = derive_address(
        &[VrfAuthority::SEED_PREFIX, owner_key.as_ref(), label.as_ref()],
        &address_tree_pubkey,
        &crate::ID,
    );
    require!(
        authority_account_meta.address == authority_address,
        VrfError::AuthorityAddressMismatch
    );

    let cpi_accounts = CpiAccounts::new(
        ctx.accounts.owner.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );
    let tree_pubkeys = cpi_accounts
        .tree_pubkeys()
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let auth_readonly = LightAccount::<VrfAuthority>::new_read_only(
        &crate::ID,
        &authority_account_meta,
        current_authority,
        &tree_pubkeys,
    )?;

    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(auth_readonly)?
        .invoke(cpi_accounts)?;

    emit!(VrfProofCommitted {
        owner: owner_key,
        label,
        memo_hash,
        proof_hash,
        alpha_hash,
        committed_slot: Clock::get()?.slot,
    });
    Ok(())
}
