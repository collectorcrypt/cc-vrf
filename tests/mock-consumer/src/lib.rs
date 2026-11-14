//! Test-only consumer: settles a request from (proof, beta, index, path) against a cc-vrf root ring, the way the
//! cc-vrf-verify docs tell integrators to. Never deployed.
#![allow(unexpected_cfgs)]
#![allow(deprecated)]
use anchor_lang::prelude::*;
use cc_vrf_verify::{ring, verify_leaf_v1, LeafV1, Sha256Hasher};

declare_id!("3DNWhK6eyoo7qJSeYJmp4Aij6TBN6LgmH4LRoPp49K8p");

/// SHA-256 through the sol_sha256 syscall.
struct Syscall;
impl Sha256Hasher for Syscall {
    fn hashv(parts: &[&[u8]]) -> [u8; 32] {
        anchor_lang::solana_program::hash::hashv(parts).to_bytes()
    }
}

#[program]
pub mod mock_consumer {
    use super::*;

    /// Copies a live ring entry so later settlement survives its eviction.
    pub fn latch(ctx: Context<Latch>, authority: [u8; 32], seq: u64) -> Result<()> {
        let e = live_entry(&ctx.accounts.ring, &authority, seq)?;
        let l = &mut ctx.accounts.latched;
        (l.authority, l.seq, l.root, l.count) = (authority, seq, e.root, e.count);
        Ok(())
    }

    /// Settles once per alpha, against the latched entry when given, else the live ring entry.
    /// `alpha_hash` keys the settled PDA (plain seeds keep Anchor's IDL build working); it must hash `alpha`.
    #[allow(clippy::too_many_arguments)]
    pub fn settle(
        ctx: Context<Settle>,
        authority: [u8; 32],
        seq: u64,
        index: u64,
        alpha_hash: [u8; 32],
        memo: Vec<u8>,
        alpha: Vec<u8>,
        proof: [u8; 80],
        beta: [u8; 64],
        path: Vec<[u8; 32]>,
    ) -> Result<()> {
        require!(
            anchor_lang::solana_program::hash::hash(&alpha).to_bytes() == alpha_hash,
            ConsumerError::AlphaHashMismatch
        );
        let (root, count) = match &ctx.accounts.latched {
            Some(l) => {
                require!(
                    l.authority == authority && l.seq == seq,
                    ConsumerError::WrongLatch
                );
                (l.root, l.count)
            }
            None => {
                let e = live_entry(&ctx.accounts.ring, &authority, seq)?;
                (e.root, e.count)
            }
        };
        let fields = LeafV1 {
            memo: &memo,
            alpha: &alpha,
            proof: &proof,
            beta: &beta,
        };
        require!(
            verify_leaf_v1::<Syscall>(&root, u64::from(count), index, &fields, &path),
            ConsumerError::NotInBatch
        );
        let s = &mut ctx.accounts.settled;
        s.beta = beta;
        Ok(())
    }
}

fn live_entry(ring_ai: &AccountInfo, authority: &[u8; 32], seq: u64) -> Result<ring::RingEntry> {
    let cc_vrf = Pubkey::new_from_array(ring::CC_VRF_PROGRAM_ID);
    require_keys_eq!(*ring_ai.owner, cc_vrf, ConsumerError::WrongRing);
    let data = ring_ai.try_borrow_data()?;
    let h = ring::header(&data).ok_or(ConsumerError::WrongRing)?;
    let pda = Pubkey::create_program_address(&[ring::RING_SEED, authority, &[h.bump]], &cc_vrf)
        .map_err(|_| ConsumerError::WrongRing)?;
    require_keys_eq!(ring_ai.key(), pda, ConsumerError::WrongRing);
    require!(h.authority == *authority, ConsumerError::WrongRing);
    let e = ring::entry(&data, seq).ok_or(ConsumerError::EntryNotLive)?;
    require!(
        e.leaf_version == cc_vrf_verify::LEAF_VERSION_V1,
        ConsumerError::NotInBatch
    );
    Ok(e)
}

#[derive(Accounts)]
#[instruction(authority: [u8; 32], seq: u64)]
pub struct Latch<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: owner, PDA and layout checked in live_entry.
    pub ring: UncheckedAccount<'info>,
    #[account(init, payer = payer, space = 8 + Latched::INIT_SPACE, seeds = [b"latch".as_ref(), authority.as_ref(), &seq.to_le_bytes()], bump)]
    pub latched: Account<'info, Latched>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(authority: [u8; 32], seq: u64, index: u64, alpha_hash: [u8; 32])]
pub struct Settle<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    /// CHECK: owner, PDA and layout checked in live_entry (unused when a latch is given).
    pub ring: UncheckedAccount<'info>,
    pub latched: Option<Account<'info, Latched>>,
    #[account(init, payer = payer, space = 8 + Settled::INIT_SPACE, seeds = [b"settled".as_ref(), alpha_hash.as_ref()], bump)]
    pub settled: Account<'info, Settled>,
    pub system_program: Program<'info, System>,
}

#[account]
#[derive(InitSpace)]
pub struct Latched {
    pub authority: [u8; 32],
    pub seq: u64,
    pub root: [u8; 32],
    pub count: u32,
}

#[account]
#[derive(InitSpace)]
pub struct Settled {
    pub beta: [u8; 64],
}

#[error_code]
pub enum ConsumerError {
    #[msg("Not the cc-vrf ring of this authority")]
    WrongRing,
    #[msg("Ring entry evicted or never committed")]
    EntryNotLive,
    #[msg("Leaf not in the committed batch")]
    NotInBatch,
    #[msg("Latch is for another authority or sequence")]
    WrongLatch,
    #[msg("alpha_hash is not sha256(alpha)")]
    AlphaHashMismatch,
}
