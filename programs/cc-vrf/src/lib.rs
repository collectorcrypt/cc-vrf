#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use light_sdk::{cpi::CpiSigner, derive_light_cpi_signer};

pub mod errors;
pub mod events;
pub mod instructions;
pub mod state;

pub use events::*;
pub use instructions::*;
pub use state::*;

pub use light_sdk::instruction::{
    account_meta::{CompressedAccountMeta, CompressedAccountMetaReadOnly},
    PackedAddressTreeInfo, ValidityProof,
};

declare_id!("ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ");

/// Compile-time-derived signer the Light system program expects when our
/// program CPIs into it.
pub const LIGHT_CPI_SIGNER: CpiSigner =
    derive_light_cpi_signer!("ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ");

#[program]
pub mod cc_vrf {
    use super::*;

    /// Create a new VrfAuthority compressed PDA owned by signer. The
    /// `(owner, label)` pair determines the PDA address — one owner can
    /// have multiple authorities by varying the label.
    pub fn init_authority<'info>(
        ctx: Context<'_, '_, '_, 'info, InitAuthority<'info>>,
        proof: ValidityProof,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        pk: [u8; 32],
        suite: u8,
        label: [u8; 32],
    ) -> Result<()> {
        instructions::init_authority::init_authority_handler(
            ctx,
            proof,
            address_tree_info,
            output_state_tree_index,
            pk,
            suite,
            label,
        )
    }

    /// One-way: flip `frozen=true`. After this, the pk and suite are
    /// permanent.
    pub fn freeze_authority<'info>(
        ctx: Context<'_, '_, '_, 'info, FreezeAuthority<'info>>,
        proof: ValidityProof,
        current_authority: VrfAuthority,
        account_meta: CompressedAccountMeta,
    ) -> Result<()> {
        instructions::freeze_authority::freeze_authority_handler(
            ctx,
            proof,
            current_authority,
            account_meta,
        )
    }

    /// Sets the `revoked` flag. Informational only — does not change pk.
    pub fn revoke_authority<'info>(
        ctx: Context<'_, '_, '_, 'info, RevokeAuthority<'info>>,
        proof: ValidityProof,
        current_authority: VrfAuthority,
        account_meta: CompressedAccountMeta,
    ) -> Result<()> {
        instructions::revoke_authority::revoke_authority_handler(
            ctx,
            proof,
            current_authority,
            account_meta,
        )
    }

    /// Event-mode commit: proves the frozen authority read-only and emits a
    /// `VrfProofCommitted` log instead of creating a compressed PDA. No
    /// on-chain replay protection — verifiers must detect duplicate memos and
    /// pick the proof that satisfies the VRF math.
    pub fn commit_proof_event<'info>(
        ctx: Context<'_, '_, '_, 'info, CommitProofEvent<'info>>,
        proof: ValidityProof,
        authority_account_meta: CompressedAccountMetaReadOnly,
        current_authority: VrfAuthority,
        label: [u8; 32],
        memo_hash: [u8; 32],
        proof_hash: [u8; 32],
        alpha_hash: [u8; 32],
    ) -> Result<()> {
        instructions::commit_proof_event::commit_proof_event_handler(
            ctx,
            proof,
            authority_account_meta,
            current_authority,
            label,
            memo_hash,
            proof_hash,
            alpha_hash,
        )
    }

    /// Posts a per-VRF-call commitment to a new VrfProofCommit compressed
    /// PDA. Address is `(authority_pda, memo_hash)` — replay-protected by
    /// the PDA itself.
    pub fn commit_proof<'info>(
        ctx: Context<'_, '_, '_, 'info, CommitProof<'info>>,
        proof: ValidityProof,
        authority_account_meta: CompressedAccountMetaReadOnly,
        current_authority: VrfAuthority,
        address_tree_info: PackedAddressTreeInfo,
        output_state_tree_index: u8,
        memo_hash: [u8; 32],
        proof_hash: [u8; 32],
        alpha_hash: [u8; 32],
    ) -> Result<()> {
        instructions::commit_proof::commit_proof_handler(
            ctx,
            proof,
            authority_account_meta,
            current_authority,
            address_tree_info,
            output_state_tree_index,
            memo_hash,
            proof_hash,
            alpha_hash,
        )
    }

    /// Like `commit_proof`, but also stores the 64-byte ECVRF beta output
    /// (split as `beta_lo` + `beta_hi`) in the new compressed PDA. Use this
    /// when another Solana program needs to read the random value directly
    /// via a Light SDK CPI, without going through an off-chain fetch of the
    /// proof bytes. Uses the same seed prefix as `commit_proof` so one memo
    /// can only be committed in one registry mode.
    pub fn commit_proof_with_beta<'info>(
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
        instructions::commit_proof_with_beta::commit_proof_with_beta_handler(
            ctx,
            proof,
            authority_account_meta,
            current_authority,
            address_tree_info,
            output_state_tree_index,
            memo_hash,
            proof_hash,
            alpha_hash,
            beta_lo,
            beta_hi,
        )
    }
}
