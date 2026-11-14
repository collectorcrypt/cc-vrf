//! Wire pins: the bytes RC1 shipped. gachamachine calls the kept instructions directly (~64k commits/day) and 4.1M
//! committed awards verify against these layouts, so any change here must fail before an upgrade. Run: cargo test -p cc-vrf --test it wire_pins
use std::str::FromStr;

use anchor_lang::{AnchorDeserialize, AnchorSerialize, Discriminator};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use cc_vrf::{VrfAuthority, VrfProofCommit, VrfProofCommitWithBeta, VrfProofCommitted};
use light_compressed_account::{
    compressed_account::{CompressedAccount, CompressedAccountData},
    Pubkey as LPubkey,
};
use light_sdk::{address::v2::derive_address, constants::ADDRESS_TREE_V2, LightDiscriminator};
use solana_sdk::{hash::hash as sha256, pubkey::Pubkey};

const GACHA_OWNER: &str = "GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3";
const GACHA_AUTHORITY: &str = "13C5cbemzwSg5wNerJDucU5uUJ1kHQENDqoTa3VSAHau";

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

fn unhex(s: &str) -> Vec<u8> {
    let s = s.trim_start_matches("0x");
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn b58(s: &str) -> [u8; 32] {
    Pubkey::from_str(s).unwrap().to_bytes()
}

fn fixture(name: &str) -> serde_json::Value {
    let p = format!(
        "{}/tests/fixtures/mainnet/{name}",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap()
}

fn gacha_label() -> [u8; 32] {
    let mut l = [0u8; 32];
    l[..5].copy_from_slice(b"gacha");
    l
}

/// light-sdk 0.23 SHA LightAccount: sha256(borsh(data)) with byte 0 zeroed.
fn flat_sha_data_hash(borsh: &[u8]) -> [u8; 32] {
    let mut h = sha256(borsh).to_bytes();
    h[0] = 0;
    h
}

/// Recomputes a fetched account's hash the way the Light system program does (batched state tree).
fn account_hash(v: &serde_json::Value, discriminator: [u8; 8], data: &[u8]) -> [u8; 32] {
    let account = CompressedAccount {
        owner: LPubkey::new_from_array(b58(v["owner"].as_str().unwrap())),
        lamports: v["lamports"].as_u64().unwrap(),
        address: Some(b58(v["address"].as_str().unwrap())),
        data: Some(CompressedAccountData {
            discriminator,
            data: data.to_vec(),
            data_hash: flat_sha_data_hash(data),
        }),
    };
    let tree = LPubkey::new_from_array(b58(v["tree"].as_str().unwrap()));
    account
        .hash(&tree, &(v["leafIndex"].as_u64().unwrap() as u32), true)
        .unwrap()
}

fn photon_discriminator(v: &serde_json::Value) -> [u8; 8] {
    let d = &v["data"]["discriminator"];
    let n = d
        .as_u64()
        .or_else(|| d.as_str().and_then(|s| s.parse().ok()))
        .expect("discriminator");
    n.to_le_bytes()
}

#[test]
fn instruction_discriminators() {
    let pins: [(&[u8], &str); 5] = [
        (
            cc_vrf::instruction::InitAuthority::DISCRIMINATOR,
            "88965eac4ac7ec55",
        ),
        (
            cc_vrf::instruction::FreezeAuthority::DISCRIMINATOR,
            "3b7cde591b92b207",
        ),
        (
            cc_vrf::instruction::CommitProof::DISCRIMINATOR,
            "c19468b9770fb74b",
        ),
        (
            cc_vrf::instruction::CommitProofWithBeta::DISCRIMINATOR,
            "c7fdb203bbbf44e6",
        ),
        (
            cc_vrf::instruction::CommitProofEvent::DISCRIMINATOR,
            "a9c5a2b73f91881e",
        ),
    ];
    for (got, want) in pins {
        assert_eq!(hex(got), want);
    }
}

#[test]
fn event_discriminators() {
    assert_eq!(hex(VrfProofCommitted::DISCRIMINATOR), "a1d700609096eca2");
    assert_eq!(hex(VrfAuthority::DISCRIMINATOR), "fe13828ad9389681");
    assert_eq!(hex(VrfProofCommit::DISCRIMINATOR), "0a955b6f932a158d");
    assert_eq!(
        hex(VrfProofCommitWithBeta::DISCRIMINATOR),
        "7ae7f73166187ede"
    );
}

/// The v2 additions: frozen from their first deploy, like RC1's.
#[test]
fn v2_discriminators_and_layouts() {
    let ixs: [(&[u8], &str); 4] = [
        (
            cc_vrf::instruction::CommitBatchEvent::DISCRIMINATOR,
            "d1cadf1b9390fafc",
        ),
        (
            cc_vrf::instruction::InitRootRing::DISCRIMINATOR,
            "0acf88b6701c0dff",
        ),
        (
            cc_vrf::instruction::CommitBatchRing::DISCRIMINATOR,
            "9a3b7ece39e64bfc",
        ),
        (
            cc_vrf::instruction::AttestPossession::DISCRIMINATOR,
            "3d76aaa973615136",
        ),
    ];
    for (got, want) in ixs {
        assert_eq!(hex(got), want);
    }
    assert_eq!(
        hex(cc_vrf::VrfBatchCommitted::DISCRIMINATOR),
        "0b0cd05eb97ab7a2"
    );
    assert_eq!(
        hex(cc_vrf::VrfPossessionAttested::DISCRIMINATOR),
        "e3ebe75cea9c67a5"
    );
    assert_eq!(hex(cc_vrf::VrfRootRing::DISCRIMINATOR), "44f3cbc931dae42e");
    assert_eq!(
        hex(cc_vrf::VrfPossession::DISCRIMINATOR),
        "bb6f80e184a2ecff"
    );
    assert_eq!(8 + core::mem::size_of::<cc_vrf::VrfRootRing>(), 7352);
    assert_eq!(core::mem::size_of::<cc_vrf::RingEntry>(), 56);
    assert_eq!(
        8 + <cc_vrf::VrfPossession as anchor_lang::Space>::INIT_SPACE,
        80
    );
    // VrfBatchCommitted: 32 + 32 + 32 + 4 + 1 + (1 | 9) + 8.
    let e = cc_vrf::VrfBatchCommitted {
        owner: Pubkey::default(),
        label: [0; 32],
        root: [0; 32],
        count: 0,
        leaf_version: 0,
        ring_seq: None,
        committed_slot: 0,
    };
    assert_eq!(e.try_to_vec().unwrap().len(), 110);
    assert_eq!(
        cc_vrf::VrfBatchCommitted {
            ring_seq: Some(1),
            ..e
        }
        .try_to_vec()
        .unwrap()
        .len(),
        118
    );
}

#[test]
fn borsh_sizes() {
    assert_eq!(VrfAuthority::default().try_to_vec().unwrap().len(), 107);
    assert_eq!(VrfProofCommit::default().try_to_vec().unwrap().len(), 136);
    assert_eq!(
        VrfProofCommitWithBeta::default()
            .try_to_vec()
            .unwrap()
            .len(),
        200
    );
}

#[test]
fn gacha_authority_address() {
    let (address, _) = derive_address(
        &[VrfAuthority::SEED_PREFIX, &b58(GACHA_OWNER), &gacha_label()],
        &Pubkey::new_from_array(ADDRESS_TREE_V2),
        &cc_vrf::ID,
    );
    assert_eq!(address, b58(GACHA_AUTHORITY));
}

#[test]
fn mainnet_authority_account() {
    let v = &fixture("authority-13C5.json")["value"];
    let data = B64.decode(v["data"]["data"].as_str().unwrap()).unwrap();
    let a = VrfAuthority::deserialize(&mut &data[..]).unwrap();
    assert_eq!(a.owner.to_bytes(), b58(GACHA_OWNER));
    assert_eq!(
        (a.suite, a.frozen, a.revoked, a.label),
        (0x03, true, false, gacha_label())
    );
    assert_eq!(a.try_to_vec().unwrap(), data, "borsh round trip");
    assert_eq!(photon_discriminator(v), VrfAuthority::LIGHT_DISCRIMINATOR);
    assert_eq!(
        flat_sha_data_hash(&data),
        b58(v["data"]["dataHash"].as_str().unwrap())
    );
    assert_eq!(
        account_hash(v, VrfAuthority::LIGHT_DISCRIMINATOR, &data),
        b58(v["hash"].as_str().unwrap())
    );
}

#[test]
fn mainnet_commit_with_beta_account() {
    let f = fixture("commit-with-beta.json");
    let v = &f["value"];
    let data = B64.decode(v["data"]["data"].as_str().unwrap()).unwrap();
    let c = VrfProofCommitWithBeta::deserialize(&mut &data[..]).unwrap();
    let memo_hash = sha256(f["memo"].as_str().unwrap().as_bytes()).to_bytes();
    assert_eq!(c.authority.to_bytes(), b58(GACHA_AUTHORITY));
    assert_eq!(c.memo_hash, memo_hash);
    assert_eq!(
        c.proof_hash,
        sha256(&unhex(f["proof"].as_str().unwrap())).to_bytes()
    );
    assert_eq!(
        c.alpha_hash,
        sha256(&unhex(f["alpha"].as_str().unwrap())).to_bytes()
    );
    assert_eq!(
        [c.beta_lo, c.beta_hi].concat(),
        unhex(f["beta"].as_str().unwrap())
    );
    assert_eq!(c.try_to_vec().unwrap(), data, "borsh round trip");
    let (address, _) = derive_address(
        &[
            VrfProofCommit::SEED_PREFIX,
            &b58(GACHA_AUTHORITY),
            &memo_hash,
        ],
        &Pubkey::new_from_array(ADDRESS_TREE_V2),
        &cc_vrf::ID,
    );
    assert_eq!(address, b58(v["address"].as_str().unwrap()));
    assert_eq!(
        photon_discriminator(v),
        VrfProofCommitWithBeta::LIGHT_DISCRIMINATOR
    );
    assert_eq!(
        account_hash(v, VrfProofCommitWithBeta::LIGHT_DISCRIMINATOR, &data),
        b58(v["hash"].as_str().unwrap())
    );
}

#[test]
fn mainnet_commit_event_log() {
    let f = fixture("commit-event.json");
    let lines = f["programData"].as_array().unwrap();
    assert_eq!(lines.len(), 1);
    let bytes = B64.decode(lines[0].as_str().unwrap()).unwrap();
    assert_eq!(&bytes[..8], VrfProofCommitted::DISCRIMINATOR);
    let e = VrfProofCommitted::deserialize(&mut &bytes[8..]).unwrap();
    assert_eq!(e.owner.to_bytes(), b58(GACHA_OWNER));
    assert_eq!(e.label, gacha_label());
    assert_eq!(
        e.memo_hash,
        sha256(f["memo"].as_str().unwrap().as_bytes()).to_bytes()
    );
    assert_eq!(
        e.proof_hash,
        sha256(&unhex(f["proof"].as_str().unwrap())).to_bytes()
    );
    assert_eq!(
        e.alpha_hash,
        sha256(&unhex(f["alpha"].as_str().unwrap())).to_bytes()
    );
    assert_eq!(
        [&bytes[..8], &e.try_to_vec().unwrap()[..]].concat(),
        bytes,
        "borsh round trip"
    );
}
