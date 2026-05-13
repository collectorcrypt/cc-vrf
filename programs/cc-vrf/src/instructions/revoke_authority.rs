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

/// Marks an authority as deprecated. Allowed even after `freeze` —
/// revocation is informational and doesn't mutate the pk, so historical
/// proofs remain verifiable.
#[derive(Accounts)]
pub struct RevokeAuthority<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
}

pub fn revoke_authority_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, RevokeAuthority<'info>>,
    proof: ValidityProof,
    current_authority: VrfAuthority,
    account_meta: CompressedAccountMeta,
) -> Result<()> {
    require!(
        current_authority.owner == ctx.accounts.owner.key(),
        VrfError::NotOwner
    );

    let mut authority =
        LightAccount::<VrfAuthority>::new_mut(&crate::ID, &account_meta, current_authority)?;
    authority.revoked = true;

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
