//! init_root_ring / commit_batch_ring on the fresh build.

use crate::common::{v2::*, *};
use cc_vrf::{errors::VrfError, RING_CAPACITY, RING_VERSION};
use solana_sdk::{account::Account, clock::Clock, signature::Signer};

fn root(n: u64) -> [u8; 32] {
    h("root", n)
}

#[tokio::test(flavor = "multi_thread")]
async fn init_then_commits_fill_and_wrap() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;
    let (ring, bump) = ring_pda(&authority);
    let o = owner.pubkey();

    let p = authority_proof(&rpc, authority).await;
    send_raw(&mut rpc, &[init_ring_ix(&o, lbl, ring, &p)], &[&owner]).expect("init_root_ring");
    let r = read_ring(&rpc, &ring);
    assert_eq!(
        (r.version, r.bump, r.capacity, r.next_seq),
        (RING_VERSION, bump, 128, 1)
    );
    assert_eq!((r.authority, r.owner, r.label), (authority, o, lbl));
    assert!(r.entries.iter().all(|e| e.seq == 0), "starts empty");

    // A second init for the same authority cannot replace it.
    let again = send_raw(&mut rpc, &[init_ring_ix(&o, lbl, ring, &p)], &[&owner]);
    assert!(again.is_err(), "ring already exists");

    for seq in 1..=(RING_CAPACITY as u64 + 1) {
        rpc.context.warp_to_slot(1_000 + seq);
        let sent = send_raw(
            &mut rpc,
            &[ring_commit_ix(
                &o,
                lbl,
                ring,
                root(seq),
                seq as u32,
                1,
                seq,
                &p,
            )],
            &[&owner],
        )
        .unwrap_or_else(|e| panic!("seq {seq}: {:?}", e.0));
        let e = batch_event(&sent.logs);
        assert_eq!(
            (e.root, e.count, e.ring_seq),
            (root(seq), seq as u32, Some(seq))
        );
        if seq == 1 {
            println!("commit_batch_ring CU (fresh authority): {}", sent.cu);
        }
    }
    let r = read_ring(&rpc, &ring);
    assert_eq!(r.next_seq, RING_CAPACITY as u64 + 2);
    // seq 129 evicted seq 1 from slot 1; seqs 2..=129 are live, each at seq % 128.
    let live = |seq: u64| r.entries[(seq % 128) as usize].seq == seq && seq != 0;
    assert!(!live(1));
    for seq in 2..=129u64 {
        let e = r.entries[(seq % 128) as usize];
        assert!(live(seq), "seq {seq}");
        assert_eq!(
            (e.root, e.count, e.leaf_version, e.slot),
            (root(seq), seq as u32, 1, 1_000 + seq)
        );
    }
    assert_eq!(rpc.context.get_sysvar::<Clock>().slot, 1_129);
}

#[tokio::test(flavor = "multi_thread")]
async fn a_retried_commit_cannot_insert_twice() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;
    let (ring, _) = ring_pda(&authority);
    let p = authority_proof(&rpc, authority).await;
    let o = owner.pubkey();
    send_raw(&mut rpc, &[init_ring_ix(&o, lbl, ring, &p)], &[&owner]).unwrap();

    let ix = ring_commit_ix(&o, lbl, ring, root(1), 5, 1, 1, &p);
    send_raw(&mut rpc, &[ix.clone()], &[&owner]).expect("first send");
    assert_eq!(
        failure(send_raw(&mut rpc, &[ix], &[&owner])),
        vrf(VrfError::RingSeqMismatch)
    );
    assert_eq!(read_ring(&rpc, &ring).next_seq, 2);
    // Skipping ahead is refused too.
    let r = send_raw(
        &mut rpc,
        &[ring_commit_ix(&o, lbl, ring, root(3), 5, 1, 3, &p)],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::RingSeqMismatch));
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_planted_and_foreign_rings() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let other = funded(&mut rpc).await;
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;
    let other_authority = frozen_authority(&mut rpc, &other, lbl, TEST_PK).await;
    let (ring, _) = ring_pda(&authority);
    let (other_ring, _) = ring_pda(&other_authority);
    let p = authority_proof(&rpc, authority).await;
    let po = authority_proof(&rpc, other_authority).await;
    let o = owner.pubkey();
    send_raw(&mut rpc, &[init_ring_ix(&o, lbl, ring, &p)], &[&owner]).unwrap();
    send_raw(
        &mut rpc,
        &[init_ring_ix(&other.pubkey(), lbl, other_ring, &po)],
        &[&other],
    )
    .unwrap();
    let commit = |seq| ring_commit_ix(&o, lbl, ring, root(seq), 1, 1, seq, &p);

    // Batch checks still come first.
    let r = send_raw(
        &mut rpc,
        &[ring_commit_ix(&o, lbl, ring, root(1), 0, 1, 1, &p)],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::EmptyBatch));

    // Another authority's ring.
    let r = send_raw(
        &mut rpc,
        &[ring_commit_ix(&o, lbl, other_ring, root(1), 1, 1, 1, &p)],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::RingAuthorityMismatch));

    // Planted states.
    write_ring(&mut rpc, &ring, |r| r.version = 2);
    assert_eq!(
        failure(send_raw(&mut rpc, &[commit(1)], &[&owner])),
        vrf(VrfError::UnsupportedRingVersion)
    );
    write_ring(&mut rpc, &ring, |r| r.version = RING_VERSION);
    write_ring(&mut rpc, &ring, |r| r.authority[31] ^= 1);
    assert_eq!(
        failure(send_raw(&mut rpc, &[commit(1)], &[&owner])),
        vrf(VrfError::RingAuthorityMismatch)
    );
    write_ring(&mut rpc, &ring, |r| r.authority[31] ^= 1);
    write_ring(&mut rpc, &ring, |r| r.next_seq = u64::MAX);
    assert_eq!(
        failure(send_raw(&mut rpc, &[commit(u64::MAX)], &[&owner])),
        vrf(VrfError::RingSeqMismatch)
    );
    write_ring(&mut rpc, &ring, |r| r.next_seq = 1);
    send_raw(&mut rpc, &[commit(1)], &[&owner]).expect("restored ring accepts seq 1");

    // Same bytes under the wrong owner program.
    let mut a: Account = rpc.context.get_account(&ring).unwrap();
    a.owner = anchor_lang::system_program::ID;
    rpc.context.set_account(ring, a).unwrap();
    assert_eq!(
        failure(send_raw(&mut rpc, &[commit(2)], &[&owner])),
        Failure::Custom(3007)
    );
}
