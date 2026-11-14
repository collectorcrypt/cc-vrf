//! Builders for the v2 instructions plus raw sends that return logs (event-only instructions create no compressed
//! accounts, so bypassing the test indexer loses nothing).
use anchor_lang::{AnchorDeserialize, Discriminator, InstructionData, ToAccountMetas};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cc_vrf::{
    CompressedAccountMetaReadOnly, ValidityProof, VrfAuthority, VrfBatchCommitted, VrfPossession,
    VrfPossessionAttested, VrfRootRing, POSSESSION_SEED, RING_SEED,
};
use light_program_test::{Indexer, LightProgramTest};
use light_sdk::instruction::{PackedAccounts, SystemAccountMetaConfig};
use solana_sdk::{
    instruction::{AccountMeta, Instruction, InstructionError},
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    transaction::{Transaction, TransactionError},
};

use super::fetch_authority;

pub const NOOP_ID: Pubkey = solana_sdk::pubkey!("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");

pub struct Sent {
    pub logs: Vec<String>,
    pub cu: u64,
}

/// Anchor custom error code, a Light/system custom code, or the raw error.
#[derive(Debug, PartialEq)]
pub enum Failure {
    Custom(u32),
    Other(String),
}

pub fn vrf(e: cc_vrf::errors::VrfError) -> Failure {
    Failure::Custom(u32::from(e))
}

pub fn send_raw(
    rpc: &mut LightProgramTest,
    ixs: &[Instruction],
    signers: &[&Keypair],
) -> Result<Sent, (Failure, Vec<String>)> {
    rpc.context.expire_blockhash();
    let tx = Transaction::new_signed_with_payer(
        ixs,
        Some(&signers[0].pubkey()),
        signers,
        rpc.context.latest_blockhash(),
    );
    match rpc.context.send_transaction(tx) {
        Ok(m) => Ok(Sent {
            logs: m.logs,
            cu: m.compute_units_consumed,
        }),
        Err(f) => {
            let failure = match f.err {
                TransactionError::InstructionError(_, InstructionError::Custom(c)) => {
                    Failure::Custom(c)
                }
                e => Failure::Other(format!("{e:?}")),
            };
            Err((failure, f.meta.logs))
        }
    }
}

pub fn failure(r: Result<Sent, (Failure, Vec<String>)>) -> Failure {
    match r {
        Ok(_) => panic!("expected the transaction to fail"),
        Err((f, _)) => f,
    }
}

/// `Program data:` lines our program emitted at its own invoke depth.
pub fn program_data(logs: &[String]) -> Vec<Vec<u8>> {
    let me = cc_vrf::ID.to_string();
    let mut stack: Vec<String> = Vec::new();
    let mut out = Vec::new();
    for l in logs {
        if let Some(rest) = l.strip_prefix("Program ") {
            let parts: Vec<&str> = rest.split_whitespace().collect();
            if parts.len() == 3 && parts[1] == "invoke" {
                stack.push(parts[0].to_string());
                continue;
            }
            if parts.len() >= 2 && (parts[1] == "success" || parts[1] == "failed:") {
                stack.pop();
                continue;
            }
        }
        if let Some(d) = l.strip_prefix("Program data: ") {
            if stack.last() == Some(&me) {
                out.push(B64.decode(d.trim()).unwrap());
            }
        }
    }
    out
}

pub fn decode_event<E: AnchorDeserialize + Discriminator>(logs: &[String]) -> E {
    let all = program_data(logs);
    let hits: Vec<_> = all
        .iter()
        .filter(|d| d.starts_with(E::DISCRIMINATOR))
        .collect();
    assert_eq!(hits.len(), 1, "expected one event, got {}", hits.len());
    E::deserialize(&mut &hits[0][8..]).unwrap()
}

pub fn batch_event(logs: &[String]) -> VrfBatchCommitted {
    decode_event::<VrfBatchCommitted>(logs)
}

pub fn possession_event(logs: &[String]) -> VrfPossessionAttested {
    decode_event::<VrfPossessionAttested>(logs)
}

pub fn ring_pda(authority: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[RING_SEED, authority], &cc_vrf::ID)
}

pub fn pop_pda(authority: &[u8; 32]) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[POSSESSION_SEED, authority], &cc_vrf::ID)
}

pub fn read_ring(rpc: &LightProgramTest, ring: &Pubkey) -> VrfRootRing {
    let a = rpc.context.get_account(ring).expect("ring account");
    assert_eq!(a.data.len(), 7352);
    *bytemuck::from_bytes::<VrfRootRing>(&a.data[8..])
}

pub fn write_ring(rpc: &mut LightProgramTest, ring: &Pubkey, edit: impl FnOnce(&mut VrfRootRing)) {
    let mut a = rpc.context.get_account(ring).expect("ring account");
    edit(bytemuck::from_bytes_mut::<VrfRootRing>(&mut a.data[8..]));
    rpc.context.set_account(*ring, a).unwrap();
}

pub fn read_possession(rpc: &LightProgramTest, pda: &Pubkey) -> Option<VrfPossession> {
    let a = rpc.context.get_account(pda)?;
    Some(VrfPossession::deserialize(&mut &a.data[8..]).unwrap())
}

/// Read-only authority proof + packed Light accounts, as every v2 instruction takes them.
pub struct AuthorityProof {
    pub proof: ValidityProof,
    pub meta: CompressedAccountMetaReadOnly,
    pub current: VrfAuthority,
    pub light_metas: Vec<AccountMeta>,
}

pub async fn authority_proof(rpc: &LightProgramTest, authority: [u8; 32]) -> AuthorityProof {
    let f = fetch_authority(rpc, authority).await;
    let proof = rpc
        .get_validity_proof(vec![f.hash], vec![], None)
        .await
        .unwrap()
        .value;
    let mut accs = PackedAccounts::default();
    accs.add_system_accounts_v2(SystemAccountMetaConfig::new(cc_vrf::ID))
        .unwrap();
    let st = proof.pack_tree_infos(&mut accs).state_trees.unwrap();
    let (light_metas, _, _) = accs.to_account_metas();
    AuthorityProof {
        proof: proof.proof,
        meta: CompressedAccountMetaReadOnly {
            tree_info: st.packed_tree_infos[0],
            address: authority,
        },
        current: f.authority,
        light_metas,
    }
}

fn with_light(mut accounts: Vec<AccountMeta>, p: &AuthorityProof) -> Vec<AccountMeta> {
    accounts.extend(p.light_metas.iter().cloned());
    accounts
}

pub fn batch_event_ix(
    owner: &Pubkey,
    label: [u8; 32],
    root: [u8; 32],
    count: u32,
    leaf_version: u8,
    p: &AuthorityProof,
) -> Instruction {
    let data = cc_vrf::instruction::CommitBatchEvent {
        label,
        root,
        count,
        leaf_version,
        proof: p.proof,
        authority_account_meta: p.meta,
        current_authority: p.current.clone(),
    }
    .data();
    let accounts =
        cc_vrf::accounts::CommitBatchEvent { owner: *owner }.to_account_metas(Some(true));
    Instruction {
        program_id: cc_vrf::ID,
        accounts: with_light(accounts, p),
        data,
    }
}

pub fn init_ring_ix(
    owner: &Pubkey,
    label: [u8; 32],
    ring: Pubkey,
    p: &AuthorityProof,
) -> Instruction {
    let data = cc_vrf::instruction::InitRootRing {
        label,
        proof: p.proof,
        authority_account_meta: p.meta,
        current_authority: p.current.clone(),
    }
    .data();
    let accounts = cc_vrf::accounts::InitRootRing {
        owner: *owner,
        root_ring: ring,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(Some(true));
    Instruction {
        program_id: cc_vrf::ID,
        accounts: with_light(accounts, p),
        data,
    }
}

#[allow(clippy::too_many_arguments)]
pub fn ring_commit_ix(
    owner: &Pubkey,
    label: [u8; 32],
    ring: Pubkey,
    root: [u8; 32],
    count: u32,
    leaf_version: u8,
    expected_seq: u64,
    p: &AuthorityProof,
) -> Instruction {
    let data = cc_vrf::instruction::CommitBatchRing {
        label,
        root,
        count,
        leaf_version,
        expected_seq,
        proof: p.proof,
        authority_account_meta: p.meta,
        current_authority: p.current.clone(),
    }
    .data();
    let accounts = cc_vrf::accounts::CommitBatchRing {
        owner: *owner,
        root_ring: ring,
    }
    .to_account_metas(Some(true));
    Instruction {
        program_id: cc_vrf::ID,
        accounts: with_light(accounts, p),
        data,
    }
}

pub fn attest_ix(owner: &Pubkey, label: [u8; 32], pda: Pubkey, p: &AuthorityProof) -> Instruction {
    let data = cc_vrf::instruction::AttestPossession {
        label,
        proof: p.proof,
        authority_account_meta: p.meta,
        current_authority: p.current.clone(),
    }
    .data();
    let accounts = cc_vrf::accounts::AttestPossession {
        owner: *owner,
        attestation: pda,
        instructions: solana_sdk::sysvar::instructions::ID,
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(Some(true));
    Instruction {
        program_id: cc_vrf::ID,
        accounts: with_light(accounts, p),
        data,
    }
}

/// The VRF key as an Ed25519 signer: same 32-byte seed, so the precompile verifies what `sign_message` produces.
pub fn vrf_key(seed: u8) -> Keypair {
    solana_sdk::signer::keypair::keypair_from_seed(&[seed; 32]).unwrap()
}

/// One-signature precompile instruction, every offset inside itself.
pub fn ed25519_ix(signer: &Keypair, msg: &[u8]) -> Instruction {
    let sig = signer.sign_message(msg);
    solana_sdk::ed25519_instruction::new_ed25519_instruction_with_signature(
        msg,
        sig.as_ref().try_into().unwrap(),
        &signer.pubkey().to_bytes(),
    )
}

/// Precompile instruction whose signature, key and message offsets point at instruction `msg_ix` (an spl_noop
/// carrying `pk ‖ sig ‖ msg`): valid for the precompile, refused by attest_possession.
pub fn ed25519_indirect_ix(
    signer: &Keypair,
    msg: &[u8],
    data_ix: u16,
) -> (Instruction, Instruction) {
    let sig = signer.sign_message(msg);
    let mut carried = signer.pubkey().to_bytes().to_vec();
    carried.extend_from_slice(sig.as_ref());
    carried.extend_from_slice(msg);
    let mut d = vec![1u8, 0];
    for v in [32u16, data_ix, 0, data_ix, 96, msg.len() as u16, data_ix] {
        d.extend_from_slice(&v.to_le_bytes());
    }
    let noop = Instruction {
        program_id: NOOP_ID,
        accounts: vec![],
        data: carried,
    };
    let pre = Instruction {
        program_id: solana_sdk::ed25519_program::ID,
        accounts: vec![],
        data: d,
    };
    (noop, pre)
}

/// Two signatures in one precompile instruction (both valid).
pub fn ed25519_two_sigs_ix(a: &Keypair, b: &Keypair, msg: &[u8]) -> Instruction {
    let (sa, sb) = (a.sign_message(msg), b.sign_message(msg));
    let header = 2 + 2 * 14;
    let entry = |base: usize| -> [u16; 7] {
        let (pk, sig, m) = (base, base + 32, base + 96);
        [
            sig as u16,
            u16::MAX,
            pk as u16,
            u16::MAX,
            m as u16,
            msg.len() as u16,
            u16::MAX,
        ]
    };
    let (base_a, base_b) = (header, header + 96 + msg.len());
    let mut d = vec![2u8, 0];
    for v in entry(base_a).into_iter().chain(entry(base_b)) {
        d.extend_from_slice(&v.to_le_bytes());
    }
    for (k, s) in [(a, sa), (b, sb)] {
        d.extend_from_slice(&k.pubkey().to_bytes());
        d.extend_from_slice(s.as_ref());
        d.extend_from_slice(msg);
    }
    Instruction {
        program_id: solana_sdk::ed25519_program::ID,
        accounts: vec![],
        data: d,
    }
}
