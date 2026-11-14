//! Ed25519 precompile introspection for `attest_possession` (port of cc-buyback's verifier, 114-byte message).
//! ECVRF and Ed25519 share the SHA-512(sk)[32..64] nonce prefix, so the VRF key must never sign a 32-byte message.
use anchor_lang::prelude::*;
use anchor_lang::solana_program::sysvar::instructions::load_instruction_at_checked;

use crate::errors::VrfError;

pub const ED25519_PROGRAM_ID: Pubkey = pubkey!("Ed25519SigVerify111111111111111111111111111");
pub const POSSESSION_DOMAIN: &[u8; 18] = b"ccvrf-authority-v1";
pub const POSSESSION_MSG_LEN: usize = 18 + 32 + 32 + 32;
const MAX_IX_SCAN: usize = 64;

/// `"ccvrf-authority-v1" ‖ program_id ‖ owner ‖ label`.
pub fn possession_message(owner: &Pubkey, label: &[u8; 32]) -> [u8; POSSESSION_MSG_LEN] {
    let mut m = [0u8; POSSESSION_MSG_LEN];
    m[..18].copy_from_slice(POSSESSION_DOMAIN);
    m[18..50].copy_from_slice(crate::ID.as_ref());
    m[50..82].copy_from_slice(owner.as_ref());
    m[82..].copy_from_slice(label);
    m
}

/// Exactly one Ed25519 precompile instruction in the transaction, verifying `pk` over `msg`. A second one is
/// refused: the precompile checks every signature it carries, so stopping at the first match would admit decoys.
pub fn verify_single_ed25519(ix_sysvar: &AccountInfo, pk: &[u8; 32], msg: &[u8]) -> Result<()> {
    let mut found = 0usize;
    for i in 0..MAX_IX_SCAN {
        let Ok(ix) = load_instruction_at_checked(i, ix_sysvar) else {
            break;
        };
        if ix.program_id != ED25519_PROGRAM_ID {
            continue;
        }
        found += 1;
        require!(found == 1, VrfError::MultipleEd25519Instructions);
        check_ed25519_data(&ix.data, pk, msg)?;
    }
    require!(found == 1, VrfError::MissingEd25519Instruction);
    Ok(())
}

/// One signature, every offset inside this instruction (u16::MAX = "self"), every range in bounds.
pub fn check_ed25519_data(data: &[u8], pk: &[u8; 32], msg: &[u8]) -> Result<()> {
    // header: num_sigs | pad | sig_off | sig_ix | pk_off | pk_ix | msg_off | msg_size | msg_ix
    require!(
        data.len() >= 16 && data[0] == 1,
        VrfError::MalformedEd25519Instruction
    );
    let at = |o: usize| u16::from_le_bytes([data[o], data[o + 1]]);
    let (sig_off, sig_ix) = (at(2) as usize, at(4));
    let (pk_off, pk_ix) = (at(6) as usize, at(8));
    let (msg_off, msg_size, msg_ix) = (at(10) as usize, at(12) as usize, at(14));
    require!(
        sig_ix == u16::MAX && pk_ix == u16::MAX && msg_ix == u16::MAX,
        VrfError::Ed25519IndirectReference
    );
    let fits = |off: usize, len: usize| off.checked_add(len).is_some_and(|end| end <= data.len());
    require!(
        fits(sig_off, 64) && fits(pk_off, 32) && fits(msg_off, msg_size),
        VrfError::MalformedEd25519Instruction
    );
    require!(
        &data[pk_off..pk_off + 32] == pk,
        VrfError::PossessionKeyMismatch
    );
    require!(
        msg_size == msg.len() && &data[msg_off..msg_off + msg_size] == msg,
        VrfError::PossessionMessageMismatch
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ix_data(pk: &[u8; 32], msg: &[u8]) -> Vec<u8> {
        // Layout of solana's new_ed25519_instruction: header, pk, sig, msg.
        let (pk_off, sig_off, msg_off) = (16u16, 48u16, 112u16);
        let mut d = vec![1u8, 0];
        for v in [
            sig_off,
            u16::MAX,
            pk_off,
            u16::MAX,
            msg_off,
            msg.len() as u16,
            u16::MAX,
        ] {
            d.extend_from_slice(&v.to_le_bytes());
        }
        d.extend_from_slice(pk);
        d.extend_from_slice(&[7u8; 64]);
        d.extend_from_slice(msg);
        d
    }

    fn code(r: Result<()>) -> u32 {
        match r.unwrap_err() {
            anchor_lang::error::Error::AnchorError(e) => e.error_code_number,
            e => panic!("unexpected {e:?}"),
        }
    }

    const PK: [u8; 32] = [3u8; 32];

    #[test]
    fn message_is_114_bytes_and_ordered() {
        let owner = Pubkey::new_from_array([9u8; 32]);
        let m = possession_message(&owner, &[5u8; 32]);
        assert_eq!(m.len(), 114);
        assert_eq!(&m[..18], b"ccvrf-authority-v1");
        assert_eq!(&m[18..50], crate::ID.as_ref());
        assert_eq!(&m[50..82], owner.as_ref());
        assert_eq!(&m[82..], &[5u8; 32]);
    }

    #[test]
    fn accepts_exact_layout() {
        let msg = possession_message(&Pubkey::new_from_array([9u8; 32]), &[5u8; 32]);
        check_ed25519_data(&ix_data(&PK, &msg), &PK, &msg).unwrap();
    }

    #[test]
    fn rejects_each_tamper() {
        let msg = possession_message(&Pubkey::new_from_array([9u8; 32]), &[5u8; 32]);
        let good = ix_data(&PK, &msg);
        let mut two_sigs = good.clone();
        two_sigs[0] = 2;
        assert_eq!(
            code(check_ed25519_data(&two_sigs, &PK, &msg)),
            u32::from(VrfError::MalformedEd25519Instruction)
        );
        assert_eq!(
            code(check_ed25519_data(&good[..15], &PK, &msg)),
            u32::from(VrfError::MalformedEd25519Instruction)
        );
        for idx in [4usize, 8, 14] {
            let mut d = good.clone();
            d[idx..idx + 2].copy_from_slice(&0u16.to_le_bytes());
            assert_eq!(
                code(check_ed25519_data(&d, &PK, &msg)),
                u32::from(VrfError::Ed25519IndirectReference),
                "index field {idx}"
            );
        }
        for (field, len) in [(2usize, 64usize), (6, 32), (10, 114)] {
            let mut d = good.clone();
            let past_end = (d.len() - len + 1) as u16;
            d[field..field + 2].copy_from_slice(&past_end.to_le_bytes());
            assert_eq!(
                code(check_ed25519_data(&d, &PK, &msg)),
                u32::from(VrfError::MalformedEd25519Instruction),
                "offset field {field}"
            );
        }
        assert_eq!(
            code(check_ed25519_data(&good, &[4u8; 32], &msg)),
            u32::from(VrfError::PossessionKeyMismatch)
        );
        let mut wrong_msg = msg;
        wrong_msg[113] ^= 1;
        assert_eq!(
            code(check_ed25519_data(&good, &PK, &wrong_msg)),
            u32::from(VrfError::PossessionMessageMismatch)
        );
        // A 32-byte message signed by the VRF key is never accepted, whatever it says.
        let short = ix_data(&PK, &msg[..32]);
        assert_eq!(
            code(check_ed25519_data(&short, &PK, &msg)),
            u32::from(VrfError::PossessionMessageMismatch)
        );
    }
}
