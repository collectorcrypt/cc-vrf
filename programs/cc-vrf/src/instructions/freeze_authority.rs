use anchor_lang::prelude::*;
use light_sdk::{
    account::LightAccount,
    cpi::{
        v2::{CpiAccounts, LightSystemProgramCpi},
        InvokeLightSystemProgram, LightCpiInstruction,
    },
    instruction::{account_meta::CompressedAccountMeta, ValidityProof},
};

use crate::errors::VrfError;
use crate::state::VrfAuthority;
use crate::LIGHT_CPI_SIGNER;

#[derive(Accounts)]
pub struct FreezeAuthority<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn freeze_authority_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, FreezeAuthority<'info>>,
    proof: ValidityProof,
    current_authority: VrfAuthority,
    account_meta: CompressedAccountMeta,
) -> Result<()> {
    require!(
        current_authority.owner == ctx.accounts.owner.key(),
        VrfError::NotOwner
    );
    require!(!current_authority.frozen, VrfError::AlreadyFrozen);

    let mut authority =
        LightAccount::<VrfAuthority>::new_mut(&crate::ID, &account_meta, current_authority)?;
    authority.frozen = true;

    let cpi_accounts = CpiAccounts::new(
        ctx.accounts.owner.as_ref(),
        ctx.remaining_accounts,
        LIGHT_CPI_SIGNER,
    );
    LightSystemProgramCpi::new_cpi(LIGHT_CPI_SIGNER, proof)
        .with_light_account(authority)?
        .invoke(cpi_accounts)?;

    Ok(())
}
