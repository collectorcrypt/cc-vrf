//! Day-1 spike: the deployed RC1 binary under light-program-test: init → freeze → the three commit modes.
//! Run: cargo test -p cc-vrf --test it light_spike   (CC_VRF_SO=target: the fresh build)

use crate::common::*;
use solana_sdk::signature::Signer;

#[tokio::test(flavor = "multi_thread")]
async fn rc1_init_freeze_three_commits() {
    // CC_VRF_SO=target runs the fresh scripts/build-sbf.sh build instead of RC1.
    let dir = if std::env::var("CC_VRF_SO").as_deref() == Ok("target") {
        target_deploy()
    } else {
        rc1_dir()
    };
    let mut rpc = rpc_with(&dir).await;
    let owner = funded(&mut rpc).await;
    let lbl = label("gacha");

    let authority = init_authority(&mut rpc, &owner, lbl, TEST_PK)
        .await
        .expect("init_authority");
    let a = fetch_authority(&rpc, authority).await.authority;
    assert_eq!(
        (a.owner, a.pk, a.suite, a.frozen, a.revoked, a.label),
        (owner.pubkey(), TEST_PK, SUITE, false, false, lbl)
    );

    freeze_authority(&mut rpc, &owner, authority)
        .await
        .expect("freeze_authority");
    assert!(fetch_authority(&rpc, authority).await.authority.frozen);

    let m1 = h("memo", 1);
    let c1 = commit_registry(&mut rpc, &owner, authority, m1, None)
        .await
        .expect("commit_proof");
    let pc = decode_commit(&fetch_commit(&rpc, c1).await.expect("commit account"));
    assert_eq!((pc.authority.to_bytes(), pc.memo_hash), (authority, m1));

    let m2 = h("memo", 2);
    let beta = [9u8; 64];
    let c2 = commit_registry(&mut rpc, &owner, authority, m2, Some(beta))
        .await
        .expect("commit_proof_with_beta");
    let pb = decode_commit_with_beta(&fetch_commit(&rpc, c2).await.expect("beta commit account"));
    assert_eq!(
        (pb.memo_hash, pb.beta_lo, pb.beta_hi),
        (m2, [9u8; 32], [9u8; 32])
    );

    commit_event(&mut rpc, &owner, authority, lbl, h("memo", 3))
        .await
        .expect("commit_proof_event");

    // Replay protection on the registry: the same memo cannot be committed twice.
    assert!(
        commit_registry(&mut rpc, &owner, authority, m1, None)
            .await
            .is_err(),
        "duplicate memo must fail"
    );
}
