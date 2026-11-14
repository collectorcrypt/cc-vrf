//! The mainnet scenario: authorities and commits made by RC1, then the binary replaced by the fresh v2 build.

use crate::common::{v2::*, *};
use cc_vrf::{ed25519::possession_message, errors::VrfError};
use solana_sdk::signature::Signer;

/// RFC 8032 §7.1 test key 1: its public key is TEST_PK, so it can sign the possession message.
fn test_pk_signer() -> solana_sdk::signature::Keypair {
    let seed = [
        0x9d, 0x61, 0xb1, 0x9d, 0xef, 0xfd, 0x5a, 0x60, 0xba, 0x84, 0x4a, 0xf4, 0x92, 0xec, 0x2c,
        0xc4, 0x44, 0x49, 0xc5, 0x69, 0x7b, 0x32, 0x69, 0x19, 0x70, 0x3b, 0xac, 0x03, 0x1c, 0xae,
        0x7f, 0x60,
    ];
    solana_sdk::signer::keypair::keypair_from_seed(&seed).unwrap()
}

#[tokio::test(flavor = "multi_thread")]
async fn rc1_state_keeps_working_after_the_upgrade() {
    let mut rpc = rpc_with(&rc1_dir()).await;
    let owner = funded(&mut rpc).await;
    let o = owner.pubkey();
    let lbl = label("gacha");
    let vrf_sk = test_pk_signer();
    assert_eq!(vrf_sk.pubkey().to_bytes(), TEST_PK);

    // Under RC1: a live authority with a registry-beta commit, and a second authority revoked.
    let authority = frozen_authority(&mut rpc, &owner, lbl, TEST_PK).await;
    let m1 = h("memo", 1);
    commit_registry(&mut rpc, &owner, authority, m1, Some([1u8; 64]))
        .await
        .expect("RC1 commit_proof_with_beta");
    let old = label("old");
    let revoked = frozen_authority(&mut rpc, &owner, old, TEST_PK).await;
    let rix = revoke_ix(&rpc, &owner, revoked).await;
    send(&mut rpc, rix, &owner)
        .await
        .expect("RC1 revoke_authority");
    assert!(fetch_authority(&rpc, revoked).await.authority.revoked);

    load_program(&mut rpc, &target_deploy());

    // Kept instructions on RC1 state; replay protection survives.
    commit_registry(&mut rpc, &owner, authority, h("memo", 2), Some([2u8; 64]))
        .await
        .expect("v2 commit_proof_with_beta");
    commit_registry(&mut rpc, &owner, authority, h("memo", 3), None)
        .await
        .expect("v2 commit_proof");
    commit_event(&mut rpc, &owner, authority, lbl, h("memo", 4))
        .await
        .expect("v2 commit_proof_event");
    let dup = commit_registry(&mut rpc, &owner, authority, m1, Some([1u8; 64])).await;
    assert!(
        dup.is_err(),
        "a memo committed under RC1 cannot be committed again"
    );

    // New instructions on the RC1 authority.
    let p = authority_proof(&rpc, authority).await;
    send_raw(
        &mut rpc,
        &[batch_event_ix(&o, lbl, [5; 32], 2, 1, &p)],
        &[&owner],
    )
    .expect("commit_batch_event");
    let (ring, _) = ring_pda(&authority);
    send_raw(&mut rpc, &[init_ring_ix(&o, lbl, ring, &p)], &[&owner]).expect("init_root_ring");
    send_raw(
        &mut rpc,
        &[ring_commit_ix(&o, lbl, ring, [6; 32], 1, 1, 1, &p)],
        &[&owner],
    )
    .expect("commit_batch_ring");
    let (pda, _) = pop_pda(&authority);
    let msg = possession_message(&o, &lbl);
    send_raw(
        &mut rpc,
        &[ed25519_ix(&vrf_sk, &msg), attest_ix(&o, lbl, pda, &p)],
        &[&owner],
    )
    .expect("attest_possession");

    // An authority revoked under RC1 stays refused on every commit path.
    let pr = authority_proof(&rpc, revoked).await;
    let r = send_raw(
        &mut rpc,
        &[batch_event_ix(&o, old, [5; 32], 2, 1, &pr)],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::AuthorityRevoked));
    let r = commit_registry(&mut rpc, &owner, revoked, h("memo", 9), Some([9u8; 64])).await;
    assert_eq!(
        r.err().and_then(|e| rpc_code(&e)),
        Some(u32::from(VrfError::AuthorityRevoked))
    );
    let r = commit_event(&mut rpc, &owner, revoked, old, h("memo", 10)).await;
    assert_eq!(
        r.err().and_then(|e| rpc_code(&e)),
        Some(u32::from(VrfError::AuthorityRevoked))
    );

    // revoke_authority no longer exists.
    let rix = revoke_ix(&rpc, &owner, authority).await;
    assert_eq!(
        failure(send_raw(&mut rpc, &[rix], &[&owner])),
        Failure::Custom(101),
        "InstructionFallbackNotFound"
    );
    assert!(!fetch_authority(&rpc, authority).await.authority.revoked);
}
