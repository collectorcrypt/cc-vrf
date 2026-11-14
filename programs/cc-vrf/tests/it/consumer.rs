//! A program settling against the root ring with cc-vrf-verify: live entries, latching before eviction, double settle,
//! forged fields, and rings that are not the authority's.
use anchor_lang::{Discriminator, InstructionData, ToAccountMetas};
use cc_vrf_verify::{leaf_v1, path, ring as vring, root, LeafV1, Sha2};
use mock_consumer::ConsumerError;
use solana_sdk::{instruction::Instruction, pubkey::Pubkey, signature::Signer};

use crate::common::{v2::*, *};

struct Req {
    memo: Vec<u8>,
    alpha: Vec<u8>,
    proof: [u8; 80],
    beta: [u8; 64],
}

fn requests(n: u8) -> Vec<Req> {
    (0..n)
        .map(|i| Req {
            memo: format!("req-{i}").into_bytes(),
            alpha: format!("alpha-{i}").into_bytes(),
            proof: [i; 80],
            beta: [i + 100; 64],
        })
        .collect()
}

fn leaves(reqs: &[Req]) -> Vec<[u8; 32]> {
    reqs.iter()
        .map(|r| {
            leaf_v1::<Sha2>(&LeafV1 {
                memo: &r.memo,
                alpha: &r.alpha,
                proof: &r.proof,
                beta: &r.beta,
            })
        })
        .collect()
}

/// The mock consumer build; same stale guard as target_deploy().
fn mock_so() -> std::path::PathBuf {
    let root_dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let so = root_dir.join("target/test-programs/mock_consumer.so");
    let built = std::fs::metadata(&so)
        .and_then(|m| m.modified())
        .expect("run bash scripts/build-sbf.sh");
    for src in [
        "tests/mock-consumer/src/lib.rs",
        "crates/cc-vrf-verify/src/lib.rs",
        "crates/cc-vrf-verify/src/ring.rs",
    ] {
        let m = std::fs::metadata(root_dir.join(src))
            .unwrap()
            .modified()
            .unwrap();
        assert!(
            built >= m,
            "mock_consumer.so is older than {src}: run bash scripts/build-sbf.sh"
        );
    }
    so
}

fn latch_pda(authority: &[u8; 32], seq: u64) -> Pubkey {
    Pubkey::find_program_address(
        &[b"latch", authority, &seq.to_le_bytes()],
        &mock_consumer::ID,
    )
    .0
}

fn latch_ix(payer: &Pubkey, ring: Pubkey, authority: [u8; 32], seq: u64) -> Instruction {
    Instruction {
        program_id: mock_consumer::ID,
        accounts: mock_consumer::accounts::Latch {
            payer: *payer,
            ring,
            latched: latch_pda(&authority, seq),
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: mock_consumer::instruction::Latch { authority, seq }.data(),
    }
}

#[allow(clippy::too_many_arguments)]
fn settle_ix(
    payer: &Pubkey,
    ring: Pubkey,
    latched: Option<Pubkey>,
    authority: [u8; 32],
    seq: u64,
    index: u64,
    r: &Req,
    path: Vec<[u8; 32]>,
    beta: [u8; 64],
) -> Instruction {
    let alpha_hash = solana_sdk::hash::hash(&r.alpha).to_bytes();
    settle_ix_keyed(
        payer, ring, latched, authority, seq, index, alpha_hash, r, path, beta,
    )
}

/// settle_ix with a caller-chosen settled key, to show it must hash alpha.
#[allow(clippy::too_many_arguments)]
fn settle_ix_keyed(
    payer: &Pubkey,
    ring: Pubkey,
    latched: Option<Pubkey>,
    authority: [u8; 32],
    seq: u64,
    index: u64,
    alpha_hash: [u8; 32],
    r: &Req,
    path: Vec<[u8; 32]>,
    beta: [u8; 64],
) -> Instruction {
    let settled = Pubkey::find_program_address(&[b"settled", &alpha_hash], &mock_consumer::ID).0;
    Instruction {
        program_id: mock_consumer::ID,
        accounts: mock_consumer::accounts::Settle {
            payer: *payer,
            ring,
            latched,
            settled,
            system_program: anchor_lang::system_program::ID,
        }
        .to_account_metas(None),
        data: mock_consumer::instruction::Settle {
            authority,
            seq,
            index,
            alpha_hash,
            memo: r.memo.clone(),
            alpha: r.alpha.clone(),
            proof: r.proof,
            beta,
            path,
        }
        .data(),
    }
}

fn consumer(e: ConsumerError) -> Failure {
    Failure::Custom(u32::from(e))
}

#[test]
fn verify_crate_constants_match_the_program() {
    assert_eq!(vring::CC_VRF_PROGRAM_ID, cc_vrf::ID.to_bytes());
    assert_eq!(
        &vring::RING_DISCRIMINATOR[..],
        cc_vrf::VrfRootRing::DISCRIMINATOR
    );
    assert_eq!(vring::RING_SEED, cc_vrf::RING_SEED);
    assert_eq!(
        vring::RING_ACCOUNT_LEN,
        8 + core::mem::size_of::<cc_vrf::VrfRootRing>()
    );
    assert_eq!(
        u64::from(cc_vrf::MAX_BATCH_COUNT),
        cc_vrf_verify::MAX_BATCH_COUNT
    );
    assert_eq!(cc_vrf::BATCH_LEAF_VERSION, cc_vrf_verify::LEAF_VERSION_V1);
}

#[tokio::test(flavor = "multi_thread")]
async fn settles_from_the_ring_and_from_a_latch() {
    let mut rpc = rpc_with(&target_deploy()).await;
    rpc.context
        .add_program_from_file(mock_consumer::ID, mock_so())
        .unwrap();
    let owner = funded(&mut rpc).await;
    let player = funded(&mut rpc).await;
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;
    let (ring, _) = ring_pda(&authority);
    let p = authority_proof(&rpc, authority).await;
    let o = owner.pubkey();
    send_raw(&mut rpc, &[init_ring_ix(&o, lbl, ring, &p)], &[&owner]).unwrap();

    let reqs = requests(5);
    let ls = leaves(&reqs);
    let r1 = root::<Sha2>(&ls);
    send_raw(
        &mut rpc,
        &[ring_commit_ix(&o, lbl, ring, r1, 5, 1, 1, &p)],
        &[&owner],
    )
    .unwrap();

    // The crate reads the program's real account.
    let data = rpc.context.get_account(&ring).unwrap().data;
    let e = vring::entry(&data, 1).expect("live entry");
    assert_eq!((e.root, e.count, e.leaf_version), (r1, 5, 1));

    let pl = player.pubkey();
    let settle = |seq, index: usize, latched, path: Vec<[u8; 32]>, beta| {
        settle_ix(
            &pl,
            ring,
            latched,
            authority,
            seq,
            index as u64,
            &reqs[index],
            path,
            beta,
        )
    };
    let sent = send_raw(
        &mut rpc,
        &[settle(1, 2, None, path::<Sha2>(&ls, 2), reqs[2].beta)],
        &[&player],
    )
    .expect("settle from the live ring");
    println!("mock consumer settle CU: {}", sent.cu);
    assert!(
        send_raw(
            &mut rpc,
            &[settle(1, 2, None, path::<Sha2>(&ls, 2), reqs[2].beta)],
            &[&player]
        )
        .is_err(),
        "settles once per alpha"
    );
    // A second key for the same alpha would allow a second settle.
    let rekeyed = settle_ix_keyed(
        &pl,
        ring,
        None,
        authority,
        1,
        2,
        h("other", 2),
        &reqs[2],
        path::<Sha2>(&ls, 2),
        reqs[2].beta,
    );
    assert_eq!(
        failure(send_raw(&mut rpc, &[rekeyed], &[&player])),
        consumer(ConsumerError::AlphaHashMismatch),
        "settled key must hash alpha"
    );

    // Forged fields never verify.
    let mut forged = reqs[4].beta;
    forged[0] ^= 1;
    assert_eq!(
        failure(send_raw(
            &mut rpc,
            &[settle(1, 4, None, path::<Sha2>(&ls, 4), forged)],
            &[&player]
        )),
        consumer(ConsumerError::NotInBatch),
        "forged beta"
    );
    let wrong_index = settle_ix(
        &pl,
        ring,
        None,
        authority,
        1,
        3,
        &reqs[4],
        path::<Sha2>(&ls, 4),
        reqs[4].beta,
    );
    assert_eq!(
        failure(send_raw(&mut rpc, &[wrong_index], &[&player])),
        consumer(ConsumerError::NotInBatch),
        "wrong index"
    );
    let mut bent = path::<Sha2>(&ls, 4);
    bent[0][5] ^= 1;
    assert_eq!(
        failure(send_raw(
            &mut rpc,
            &[settle(1, 4, None, bent, reqs[4].beta)],
            &[&player]
        )),
        consumer(ConsumerError::NotInBatch),
        "tampered path"
    );
    assert_eq!(
        failure(send_raw(
            &mut rpc,
            &[settle(2, 4, None, path::<Sha2>(&ls, 4), reqs[4].beta)],
            &[&player]
        )),
        consumer(ConsumerError::EntryNotLive),
        "uncommitted seq"
    );

    // Latch seq 1, then evict it with 128 more commits.
    send_raw(&mut rpc, &[latch_ix(&pl, ring, authority, 1)], &[&player]).expect("latch");
    for seq in 2..=129u64 {
        send_raw(
            &mut rpc,
            &[ring_commit_ix(&o, lbl, ring, h("root", seq), 1, 1, seq, &p)],
            &[&owner],
        )
        .unwrap();
    }
    let data = rpc.context.get_account(&ring).unwrap().data;
    assert!(vring::entry(&data, 1).is_none(), "seq 1 evicted");
    assert_eq!(
        failure(send_raw(
            &mut rpc,
            &[settle(1, 3, None, path::<Sha2>(&ls, 3), reqs[3].beta)],
            &[&player]
        )),
        consumer(ConsumerError::EntryNotLive)
    );
    send_raw(
        &mut rpc,
        &[settle(
            1,
            3,
            Some(latch_pda(&authority, 1)),
            path::<Sha2>(&ls, 3),
            reqs[3].beta,
        )],
        &[&player],
    )
    .expect("settle from the latch after eviction");
    let wrong_latch = settle_ix(
        &pl,
        ring,
        Some(latch_pda(&authority, 1)),
        authority,
        2,
        0,
        &reqs[0],
        path::<Sha2>(&ls, 0),
        reqs[0].beta,
    );
    assert_eq!(
        failure(send_raw(&mut rpc, &[wrong_latch], &[&player])),
        consumer(ConsumerError::WrongLatch)
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_rings_that_are_not_the_authoritys() {
    let mut rpc = rpc_with(&target_deploy()).await;
    rpc.context
        .add_program_from_file(mock_consumer::ID, mock_so())
        .unwrap();
    let owner = funded(&mut rpc).await;
    let other = funded(&mut rpc).await;
    let player = funded(&mut rpc).await;
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;
    let other_authority = frozen_authority(&mut rpc, &other, lbl, TEST_PK).await;
    let (ring, _) = ring_pda(&authority);
    let (other_ring, _) = ring_pda(&other_authority);
    for (kp, a, rg) in [
        (&owner, authority, ring),
        (&other, other_authority, other_ring),
    ] {
        let p = authority_proof(&rpc, a).await;
        send_raw(&mut rpc, &[init_ring_ix(&kp.pubkey(), lbl, rg, &p)], &[kp]).unwrap();
    }
    let reqs = requests(2);
    let ls = leaves(&reqs);
    let p = authority_proof(&rpc, other_authority).await;
    send_raw(
        &mut rpc,
        &[ring_commit_ix(
            &other.pubkey(),
            lbl,
            other_ring,
            root::<Sha2>(&ls),
            2,
            1,
            1,
            &p,
        )],
        &[&other],
    )
    .unwrap();
    let pl = player.pubkey();

    // Another authority's ring, presented as ours.
    let r = send_raw(
        &mut rpc,
        &[settle_ix(
            &pl,
            other_ring,
            None,
            authority,
            1,
            0,
            &reqs[0],
            path::<Sha2>(&ls, 0),
            reqs[0].beta,
        )],
        &[&player],
    );
    assert_eq!(failure(r), consumer(ConsumerError::WrongRing));

    // Our ring's bytes copied to an account the consumer does not trust.
    let mut fake = rpc.context.get_account(&other_ring).unwrap();
    fake.owner = mock_consumer::ID;
    let fake_key = Pubkey::new_unique();
    rpc.context.set_account(fake_key, fake).unwrap();
    let r = send_raw(
        &mut rpc,
        &[settle_ix(
            &pl,
            fake_key,
            None,
            other_authority,
            1,
            0,
            &reqs[0],
            path::<Sha2>(&ls, 0),
            reqs[0].beta,
        )],
        &[&player],
    );
    assert_eq!(failure(r), consumer(ConsumerError::WrongRing));

    send_raw(
        &mut rpc,
        &[settle_ix(
            &pl,
            other_ring,
            None,
            other_authority,
            1,
            0,
            &reqs[0],
            path::<Sha2>(&ls, 0),
            reqs[0].beta,
        )],
        &[&player],
    )
    .expect("the real ring settles");
}
