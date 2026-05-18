use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    address::v2::derive_address,
    constants::ADDRESS_TREE_V2,
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::{PackedAddressTreeInfo, ValidityProof},
    PackedAddressTreeInfoExt,
};

use crate::errors::VrfError;
use crate::state::{VrfAuthority, SUITE_EDWARDS25519_SHA512_TAI};
use crate::LIGHT_CPI_SIGNER;

#[derive(Accounts)]
pub struct InitAuthority<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

pub fn init_authority_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, InitAuthority<'info>>,
    proof: ValidityProof,
    address_tree_info: PackedAddressTreeInfo,
    output_state_tree_index: u8,
    pk: [u8; 32],
    suite: u8,
    label: [u8; 32],
) -> Result<()> {
    require!(suite == SUITE_EDWARDS25519_SHA512_TAI, VrfError::UnsupportedSuite);

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

    let owner_key = ctx.accounts.owner.key();
    let (address, address_seed) = derive_address(
        &[VrfAuthority::SEED_PREFIX, owner_key.as_ref(), label.as_ref()],
        &address_tree_pubkey,
        &crate::ID,
    );

    let new_address_params =
        address_tree_info.into_new_address_params_assigned_packed(address_seed, Some(0));

    let mut authority = LightAccount::<VrfAuthority>::new_init(
        &crate::ID,
        Some(address),
        output_state_tree_index,
    );
    authority.owner = owner_key;
    authority.pk = pk;
    authority.suite = suite;
    authority.frozen = false;
    authority.revoked = false;
    authority.label = label;
    authority.created_slot = Clock::get()?.slot;

    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(authority)?
        .with_new_addresses(&[new_address_params])
        .invoke(cpi_accounts)?;

    Ok(())
}
