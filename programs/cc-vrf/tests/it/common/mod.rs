//! light-program-test harness: a Light-CLI-shaped bin dir (CLI 0.28.4 programs, hash-checked, plus the pinned
//! mainnet spl_noop.so), SBF_OUT_DIR for the cc_vrf build under test, and a prover already up on 127.0.0.1:3001.
#![allow(dead_code)]

pub mod v2;

use std::{
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::Duration,
};

use anchor_lang::{AnchorDeserialize, InstructionData, ToAccountMetas};
use cc_vrf::{
    CompressedAccountMeta, CompressedAccountMetaReadOnly, VrfAuthority, VrfProofCommit,
    VrfProofCommitWithBeta,
};
use light_program_test::{
    AddressWithTree, Indexer, LightProgramTest, ProgramTestConfig, Rpc, RpcError,
};
use light_sdk::{
    address::v2::derive_address,
    instruction::{PackedAccounts, SystemAccountMetaConfig},
};
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signature, Signer},
};

pub const SUITE: u8 = 0x03;
/// RFC 8032 §7.1 test key 1 (public): a valid Edwards point for `pk`.
pub const TEST_PK: [u8; 32] = [
    0xd7, 0x5a, 0x98, 0x01, 0x82, 0xb1, 0x0a, 0xb7, 0xd5, 0x4b, 0xfe, 0xd3, 0xc9, 0x64, 0x07, 0x3a,
    0x0e, 0xe1, 0x72, 0xf3, 0xda, 0xa6, 0x23, 0x25, 0xaf, 0x02, 0x1a, 0x68, 0xf7, 0x07, 0x51, 0x1a,
];

const CLI_PROGRAMS: [&str; 4] = [
    "account_compression.so",
    "light_compressed_token.so",
    "light_registry.so",
    "light_system_program_pinocchio.so",
];

pub fn fixtures() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures")
}

/// The RC1 binary both clusters run (sha256 7ad9f5b8…, 288,496 B).
pub fn rc1_dir() -> PathBuf {
    let dir = fixtures().join("rc1");
    assert_pinned(&dir, "cc_vrf.so");
    dir
}

fn newest_mtime(path: &Path) -> std::time::SystemTime {
    let meta = std::fs::metadata(path).unwrap();
    if !meta.is_dir() {
        return meta.modified().unwrap();
    }
    std::fs::read_dir(path)
        .unwrap()
        .map(|e| newest_mtime(&e.unwrap().path()))
        .max()
        .unwrap_or(std::time::UNIX_EPOCH)
}

/// The fresh build under test. `cargo test` never rebuilds SBF, so refuse a .so older than any program source,
/// and one not written by scripts/build-sbf.sh (its sha256 stamp must match).
pub fn target_deploy() -> PathBuf {
    let manifest = Path::new(env!("CARGO_MANIFEST_DIR"));
    let dir = manifest.join("../../target/deploy");
    let so = dir.join("cc_vrf.so");
    let built = std::fs::metadata(&so)
        .unwrap_or_else(|_| panic!("{} missing: run `bash scripts/build-sbf.sh`", so.display()))
        .modified()
        .unwrap();
    let src = newest_mtime(&manifest.join("src")).max(newest_mtime(&manifest.join("Cargo.toml")));
    assert!(
        built >= src,
        "{} is older than the program source: run `bash scripts/build-sbf.sh`",
        so.display()
    );
    let stamp = std::fs::read_to_string(dir.join("cc_vrf.so.sha256")).unwrap_or_default();
    let got = sha256_hex(&so);
    assert!(
        stamp.starts_with(&got),
        "{} was not built by scripts/build-sbf.sh (sha256 {got})",
        so.display()
    );
    dir
}

fn sha256_hex(path: &Path) -> String {
    let bytes = std::fs::read(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    solana_sdk::hash::hash(&bytes)
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

fn expected_sums(file: &Path) -> Vec<(String, String)> {
    std::fs::read_to_string(file)
        .unwrap()
        .lines()
        .filter_map(|l| {
            l.split_once("  ")
                .map(|(h, n)| (n.trim().to_string(), h.to_string()))
        })
        .collect()
}

/// Panics unless `dir/name` hashes to its SHA256SUMS line: a stale or drifted binary fails loudly.
pub fn assert_pinned(dir: &Path, name: &str) {
    let sums = expected_sums(&dir.join("SHA256SUMS"));
    let want = sums.iter().find(|(n, _)| n == name).map(|(_, h)| h.clone());
    let got = sha256_hex(&dir.join(name));
    assert_eq!(
        Some(got.clone()),
        want,
        "{}/{name} sha256 {got} is not the pinned one",
        dir.display()
    );
}

const CLI_PKG: &str = "lib/node_modules/@lightprotocol/zk-compression-cli";
const CLI_VERSION: &str = "0.28.4";

fn real_cli() -> PathBuf {
    if let Ok(dir) = std::env::var("LIGHT_CLI_DIR") {
        return PathBuf::from(dir);
    }
    let out = Command::new("npm")
        .args(["root", "-g"])
        .output()
        .expect("npm root -g");
    PathBuf::from(String::from_utf8_lossy(&out.stdout).trim())
        .join("@lightprotocol/zk-compression-cli")
}

fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap_or_else(|e| panic!("{}: {e}", from.display())) {
        let e = e.unwrap();
        std::fs::copy(e.path(), to.join(e.file_name())).unwrap();
    }
}

/// Mirrors npm's global layout: light-program-test finds programs via `which light` → package bin/, and tree
/// accounts via <dir of light>/../lib/node_modules/@lightprotocol/zk-compression-cli/accounts.
fn light_layout() -> PathBuf {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../target/light-cli-layout");
    let pkg = root.join(CLI_PKG);
    let (bin, test_bin, path) = (pkg.join("bin"), pkg.join("test_bin"), root.join("bin"));
    for d in [&bin, &test_bin, &path] {
        std::fs::create_dir_all(d).unwrap();
    }
    let src = real_cli();
    let version = std::fs::read_to_string(src.join("package.json")).unwrap_or_default();
    assert!(
        version.contains(&format!("\"version\": \"{CLI_VERSION}\"")),
        "need @lightprotocol/zk-compression-cli {CLI_VERSION} at {} (or set LIGHT_CLI_DIR)",
        src.display()
    );
    let pins = fixtures().join("light");
    for so in CLI_PROGRAMS {
        std::fs::copy(src.join("bin").join(so), bin.join(so))
            .unwrap_or_else(|e| panic!("{so}: {e}"));
    }
    std::fs::copy(pins.join("spl_noop.so"), bin.join("spl_noop.so")).unwrap();
    std::fs::copy(pins.join("SHA256SUMS"), bin.join("SHA256SUMS")).unwrap();
    for so in CLI_PROGRAMS.iter().copied().chain(["spl_noop.so"]) {
        assert_pinned(&bin, so);
    }
    copy_dir(&src.join("accounts"), &pkg.join("accounts"));
    let run = test_bin.join("run");
    std::fs::write(
        &run,
        "#!/bin/sh\necho 'start the prover first: bash scripts/test-prover.sh' >&2\nexit 1\n",
    )
    .unwrap();
    std::fs::set_permissions(&run, std::os::unix::fs::PermissionsExt::from_mode(0o755)).unwrap();
    let link = path.join("light");
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(format!("../{CLI_PKG}/test_bin/run"), &link).unwrap();
    root
}

fn prover_healthy() -> bool {
    let Ok(mut s) =
        TcpStream::connect_timeout(&"127.0.0.1:3001".parse().unwrap(), Duration::from_secs(2))
    else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_secs(2)));
    let _ = s.write_all(b"GET /health HTTP/1.0\r\nHost: 127.0.0.1\r\n\r\n");
    let mut buf = String::new();
    let _ = s.read_to_string(&mut buf);
    buf.starts_with("HTTP/1.1 200") || buf.starts_with("HTTP/1.0 200")
}

static ENV: Mutex<bool> = Mutex::new(false);

/// A fresh v2-tree LightProgramTest with `cc_vrf.so` loaded from `so_dir` (from rc1_dir() or target_deploy()).
/// The binary goes straight into LiteSVM, not through SBF_OUT_DIR, so parallel tests can load different builds.
pub async fn rpc_with(so_dir: &Path) -> LightProgramTest {
    {
        let mut done = ENV.lock().unwrap();
        if !*done {
            let layout = light_layout();
            let path = format!(
                "{}:{}",
                layout.join("bin").display(),
                std::env::var("PATH").unwrap_or_default()
            );
            std::env::set_var("PATH", path);
            *done = true;
        }
    }
    assert!(
        prover_healthy(),
        "no prover on 127.0.0.1:3001; run: bash scripts/test-prover.sh"
    );
    let mut rpc = LightProgramTest::new(ProgramTestConfig::new_v2(true, None))
        .await
        .expect("LightProgramTest::new");
    load_program(&mut rpc, so_dir);
    rpc
}

/// Replaces the cc_vrf binary in place: how the tests model the program upgrade.
pub fn load_program(rpc: &mut LightProgramTest, so_dir: &Path) {
    rpc.context
        .add_program_from_file(cc_vrf::ID, so_dir.join("cc_vrf.so"))
        .expect("load cc_vrf.so");
}

pub async fn funded(rpc: &mut LightProgramTest) -> Keypair {
    let kp = Keypair::new();
    rpc.airdrop_lamports(&kp.pubkey(), 10_000_000_000)
        .await
        .unwrap();
    kp
}

/// Deterministic signer, so two runs (RC1 vs v2) derive the same addresses.
pub async fn funded_seeded(rpc: &mut LightProgramTest, seed: u8) -> Keypair {
    let kp = solana_sdk::signer::keypair::keypair_from_seed(&[seed; 32]).unwrap();
    rpc.airdrop_lamports(&kp.pubkey(), 10_000_000_000)
        .await
        .unwrap();
    kp
}

/// init + freeze with `pk`; returns the authority address.
pub async fn frozen_authority(
    rpc: &mut LightProgramTest,
    owner: &Keypair,
    label: [u8; 32],
    pk: [u8; 32],
) -> [u8; 32] {
    let a = init_authority(rpc, owner, label, pk)
        .await
        .expect("init_authority");
    freeze_authority(rpc, owner, a)
        .await
        .expect("freeze_authority");
    a
}

pub fn label(s: &str) -> [u8; 32] {
    let mut l = [0u8; 32];
    l[..s.len()].copy_from_slice(s.as_bytes());
    l
}

pub fn h(tag: &str, n: u64) -> [u8; 32] {
    solana_sdk::hash::hashv(&[tag.as_bytes(), &n.to_le_bytes()]).to_bytes()
}

fn system_accounts() -> PackedAccounts {
    let mut accs = PackedAccounts::default();
    accs.add_system_accounts_v2(SystemAccountMetaConfig::new(cc_vrf::ID))
        .unwrap();
    accs
}

fn ix(
    accounts: Vec<anchor_lang::solana_program::instruction::AccountMeta>,
    packed: PackedAccounts,
    data: Vec<u8>,
) -> Instruction {
    let (metas, _, _) = packed.to_account_metas();
    let mut all = accounts;
    all.extend(metas);
    Instruction {
        program_id: cc_vrf::ID,
        accounts: all,
        data,
    }
}

pub fn authority_address(rpc: &LightProgramTest, owner: &Pubkey, label: &[u8; 32]) -> [u8; 32] {
    let tree = rpc.get_address_tree_v2().tree;
    derive_address(
        &[VrfAuthority::SEED_PREFIX, owner.as_ref(), label],
        &tree,
        &cc_vrf::ID,
    )
    .0
}

pub fn commit_address(
    rpc: &LightProgramTest,
    authority: &[u8; 32],
    memo_hash: &[u8; 32],
) -> [u8; 32] {
    let tree = rpc.get_address_tree_v2().tree;
    derive_address(
        &[VrfProofCommit::SEED_PREFIX, authority, memo_hash],
        &tree,
        &cc_vrf::ID,
    )
    .0
}

pub struct Fetched {
    pub hash: [u8; 32],
    pub authority: VrfAuthority,
}

pub async fn fetch_authority(rpc: &LightProgramTest, address: [u8; 32]) -> Fetched {
    let acc = rpc
        .get_compressed_account(address, None)
        .await
        .unwrap()
        .value
        .expect("authority exists");
    let data = acc.data.expect("authority data");
    Fetched {
        hash: acc.hash,
        authority: VrfAuthority::deserialize(&mut &data.data[..]).unwrap(),
    }
}

pub async fn send(
    rpc: &mut LightProgramTest,
    ix: Instruction,
    signer: &Keypair,
) -> Result<Signature, RpcError> {
    rpc.create_and_send_transaction(&[ix], &signer.pubkey(), &[signer])
        .await
}

pub async fn init_authority(
    rpc: &mut LightProgramTest,
    owner: &Keypair,
    label: [u8; 32],
    pk: [u8; 32],
) -> Result<[u8; 32], RpcError> {
    let tree = rpc.get_address_tree_v2().tree;
    let address = authority_address(rpc, &owner.pubkey(), &label);
    let proof = rpc
        .get_validity_proof(vec![], vec![AddressWithTree { address, tree }], None)
        .await
        .unwrap()
        .value;
    let mut accs = system_accounts();
    let packed = proof.pack_tree_infos(&mut accs);
    // First v2 state tree, not get_random_state_tree_info(): the tree and leaf index are part of the account hash,
    // and the RC1-vs-v2 differential needs identical hashes.
    let tree_info: light_client::indexer::TreeInfo = rpc.test_accounts.v2_state_trees[0].into();
    let output_state_tree_index = tree_info.pack_output_tree_index(&mut accs).unwrap();
    let data = cc_vrf::instruction::InitAuthority {
        proof: proof.proof,
        address_tree_info: packed.address_trees[0],
        output_state_tree_index,
        pk,
        suite: SUITE,
        label,
    }
    .data();
    let accounts = cc_vrf::accounts::InitAuthority {
        owner: owner.pubkey(),
        system_program: anchor_lang::system_program::ID,
    }
    .to_account_metas(Some(true));
    send(rpc, ix(accounts, accs, data), owner).await?;
    Ok(address)
}

pub async fn freeze_authority(
    rpc: &mut LightProgramTest,
    owner: &Keypair,
    address: [u8; 32],
) -> Result<Signature, RpcError> {
    let f = fetch_authority(rpc, address).await;
    let proof = rpc
        .get_validity_proof(vec![f.hash], vec![], None)
        .await
        .unwrap()
        .value;
    let mut accs = system_accounts();
    let st = proof.pack_tree_infos(&mut accs).state_trees.unwrap();
    let account_meta = CompressedAccountMeta {
        tree_info: st.packed_tree_infos[0],
        address,
        output_state_tree_index: st.output_tree_index,
    };
    let data = cc_vrf::instruction::FreezeAuthority {
        proof: proof.proof,
        current_authority: f.authority,
        account_meta,
    }
    .data();
    let accounts = cc_vrf::accounts::FreezeAuthority {
        owner: owner.pubkey(),
    }
    .to_account_metas(Some(true));
    send(rpc, ix(accounts, accs, data), owner).await
}

/// Registry commit (`commit_proof`, or `commit_proof_with_beta` when `beta` is set): read-only authority + new address.
pub async fn commit_registry(
    rpc: &mut LightProgramTest,
    owner: &Keypair,
    authority: [u8; 32],
    memo_hash: [u8; 32],
    beta: Option<[u8; 64]>,
) -> Result<[u8; 32], RpcError> {
    let tree = rpc.get_address_tree_v2().tree;
    let f = fetch_authority(rpc, authority).await;
    let address = commit_address(rpc, &authority, &memo_hash);
    let proof = rpc
        .get_validity_proof(vec![f.hash], vec![AddressWithTree { address, tree }], None)
        .await
        .unwrap()
        .value;
    let mut accs = system_accounts();
    let packed = proof.pack_tree_infos(&mut accs);
    let st = packed.state_trees.unwrap();
    let ro = CompressedAccountMetaReadOnly {
        tree_info: st.packed_tree_infos[0],
        address: authority,
    };
    let (proof_hash, alpha_hash) = (
        h("proof", memo_hash[0] as u64),
        h("alpha", memo_hash[0] as u64),
    );
    let data = match beta {
        None => cc_vrf::instruction::CommitProof {
            proof: proof.proof,
            authority_account_meta: ro,
            current_authority: f.authority,
            address_tree_info: packed.address_trees[0],
            output_state_tree_index: st.output_tree_index,
            memo_hash,
            proof_hash,
            alpha_hash,
        }
        .data(),
        Some(b) => cc_vrf::instruction::CommitProofWithBeta {
            proof: proof.proof,
            authority_account_meta: ro,
            current_authority: f.authority,
            address_tree_info: packed.address_trees[0],
            output_state_tree_index: st.output_tree_index,
            memo_hash,
            proof_hash,
            alpha_hash,
            beta_lo: b[..32].try_into().unwrap(),
            beta_hi: b[32..].try_into().unwrap(),
        }
        .data(),
    };
    let accounts = cc_vrf::accounts::CommitProof {
        owner: owner.pubkey(),
    }
    .to_account_metas(Some(true));
    send(rpc, ix(accounts, accs, data), owner).await?;
    Ok(address)
}

pub async fn commit_event(
    rpc: &mut LightProgramTest,
    owner: &Keypair,
    authority: [u8; 32],
    label: [u8; 32],
    memo_hash: [u8; 32],
) -> Result<Signature, RpcError> {
    let ix = commit_event_ix(rpc, owner, authority, label, memo_hash).await;
    send(rpc, ix, owner).await
}

/// `commit_proof_event` instruction (event-only, so it can go through v2::send_raw to keep its logs).
pub async fn commit_event_ix(
    rpc: &LightProgramTest,
    owner: &Keypair,
    authority: [u8; 32],
    label: [u8; 32],
    memo_hash: [u8; 32],
) -> Instruction {
    let f = fetch_authority(rpc, authority).await;
    let proof = rpc
        .get_validity_proof(vec![f.hash], vec![], None)
        .await
        .unwrap()
        .value;
    let mut accs = system_accounts();
    let st = proof.pack_tree_infos(&mut accs).state_trees.unwrap();
    let ro = CompressedAccountMetaReadOnly {
        tree_info: st.packed_tree_infos[0],
        address: authority,
    };
    let data = cc_vrf::instruction::CommitProofEvent {
        proof: proof.proof,
        authority_account_meta: ro,
        current_authority: f.authority,
        label,
        memo_hash,
        proof_hash: h("proof", memo_hash[0] as u64),
        alpha_hash: h("alpha", memo_hash[0] as u64),
    }
    .data();
    let accounts = cc_vrf::accounts::CommitProofEvent {
        owner: owner.pubkey(),
    }
    .to_account_metas(Some(true));
    ix(accounts, accs, data)
}

/// Raw RC1 `revoke_authority` (gone from v2's IDL): discriminator e9feef0f31b76915 + borsh(proof, authority, meta).
pub async fn revoke_ix(rpc: &LightProgramTest, owner: &Keypair, address: [u8; 32]) -> Instruction {
    use anchor_lang::AnchorSerialize;
    let f = fetch_authority(rpc, address).await;
    let proof = rpc
        .get_validity_proof(vec![f.hash], vec![], None)
        .await
        .unwrap()
        .value;
    let mut accs = system_accounts();
    let st = proof.pack_tree_infos(&mut accs).state_trees.unwrap();
    let meta = CompressedAccountMeta {
        tree_info: st.packed_tree_infos[0],
        address,
        output_state_tree_index: st.output_tree_index,
    };
    let mut data = vec![0xe9, 0xfe, 0xef, 0x0f, 0x31, 0xb7, 0x69, 0x15];
    proof.proof.serialize(&mut data).unwrap();
    f.authority.serialize(&mut data).unwrap();
    meta.serialize(&mut data).unwrap();
    let accounts = vec![solana_sdk::instruction::AccountMeta::new(
        owner.pubkey(),
        true,
    )];
    ix(accounts, accs, data)
}

/// Custom error code inside an RpcError, if any.
pub fn rpc_code(e: &RpcError) -> Option<u32> {
    let s = format!("{e:?}");
    let i = s.find("Custom(")? + 7;
    s[i..].split(')').next()?.parse().ok()
}

pub async fn fetch_commit(rpc: &LightProgramTest, address: [u8; 32]) -> Option<Vec<u8>> {
    rpc.get_compressed_account(address, None)
        .await
        .unwrap()
        .value
        .and_then(|a| a.data)
        .map(|d| d.data)
}

pub fn decode_commit(data: &[u8]) -> VrfProofCommit {
    VrfProofCommit::deserialize(&mut &data[..]).unwrap()
}

pub fn decode_commit_with_beta(data: &[u8]) -> VrfProofCommitWithBeta {
    VrfProofCommitWithBeta::deserialize(&mut &data[..]).unwrap()
}
