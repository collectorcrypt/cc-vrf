use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar;
use light_sdk::instruction::{account_meta::CompressedAccountMetaReadOnly, ValidityProof};

use crate::ed25519::{possession_message, verify_single_ed25519};
use crate::events::VrfPossessionAttested;
use crate::instructions::prove_authority::prove_authority_read_only;
use crate::state::{VrfAuthority, VrfPossession, POSSESSION_SEED};

/// Opt-in proof that whoever controls the authority's VRF key signed the exact 114-byte possession message.
/// The PDA's existence is the attestation; it is never closed or rewritten.
#[derive(Accounts)]
#[instruction(label: [u8; 32], proof: ValidityProof, authority_account_meta: CompressedAccountMetaReadOnly)]
pub struct AttestPossession<'info> {
    #[account(mut)]
    pub owner: Signer<'info>,
    #[account(
        init,
        payer = owner,
        space = 8 + VrfPossession::INIT_SPACE,
        seeds = [POSSESSION_SEED, authority_account_meta.address.as_ref()],
        bump,
    )]
    pub attestation: Account<'info, VrfPossession>,
    /// CHECK: pinned to the instructions sysvar; read via load_instruction_at_checked.
    #[account(address = sysvar::instructions::ID)]
    pub instructions: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
}

pub fn attest_possession_handler<'info>(
    ctx: Context<'_, '_, '_, 'info, AttestPossession<'info>>,
    label: [u8; 32],
    proof: ValidityProof,
    authority_account_meta: CompressedAccountMetaReadOnly,
    current_authority: VrfAuthority,
) -> Result<()> {
    let owner = ctx.accounts.owner.key();
    let pk = current_authority.pk;
    // Cheap introspection first; the Light CPI below binds `current_authority` (and so `pk`) to chain state.
    verify_single_ed25519(
        &ctx.accounts.instructions,
        &pk,
        &possession_message(&owner, &label),
    )?;
    let authority = prove_authority_read_only(
        ctx.accounts.owner.as_ref(),
        ctx.remaining_accounts,
        proof,
        &authority_account_meta,
        current_authority,
        &label,
    )?;

    let slot = Clock::get()?.slot;
    let attestation = &mut ctx.accounts.attestation;
    attestation.authority = authority;
    attestation.pk = pk;
    attestation.slot = slot;
    emit!(VrfPossessionAttested {
        authority,
        owner,
        label,
        pk,
        slot
    });
    Ok(())
}
