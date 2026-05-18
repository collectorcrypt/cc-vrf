use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    constants::ADDRESS_TREE_V2,
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::{
        account_meta::CompressedAccountMetaReadOnly, PackedAddressTreeInfo, ValidityProof,
    },
    PackedAddressTreeInfoExt,
};

use crate::errors::VrfError;
use crate::state::{VrfAuthority, VrfProofCommitWithBeta};
use crate::LIGHT_CPI_SIGNER;

/// Same as `commit_proof`, but also persists the 64-byte ECVRF beta output
/// directly into a compressed PDA. Lets other Solana programs read the
/// random value via Light SDK CPI without needing the proof bytes off-chain.
///
/// Address scheme uses the same seed prefix as `commit_proof`, so one
/// `(authority, memo_hash)` can only be committed in one registry mode.
#[derive(Accounts)]
pub struct CommitProofWithBeta<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn commit_proof_with_beta_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, CommitProofWithBeta<'info>>,
    proof: ValidityProof,
    authority_account_meta: CompressedAccountMetaReadOnly,
    current_authority: VrfAuthority,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    memo_hash: [u8; 32],
    proof_hash: [u8; 32],
    alpha_hash: [u8; 32],
    beta_lo: [u8; 32],
    beta_hi: [u8; 32],
) -> Result<()> {
    require!(
        current_authority.owner == ctx.accounts.owner.key(),
        VrfError::NotOwner
    );
    require!(current_authority.frozen, VrfError::AuthorityNotFrozen);
    require!(!current_authority.revoked, VrfError::AuthorityRevoked);

    let authority_address = Pubkey::new_from_array(authority_account_meta.address);

    let cpi_accounts = CpiAccounts::new(
        ctx.accounts.owner.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );

    let address_tree_pubkey = address_tree_info
        .get_tree_pubkey(&cpi_accounts)
        .map_err(|_| ProgramError::InvalidAccountData)?;
    if address_tree_pubkey.to_bytes() != ADDRESS_TREE_V2 {
        msg!("Invalid address tree");
        return Err(ProgramError::InvalidAccountData.into());
    }

    let (commit_address, address_seed) = derive_address(
        &[
            VrfProofCommitWithBeta::SEED_PREFIX,
            authority_address.as_ref(),
            memo_hash.as_ref(),
        ],
        &address_tree_pubkey,
        &crate::ID,
    );

    let new_address_params =
        address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0));

    let tree_pubkeys = cpi_accounts
        .tree_pubkeys()
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let auth_readonly = LightAccount::<VrfAuthority>::new_read_only(
        &crate::ID,
        &authority_account_meta,
        current_authority,
        &tree_pubkeys,
    )?;

    let mut commit = LightAccount::<VrfProofCommitWithBeta>::new_init(
        &crate::ID,
        Some(commit_address),
        output_state_tree_index,
    );
    commit.authority = authority_address;
    commit.memo_hash = memo_hash;
    commit.proof_hash = proof_hash;
    commit.alpha_hash = alpha_hash;
    commit.beta_lo = beta_lo;
    commit.beta_hi = beta_hi;
    commit.committed_slot = Clock::get()?.slot;

    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(auth_readonly)?
        .with_light_account(commit)?
        .with_new_addresses(&[new_address_params])
        .invoke(cpi_accounts)?;

    Ok(())
}
