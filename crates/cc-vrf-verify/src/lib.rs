//! Verify cc-vrf batch commits without CPI: rebuild a batch spec v1 leaf from its fields, check its RFC 9162
//! inclusion path against a committed root, read the authority's root ring, and expand beta into a vrfStream.
//!
//! # Batch spec v1 (permanent; any change gets a new leaf_version)
//! ```text
//! leaf = SHA256(0x00 ‖ "ccvrf-batch-v1" ‖ SHA256(memo) ‖ SHA256(alpha) ‖ SHA256(proof80) ‖ beta64)
//! node = SHA256(0x01 ‖ left ‖ right)          root = RFC 9162 MTH over the leaves in index order
//! ```
//! A root is committed with its leaf `count` (in `VrfBatchCommitted` and every ring entry); inclusion is checked
//! against that count (RFC 9162 §2.1.3.2). Always rebuild the leaf from the 80-byte proof: never accept a bare
//! 32-byte leaf, and never treat an inner node as a leaf (the 0x00/0x01 prefixes keep them apart).
//!
//! # Consumer rules (on-chain settlement)
//! - Pin the cc-vrf program id, the authority address and its ring PDA (`["root_ring", authority]`); check the
//!   ring account's owner and address before reading it (see [`ring`]).
//! - Recompute `alpha` from your own request data; never take it from the caller.
//! - Record the settled `SHA256(alpha)` (or your request id) so one result settles once.
//! - The ring keeps 128 entries: latch the entry you depend on (copy root + count) before 128 later commits evict it.
//! - If the operator never commits your request, refund after a timeout instead of waiting forever.
//! - The leaf binds `SHA256(proof)` and `beta`, and the 80-byte proof is public in the settlement transaction, so a
//!   beta that does not match its proof is publicly provable (verify the ECVRF math off-chain).
//!
//! One user opening 100 packs needs one alpha and [`vrf_stream_block`]; the ring is for many independent requests
//! settled across transactions.
#![no_std]
extern crate alloc;

use alloc::vec::Vec;

pub mod ring;

pub const LEAF_VERSION_V1: u8 = 1;
pub const LEAF_TAG_V1: &[u8; 14] = b"ccvrf-batch-v1";
pub const PROOF_LEN: usize = 80;
pub const BETA_LEN: usize = 64;
/// Largest `count` the program accepts in one commit.
pub const MAX_BATCH_COUNT: u64 = 1 << 20;

/// SHA-256 over the concatenation of `parts`. On-chain, implement it with the sol_sha256 syscall (solana `hashv`).
pub trait Sha256Hasher {
    fn hashv(parts: &[&[u8]]) -> [u8; 32];
}

/// SHA-512 over the concatenation of `parts` (only [`vrf_stream_block`] needs it).
pub trait Sha512Hasher {
    fn hashv(parts: &[&[u8]]) -> [u8; 64];
}

/// Software hashing (feature `sha2`, on by default).
#[cfg(feature = "sha2")]
pub struct Sha2;

#[cfg(feature = "sha2")]
impl Sha256Hasher for Sha2 {
    fn hashv(parts: &[&[u8]]) -> [u8; 32] {
        use sha2::Digest;
        let mut h = sha2::Sha256::new();
        for p in parts {
            h.update(p);
        }
        h.finalize().into()
    }
}

#[cfg(feature = "sha2")]
impl Sha512Hasher for Sha2 {
    fn hashv(parts: &[&[u8]]) -> [u8; 64] {
        use sha2::Digest;
        let mut h = sha2::Sha512::new();
        for p in parts {
            h.update(p);
        }
        h.finalize().into()
    }
}

/// The fields one VRF result commits to. `memo` and `alpha` are hashed into the leaf; the proof is required whole.
#[derive(Clone, Copy, Debug)]
pub struct LeafV1<'a> {
    pub memo: &'a [u8],
    pub alpha: &'a [u8],
    pub proof: &'a [u8; PROOF_LEN],
    pub beta: &'a [u8; BETA_LEN],
}

/// Batch spec v1 leaf from its fields.
pub fn leaf_v1<H: Sha256Hasher>(f: &LeafV1) -> [u8; 32] {
    leaf_v1_from_hashes::<H>(&H::hashv(&[f.memo]), &H::hashv(&[f.alpha]), f.proof, f.beta)
}

/// The same leaf when the consumer stores `SHA256(memo)` and `SHA256(alpha)`; the proof is still required whole.
pub fn leaf_v1_from_hashes<H: Sha256Hasher>(
    memo_hash: &[u8; 32],
    alpha_hash: &[u8; 32],
    proof: &[u8; PROOF_LEN],
    beta: &[u8; BETA_LEN],
) -> [u8; 32] {
    let proof_hash = H::hashv(&[proof]);
    H::hashv(&[
        &[0x00],
        LEAF_TAG_V1,
        memo_hash,
        alpha_hash,
        &proof_hash,
        beta,
    ])
}

pub fn node<H: Sha256Hasher>(left: &[u8; 32], right: &[u8; 32]) -> [u8; 32] {
    H::hashv(&[&[0x01], left, right])
}

/// RFC 9162 §2.1.3.2: is `leaf` at `index` of a `count`-leaf tree with root `root`, given `path` (leaf level first)?
pub fn verify_inclusion<H: Sha256Hasher>(
    root: &[u8; 32],
    count: u64,
    index: u64,
    leaf: &[u8; 32],
    path: &[[u8; 32]],
) -> bool {
    if count == 0 || index >= count {
        return false;
    }
    let (mut fnode, mut snode) = (index, count - 1);
    let mut r = *leaf;
    for p in path {
        if snode == 0 {
            return false;
        }
        if fnode & 1 == 1 || fnode == snode {
            r = node::<H>(p, &r);
            while fnode & 1 == 0 && fnode != 0 {
                fnode >>= 1;
                snode >>= 1;
            }
        } else {
            r = node::<H>(&r, p);
        }
        fnode >>= 1;
        snode >>= 1;
    }
    snode == 0 && r == *root
}

/// Rebuilds the leaf from `fields` and checks it against `root`/`count`. Use the count the commit recorded.
pub fn verify_leaf_v1<H: Sha256Hasher>(
    root: &[u8; 32],
    count: u64,
    index: u64,
    fields: &LeafV1,
    path: &[[u8; 32]],
) -> bool {
    count <= MAX_BATCH_COUNT
        && verify_inclusion::<H>(root, count, index, &leaf_v1::<H>(fields), path)
}

/// Largest power of two strictly below `n` (n >= 2).
fn split(n: usize) -> usize {
    let mut k = 1;
    while k << 1 < n {
        k <<= 1;
    }
    k
}

/// RFC 9162 MTH over leaf hashes. Panics on an empty slice (a batch has at least one leaf).
pub fn root<H: Sha256Hasher>(leaves: &[[u8; 32]]) -> [u8; 32] {
    assert!(!leaves.is_empty(), "a batch has at least one leaf");
    if leaves.len() == 1 {
        return leaves[0];
    }
    let k = split(leaves.len());
    node::<H>(&root::<H>(&leaves[..k]), &root::<H>(&leaves[k..]))
}

/// RFC 9162 §2.1.3.1 PATH(index, leaves), leaf level first.
pub fn path<H: Sha256Hasher>(leaves: &[[u8; 32]], index: usize) -> Vec<[u8; 32]> {
    assert!(index < leaves.len(), "index out of range");
    let mut out = Vec::new();
    path_into::<H>(leaves, index, &mut out);
    out
}

fn path_into<H: Sha256Hasher>(leaves: &[[u8; 32]], index: usize, out: &mut Vec<[u8; 32]>) {
    if leaves.len() <= 1 {
        return;
    }
    let k = split(leaves.len());
    if index < k {
        path_into::<H>(&leaves[..k], index, out);
        out.push(root::<H>(&leaves[k..]));
    } else {
        path_into::<H>(&leaves[k..], index - k, out);
        out.push(root::<H>(&leaves[..k]));
    }
}

const EXPAND_TAG: &[u8] = b"ecvrf-expand-v1";

/// Block `index` of `vrfStream(beta, ...path)` from @collectorcrypt/ecvrf:
/// `SHA512("ecvrf-expand-v1" ‖ beta ‖ u32be(len(path)) ‖ (u32be(len(seg)) ‖ seg)* ‖ u64be(index))`.
pub fn vrf_stream_block<H: Sha512Hasher>(
    beta: &[u8; BETA_LEN],
    path: &[&[u8]],
    index: u64,
) -> [u8; 64] {
    let count = (path.len() as u32).to_be_bytes();
    let lens: Vec<[u8; 4]> = path
        .iter()
        .map(|s| (s.len() as u32).to_be_bytes())
        .collect();
    let block = index.to_be_bytes();
    let mut parts: Vec<&[u8]> = Vec::with_capacity(4 + 2 * path.len());
    parts.push(EXPAND_TAG);
    parts.push(beta);
    parts.push(&count);
    for (seg, len) in path.iter().zip(lens.iter()) {
        parts.push(len);
        parts.push(seg);
    }
    parts.push(&block);
    H::hashv(&parts)
}
