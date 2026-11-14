//! attest_possession on the fresh build: the happy path and every Ed25519 spoof.

use crate::common::{v2::*, *};
use cc_vrf::{ed25519::possession_message, errors::VrfError};
use solana_sdk::{clock::Clock, signature::Signer};

#[tokio::test(flavor = "multi_thread")]
async fn records_possession_once() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let vrf_sk = vrf_key(7);
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, vrf_sk.pubkey().to_bytes()).await;
    let (pda, _) = pop_pda(&authority);
    let p = authority_proof(&rpc, authority).await;
    let o = owner.pubkey();
    let msg = possession_message(&o, &lbl);

    let sent = send_raw(
        &mut rpc,
        &[ed25519_ix(&vrf_sk, &msg), attest_ix(&o, lbl, pda, &p)],
        &[&owner],
    )
    .expect("attest");
    let slot = rpc.context.get_sysvar::<Clock>().slot;
    let a = read_possession(&rpc, &pda).expect("attestation account");
    assert_eq!(
        (a.authority, a.pk, a.slot),
        (authority, vrf_sk.pubkey().to_bytes(), slot)
    );
    let e = possession_event(&sent.logs);
    assert_eq!(
        (e.authority, e.owner, e.label, e.pk, e.slot),
        (authority, o, lbl, vrf_sk.pubkey().to_bytes(), slot)
    );
    assert_eq!(rpc.context.get_account(&pda).unwrap().data.len(), 80);
    println!("attest_possession CU: {}", sent.cu);

    let again = send_raw(
        &mut rpc,
        &[ed25519_ix(&vrf_sk, &msg), attest_ix(&o, lbl, pda, &p)],
        &[&owner],
    );
    assert!(again.is_err(), "the attestation is written once");
}

#[tokio::test(flavor = "multi_thread")]
async fn refuses_every_spoof() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let vrf_sk = vrf_key(7);
    let other_sk = vrf_key(8);
    let lbl = label("gacha");
    let authority = frozen_authority(&mut rpc, &owner, lbl, vrf_sk.pubkey().to_bytes()).await;
    let (pda, _) = pop_pda(&authority);
    let p = authority_proof(&rpc, authority).await;
    let o = owner.pubkey();
    let msg = possession_message(&o, &lbl);
    let attest = attest_ix(&o, lbl, pda, &p);

    let r = send_raw(&mut rpc, &[attest.clone()], &[&owner]);
    assert_eq!(
        failure(r),
        vrf(VrfError::MissingEd25519Instruction),
        "no signature"
    );

    let r = send_raw(
        &mut rpc,
        &[
            ed25519_ix(&vrf_sk, &msg),
            ed25519_ix(&vrf_sk, &msg),
            attest.clone(),
        ],
        &[&owner],
    );
    assert_eq!(
        failure(r),
        vrf(VrfError::MultipleEd25519Instructions),
        "a second precompile instruction"
    );

    let r = send_raw(
        &mut rpc,
        &[
            ed25519_two_sigs_ix(&vrf_sk, &other_sk, &msg),
            attest.clone(),
        ],
        &[&owner],
    );
    assert_eq!(
        failure(r),
        vrf(VrfError::MalformedEd25519Instruction),
        "two signatures in one instruction"
    );

    let (carrier, indirect) = ed25519_indirect_ix(&vrf_sk, &msg, 0);
    let r = send_raw(&mut rpc, &[carrier, indirect, attest.clone()], &[&owner]);
    assert_eq!(
        failure(r),
        vrf(VrfError::Ed25519IndirectReference),
        "offsets into another instruction"
    );

    let r = send_raw(
        &mut rpc,
        &[ed25519_ix(&other_sk, &msg), attest.clone()],
        &[&owner],
    );
    assert_eq!(
        failure(r),
        vrf(VrfError::PossessionKeyMismatch),
        "signed by a key that is not the authority's pk"
    );

    // One flipped byte in each field: domain, program id, owner, label (first and last byte).
    for (at, field) in [
        (0, "domain"),
        (18, "program id"),
        (50, "owner"),
        (82, "label"),
        (113, "label end"),
    ] {
        let mut tampered = msg;
        tampered[at] ^= 1;
        let r = send_raw(
            &mut rpc,
            &[ed25519_ix(&vrf_sk, &tampered), attest.clone()],
            &[&owner],
        );
        assert_eq!(
            failure(r),
            vrf(VrfError::PossessionMessageMismatch),
            "tampered {field}"
        );
    }

    let mut longer = msg.to_vec();
    longer.push(0);
    for (m, what) in [
        (&msg[..32], "a 32-byte message is never accepted"),
        (&msg[..113], "one byte short"),
        (&longer[..], "one byte long"),
    ] {
        let r = send_raw(
            &mut rpc,
            &[ed25519_ix(&vrf_sk, m), attest.clone()],
            &[&owner],
        );
        assert_eq!(
            failure(r),
            vrf(VrfError::PossessionMessageMismatch),
            "{what}"
        );
    }

    // A bad signature never reaches the program: the precompile fails the transaction.
    let mut bad = ed25519_ix(&vrf_sk, &msg);
    bad.data[48] ^= 1;
    let (f, logs) = send_raw(&mut rpc, &[bad, attest.clone()], &[&owner])
        .err()
        .expect("precompile rejects the signature");
    assert!(
        !logs.iter().any(|l| l.contains(&cc_vrf::ID.to_string())),
        "cc_vrf must never run: {f:?}"
    );

    assert!(
        read_possession(&rpc, &pda).is_none(),
        "nothing was recorded"
    );
    send_raw(&mut rpc, &[ed25519_ix(&vrf_sk, &msg), attest], &[&owner])
        .expect("the honest attestation still works");
}

#[tokio::test(flavor = "multi_thread")]
async fn requires_a_frozen_authority() {
    let mut rpc = rpc_with(&target_deploy()).await;
    let owner = funded(&mut rpc).await;
    let vrf_sk = vrf_key(7);
    let lbl = label("gacha");
    let authority = init_authority(&mut rpc, &owner, lbl, vrf_sk.pubkey().to_bytes())
        .await
        .unwrap();
    let (pda, _) = pop_pda(&authority);
    let p = authority_proof(&rpc, authority).await;
    let o = owner.pubkey();
    let msg = possession_message(&o, &lbl);
    let r = send_raw(
        &mut rpc,
        &[ed25519_ix(&vrf_sk, &msg), attest_ix(&o, lbl, pda, &p)],
        &[&owner],
    );
    assert_eq!(failure(r), vrf(VrfError::AuthorityNotFrozen));
}
