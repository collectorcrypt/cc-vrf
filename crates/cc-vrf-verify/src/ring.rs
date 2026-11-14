//! Read a cc-vrf root ring (`VrfRootRing`, 7,352 bytes) from raw account data, without Anchor.
//!
//! Before trusting the data, the caller checks that the account owner is [`CC_VRF_PROGRAM_ID`] and that its address
//! is that program's PDA `[RING_SEED, authority_address]` for the authority it pinned (bump in the header).

/// ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ
pub const CC_VRF_PROGRAM_ID: [u8; 32] = [
    0x09, 0x1f, 0xf3, 0xef, 0x2b, 0x5c, 0x69, 0xe5, 0xd2, 0x3d, 0x31, 0x77, 0x70, 0x68, 0x5a, 0x95,
    0x29, 0x7f, 0x16, 0xf3, 0x30, 0x96, 0x8c, 0xc8, 0x59, 0xa4, 0x43, 0x0c, 0xa6, 0x03, 0x32, 0xe5,
];
pub const RING_SEED: &[u8] = b"root_ring";
pub const RING_VERSION: u8 = 1;
pub const RING_CAPACITY: u64 = 128;
pub const RING_ACCOUNT_LEN: usize = 7_352;
/// Anchor account discriminator: SHA256("account:VrfRootRing")[..8].
pub const RING_DISCRIMINATOR: [u8; 8] = [0x44, 0xf3, 0xcb, 0xc9, 0x31, 0xda, 0xe4, 0x2e];

const HEADER: usize = 8;
const ENTRIES: usize = HEADER + 176;
const ENTRY_LEN: usize = 56;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RingHeader {
    pub version: u8,
    pub bump: u8,
    pub capacity: u16,
    pub next_seq: u64,
    pub authority: [u8; 32],
    pub owner: [u8; 32],
    pub label: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct RingEntry {
    pub seq: u64,
    pub slot: u64,
    pub root: [u8; 32],
    pub count: u32,
    pub leaf_version: u8,
}

fn u64_at(d: &[u8], o: usize) -> u64 {
    u64::from_le_bytes(d[o..o + 8].try_into().unwrap())
}

fn arr32(d: &[u8], o: usize) -> [u8; 32] {
    d[o..o + 32].try_into().unwrap()
}

/// `None` unless the data is a version-1 ring of the expected size and discriminator.
pub fn header(data: &[u8]) -> Option<RingHeader> {
    if data.len() != RING_ACCOUNT_LEN || data[..8] != RING_DISCRIMINATOR {
        return None;
    }
    let h = RingHeader {
        version: data[HEADER],
        bump: data[HEADER + 1],
        capacity: u16::from_le_bytes([data[HEADER + 2], data[HEADER + 3]]),
        next_seq: u64_at(data, HEADER + 8),
        authority: arr32(data, HEADER + 16),
        owner: arr32(data, HEADER + 48),
        label: arr32(data, HEADER + 80),
    };
    (h.version == RING_VERSION && u64::from(h.capacity) == RING_CAPACITY).then_some(h)
}

/// The entry for `seq` if it is still live: committed (`0 < seq < next_seq`) and not evicted by `seq + 128`.
pub fn entry(data: &[u8], seq: u64) -> Option<RingEntry> {
    let h = header(data)?;
    if seq == 0 || seq >= h.next_seq {
        return None;
    }
    let o = ENTRIES + (seq % RING_CAPACITY) as usize * ENTRY_LEN;
    let e = RingEntry {
        seq: u64_at(data, o),
        slot: u64_at(data, o + 8),
        root: arr32(data, o + 16),
        count: u32::from_le_bytes(data[o + 48..o + 52].try_into().unwrap()),
        leaf_version: data[o + 52],
    };
    (e.seq == seq).then_some(e)
}
