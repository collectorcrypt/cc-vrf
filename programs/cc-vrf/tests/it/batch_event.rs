//! commit_batch_event on the fresh build (bash scripts/build-sbf.sh, then bash scripts/test-prover.sh).

use crate::common::{v2::*, *};
use cc_vrf::errors::VrfError;
use solana_sdk::{clock::Clock, signature::Signer};

const ROOT: [u8; 32] = [0xab; 32];

#[tokio::test(flavor = "multi_thread")]
async fn emits_one_event_with_the_fixed_prefix() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;

    let p = authority_proof(&rpc, authority).await;
    let ix = batch_event_ix(&owner.pubkey(), lbl, ROOT, 3, 1, &p);
    let mut prefix = lbl.to_vec();
    prefix.extend_from_slice(&ROOT);
    prefix.extend_from_slice(&3u32.to_le_bytes());
    prefix.push(1);
    assert_eq!(
        &ix.data[8..77],
        &prefix[..],
        "consumers read label, root, count, leaf_version at data[8..77]"
    );

    let sent = send_raw(&mut rpc, &[ix], &[&owner]).expect("commit_batch_event");
    let e = batch_event(&sent.logs);
    let slot = rpc.context.get_sysvar::<Clock>().slot;
    assert_eq!(
        (
            e.owner,
            e.label,
            e.root,
            e.count,
            e.leaf_version,
            e.ring_seq,
            e.committed_slot
        ),
        (owner.pubkey(), lbl, ROOT, 3, 1, None, slot)
    );
    println!(
        "commit_batch_event CU (fresh authority, proof by index): {}",
        sent.cu
    );
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_bad_batches_before_the_light_cpi() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;
    let p = authority_proof(&rpc, authority).await;
    let o = owner.pubkey();
    let cases = [
        (ROOT, 0u32, 1u8, VrfError::EmptyBatch),
        (ROOT, (1 << 20) + 1, 1, VrfError::BatchTooLarge),
        (ROOT, 3, 0, VrfError::UnsupportedLeafVersion),
        (ROOT, 3, 2, VrfError::UnsupportedLeafVersion),
        ([0u8; 32], 3, 1, VrfError::ZeroBatchRoot),
    ];
    for (root, count, lv, want) in cases {
        let r = send_raw(
            &mut rpc,
            &[batch_event_ix(&o, lbl, root, count, lv, &p)],
            &[&owner],
        );
        assert_eq!(failure(r), vrf(want), "count {count} lv {lv}");
    }
    // The edges are accepted.
    send_raw(
        &mut rpc,
        &[batch_event_ix(&o, lbl, ROOT, 1, 1, &p)],
        &[&owner],
    )
    .expect("count 1");
    send_raw(
        &mut rpc,
        &[batch_event_ix(&o, lbl, ROOT, 1 << 20, 1, &p)],
        &[&owner],
    )
    .expect("count 2^20");
}

#[tokio::test(flavor = "multi_thread")]
async fn proves_the_authority() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let stranger = funded(&mut rpc).await;
    let lbl = label("gacha");

    // Not frozen yet.
    let unfrozen = init_authority(&mut rpc, &owner, lbl, TEST_PK)
        .await
        .unwrap();
    let p = authority_proof(&rpc, unfrozen).await;
    let r = send_raw(
        &mut rpc,
        &[batch_event_ix(&owner.pubkey(), lbl, ROOT, 1, 1, &p)],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::AuthorityNotFrozen));
    freeze_authority(&mut rpc, &owner, unfrozen).await.unwrap();
    let p = authority_proof(&rpc, unfrozen).await;

    // Wrong signer, wrong label, wrong address.
    let r = send_raw(
        &mut rpc,
        &[batch_event_ix(&stranger.pubkey(), lbl, ROOT, 1, 1, &p)],
        &[&stranger],
    );
    assert_eq!(failure(r), vrf(VrfError::NotOwner));
    let r = send_raw(
        &mut rpc,
        &[batch_event_ix(
            &owner.pubkey(),
            label("other"),
            ROOT,
            1,
            1,
            &p,
        )],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::AuthorityLabelMismatch));
    let mut moved = authority_proof(&rpc, unfrozen).await;
    moved.meta.address[0] ^= 1;
    let r = send_raw(
        &mut rpc,
        &[batch_event_ix(&owner.pubkey(), lbl, ROOT, 1, 1, &moved)],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::AuthorityAddressMismatch));

    // A forged current_authority passes our checks but not Light's: the proof binds it to the stored hash.
    let mut forged = authority_proof(&rpc, unfrozen).await;
    forged.current.pk[0] ^= 1;
    let (f, logs) = send_raw(
        &mut rpc,
        &[batch_event_ix(&owner.pubkey(), lbl, ROOT, 1, 1, &forged)],
        &[&owner],
    )
    .err()
    .expect("forged authority must fail");
    let ours = (u32::from(VrfError::AuthorityFrozen)
        ..=u32::from(VrfError::PossessionMessageMismatch))
        .contains(&match f {
            Failure::Custom(c) => c,
            _ => 0,
        });
    assert!(!ours, "must fail inside Light, not in cc_vrf: {f:?}");
    assert!(
        logs.iter()
            .any(|l| l.contains("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7 failed")),
        "Light system program must reject: {logs:#?}"
    );
    for l in logs
        .iter()
        .filter(|l| l.contains("Error") || l.contains("failed"))
    {
        println!("forged authority: {l}");
    }

    send_raw(
        &mut rpc,
        &[batch_event_ix(&owner.pubkey(), lbl, ROOT, 1, 1, &p)],
        &[&owner],
    )
    .expect("valid commit");
}
