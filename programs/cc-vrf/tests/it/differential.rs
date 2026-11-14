//! RC1 vs the fresh v2 build on the five kept instructions: the same script must give the same outcomes, error codes,
//! compressed-account hashes and data, and event bytes.

use std::path::PathBuf;

use crate::common::{v2::*, *};
use light_program_test::Indexer;

#[derive(Debug, PartialEq)]
enum Step {
    Account { hash: [u8; 32], data: Vec<u8> },
    Event(Vec<Vec<u8>>),
    Code(Option<u32>),
}

async fn account(rpc: &light_program_test::LightProgramTest, address: [u8; 32]) -> Step {
    let a = rpc
        .get_compressed_account(address, None)
        .await
        .unwrap()
        .value
        .expect("account");
    Step::Account {
        hash: a.hash,
        data: a.data.map(|d| d.data).unwrap_or_default(),
    }
}

async fn script(so_dir: PathBuf) -> Vec<(&'static str, Step)> {
    let mut rpc = rpc_with(&so_dir).await;
    let owner = funded_seeded(&mut rpc, 1).await;
    let stranger = funded_seeded(&mut rpc, 2).await;
    let lbl = label("gacha");
    let mut out = Vec::new();

    let a = init_authority(&mut rpc, &owner, lbl, TEST_PK)
        .await
        .expect("init");
    out.push(("init_authority", account(&rpc, a).await));
    let r = commit_registry(&mut rpc, &owner, a, h("memo", 1), None).await;
    out.push((
        "commit before freeze",
        Step::Code(r.err().and_then(|e| rpc_code(&e))),
    ));
    freeze_authority(&mut rpc, &owner, a).await.expect("freeze");
    out.push(("freeze_authority", account(&rpc, a).await));
    let r = freeze_authority(&mut rpc, &owner, a).await;
    out.push((
        "freeze twice",
        Step::Code(r.err().and_then(|e| rpc_code(&e))),
    ));

    let c1 = commit_registry(&mut rpc, &owner, a, h("memo", 1), None)
        .await
        .expect("commit_proof");
    out.push(("commit_proof", account(&rpc, c1).await));
    let c2 = commit_registry(&mut rpc, &owner, a, h("memo", 2), Some([7u8; 64]))
        .await
        .expect("commit_proof_with_beta");
    out.push(("commit_proof_with_beta", account(&rpc, c2).await));
    let ix = commit_event_ix(&rpc, &owner, a, lbl, h("memo", 3)).await;
    let sent = send_raw(&mut rpc, &[ix], &[&owner]).expect("commit_proof_event");
    out.push(("commit_proof_event", Step::Event(program_data(&sent.logs))));

    let r = commit_registry(&mut rpc, &owner, a, h("memo", 1), None).await;
    out.push((
        "duplicate memo",
        Step::Code(r.err().and_then(|e| rpc_code(&e))),
    ));
    let r = commit_registry(&mut rpc, &stranger, a, h("memo", 4), Some([7u8; 64])).await;
    out.push((
        "stranger commit",
        Step::Code(r.err().and_then(|e| rpc_code(&e))),
    ));
    let ix = commit_event_ix(&rpc, &owner, a, label("other"), h("memo", 5)).await;
    out.push((
        "event, wrong label",
        Step::Code(
            send_raw(&mut rpc, &[ix], &[&owner])
                .err()
                .and_then(|(f, _)| match f {
                    Failure::Custom(c) => Some(c),
                    Failure::Other(_) => None,
                }),
        ),
    ));
    out
}

#[tokio::test(flavor = "multi_thread")]
async fn kept_instructions_match_rc1_byte_for_byte() {
    let rc1 = script(rc1_dir()).await;
    let v2 = script(target_deploy()).await;
    assert_eq!(rc1.len(), v2.len());
    for ((name, a), (_, b)) in rc1.iter().zip(v2.iter()) {
        assert_eq!(a, b, "{name}");
        println!(
            "{name:<24} identical: {}",
            match a {
                Step::Account { .. } => "account hash + data".to_string(),
                Step::Event(e) => format!("{} event(s)", e.len()),
                Step::Code(c) => format!("{c:?}"),
            }
        );
    }
    // The script exercised real failures, not just successes.
    assert!(
        rc1.iter()
            .filter(|(_, s)| matches!(s, Step::Code(Some(_))))
            .count()
            >= 5
    );
}
