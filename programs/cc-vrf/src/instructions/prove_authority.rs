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
use crate::state::VrfAuthority;
use crate::LIGHT_CPI_SIGNER;

/// The `commit_proof_event` authority checks and read-only Light CPI, shared by the batch, ring and possession
/// instructions (the RC1 handlers keep their own copies). Returns the proven authority address.
#[inline(never)]
pub fn prove_authority_read_only<'info>(
    owner: &AccountInfo<'info>,
    remaining: &[AccountInfo<'info>],
    proof: ValidityProof,
    authority_account_meta: &CompressedAccountMetaReadOnly,
    current_authority: VrfAuthority,
    label: &[u8; 32],
) -> Result<[u8; 32]> {
    let owner_key = owner.key();
    require!(current_authority.owner == owner_key, VrfError::NotOwner);
    require!(
        current_authority.label == *label,
        VrfError::AuthorityLabelMismatch
    );
    require!(current_authority.frozen, VrfError::AuthorityNotFrozen);
    require!(!current_authority.revoked, VrfError::AuthorityRevoked);

    let address_tree_pubkey = Pubkey::new_from_array(ADDRESS_TREE_V2);
    let (authority_address, _) = derive_address(
        &[
            VrfAuthority::SEED_PREFIX,
            owner_key.as_ref(),
            label.as_ref(),
        ],
        &address_tree_pubkey,
        &crate::ID,
    );
    require!(
        authority_account_meta.address == authority_address,
        VrfError::AuthorityAddressMismatch
    );

    let cpi_accounts = CpiAccounts::new(owner, remaining, LIGHT_CPI_SIGNER);
    let tree_pubkeys = cpi_accounts
        .tree_pubkeys()
        .map_err(|_| ProgramError::InvalidAccountData)?;
    let auth_readonly = LightAccount::<VrfAuthority>::new_read_only(
        &crate::ID,
        authority_account_meta,
        current_authority,
        &tree_pubkeys,
    )?;

    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(auth_readonly)?
        .invoke(cpi_accounts)?;
    Ok(authority_address)
}
