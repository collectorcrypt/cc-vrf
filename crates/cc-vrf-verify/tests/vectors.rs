//! vectors/batch-v1.json is the one corpus Rust and TypeScript both check. Regenerate (roots/paths from this crate,
//! stream blocks from @collectorcrypt/ecvrf's vrfStream) only for a new leaf version:
//! STREAM_VECTORS=<json from vrfStream> cargo test --test vectors -- --ignored generate
use cc_vrf_verify::{
    leaf_v1, path, ring, root, verify_inclusion, verify_leaf_v1, vrf_stream_block, LeafV1, Sha2,
    BETA_LEN, PROOF_LEN,
};
use serde_json::{json, Value};

const CORPUS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/vectors/batch-v1.json");
const COUNTS: &[usize] = &[
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128,
    129, 255, 256, 257, 511, 512, 513, 1023, 1024, 1025, 2047, 2048, 2049, 4095, 4096,
];

fn unhex(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&s[i..i + 2], 16).unwrap())
        .collect()
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{x:02x}")).collect()
}

struct Fixture {
    alpha: Vec<u8>,
    proof: [u8; PROOF_LEN],
    beta: [u8; BETA_LEN],
}

fn fixtures(corpus: &Value) -> Vec<Fixture> {
    corpus["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(|f| Fixture {
            alpha: unhex(f["alpha"].as_str().unwrap()),
            proof: unhex(f["proof"].as_str().unwrap()).try_into().unwrap(),
            beta: unhex(f["beta"].as_str().unwrap()).try_into().unwrap(),
        })
        .collect()
}

/// Leaf i uses fixtures[i % 7] with memo "vector-<i>".
fn leaves(fx: &[Fixture], n: usize) -> Vec<[u8; 32]> {
    (0..n)
        .map(|i| {
            let f = &fx[i % fx.len()];
            let memo = format!("vector-{i}");
            leaf_v1::<Sha2>(&LeafV1 {
                memo: memo.as_bytes(),
                alpha: &f.alpha,
                proof: &f.proof,
                beta: &f.beta,
            })
        })
        .collect()
}

fn probe_indexes(n: usize) -> Vec<usize> {
    let mut v = vec![0, 1, n / 2, n.saturating_sub(2), n - 1];
    v.retain(|&i| i < n);
    v.sort();
    v.dedup();
    v
}

fn corpus() -> Value {
    serde_json::from_str(&std::fs::read_to_string(CORPUS).expect("vectors/batch-v1.json")).unwrap()
}

#[test]
#[ignore]
fn generate() {
    let ecvrf: Value = serde_json::from_str(
        &std::fs::read_to_string(concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../packages/ecvrf/test/fixtures/rfc9381-vectors.json"
        ))
        .unwrap(),
    )
    .unwrap();
    let stream: Value = serde_json::from_str(
        &std::fs::read_to_string(std::env::var("STREAM_VECTORS").expect("STREAM_VECTORS")).unwrap(),
    )
    .unwrap();
    let fx_json: Vec<Value> = ecvrf
        .as_array()
        .unwrap()
        .iter()
        .map(|f| json!({ "label": f["label"], "alpha": f["alpha"], "proof": f["proof"], "beta": f["beta"] }))
        .collect();
    let mut out = json!({
        "spec": "leaf = SHA256(0x00 || \"ccvrf-batch-v1\" || SHA256(memo) || SHA256(alpha) || SHA256(proof80) || beta64); node = SHA256(0x01 || L || R); root = RFC 9162 MTH; paths leaf level first (RFC 9162 2.1.3)",
        "leaf_version": 1,
        "leaf_rule": "leaf i uses fixtures[i % 7] with memo = UTF-8 \"vector-<i>\"",
        "fixtures": fx_json,
    });
    let fx = fixtures(&out);
    let all = leaves(&fx, 4096);
    out["leaves_first_8"] = json!(all[..8].iter().map(|l| hex(l)).collect::<Vec<_>>());
    out["cases"] = json!(COUNTS
        .iter()
        .map(|&n| {
            let ls = &all[..n];
            json!({
                "count": n,
                "root": hex(&root::<Sha2>(ls)),
                "paths": probe_indexes(n).iter().map(|&i| json!({ "index": i, "path": path::<Sha2>(ls, i).iter().map(|p| hex(p)).collect::<Vec<_>>() })).collect::<Vec<_>>(),
            })
        })
        .collect::<Vec<_>>());
    out["stream"] = stream;
    std::fs::create_dir_all(concat!(env!("CARGO_MANIFEST_DIR"), "/vectors")).unwrap();
    std::fs::write(CORPUS, serde_json::to_string_pretty(&out).unwrap() + "\n").unwrap();
}

#[test]
fn corpus_roots_and_paths() {
    let c = corpus();
    let fx = fixtures(&c);
    let all = leaves(&fx, 4096);
    for (i, l) in c["leaves_first_8"].as_array().unwrap().iter().enumerate() {
        assert_eq!(hex(&all[i]), l.as_str().unwrap(), "leaf {i}");
    }
    for case in c["cases"].as_array().unwrap() {
        let n = case["count"].as_u64().unwrap() as usize;
        let r: [u8; 32] = unhex(case["root"].as_str().unwrap()).try_into().unwrap();
        assert_eq!(root::<Sha2>(&all[..n]), r, "root of {n}");
        for p in case["paths"].as_array().unwrap() {
            let i = p["index"].as_u64().unwrap() as usize;
            let want: Vec<[u8; 32]> = p["path"]
                .as_array()
                .unwrap()
                .iter()
                .map(|h| unhex(h.as_str().unwrap()).try_into().unwrap())
                .collect();
            assert_eq!(want, path::<Sha2>(&all[..n], i), "path {i} of {n}");
            assert!(
                verify_inclusion::<Sha2>(&r, n as u64, i as u64, &all[i], &want),
                "verify {i} of {n}"
            );
            let f = &fx[i % fx.len()];
            let memo = format!("vector-{i}");
            let fields = LeafV1 {
                memo: memo.as_bytes(),
                alpha: &f.alpha,
                proof: &f.proof,
                beta: &f.beta,
            };
            assert!(verify_leaf_v1::<Sha2>(
                &r, n as u64, i as u64, &fields, &want
            ));
        }
    }
}

#[test]
fn every_index_verifies_up_to_70() {
    let fx = fixtures(&corpus());
    let all = leaves(&fx, 70);
    for n in 1..=70 {
        let r = root::<Sha2>(&all[..n]);
        for i in 0..n {
            assert!(
                verify_inclusion::<Sha2>(
                    &r,
                    n as u64,
                    i as u64,
                    &all[i],
                    &path::<Sha2>(&all[..n], i)
                ),
                "{i}/{n}"
            );
        }
    }
}

#[test]
fn negatives() {
    let fx = fixtures(&corpus());
    let all = leaves(&fx, 13);
    let (n, i) = (13usize, 5usize);
    let r = root::<Sha2>(&all);
    let p = path::<Sha2>(&all, i);
    let ok = |root: &[u8; 32], count: u64, index: u64, leaf: &[u8; 32], path: &[[u8; 32]]| {
        verify_inclusion::<Sha2>(root, count, index, leaf, path)
    };
    assert!(ok(&r, n as u64, i as u64, &all[i], &p));
    assert!(!ok(&r, n as u64, n as u64, &all[i], &p), "index == count");
    assert!(!ok(&r, n as u64, i as u64 + 1, &all[i], &p), "wrong index");
    // A count that changes the path's shape fails (too short, too long, or other left/right turns)...
    for wrong in [0u64, 5, 6, 8, 17, 32] {
        assert!(!ok(&r, wrong, i as u64, &all[i], &p), "wrong count {wrong}");
    }
    // ...but RFC 9162 sizes only shape the path: for index 5, counts 9..=16 take the same turns, so the proof
    // verifies under all of them. Soundness rests on the root; verifiers must use the committed count, never a caller's.
    for same_shape in 9u64..=16 {
        assert!(
            ok(&r, same_shape, i as u64, &all[i], &p),
            "same-shape count {same_shape}"
        );
    }
    assert!(
        !ok(&r, n as u64, i as u64, &all[i], &p[..p.len() - 1]),
        "short path"
    );
    let mut long = p.clone();
    long.push(all[0]);
    assert!(!ok(&r, n as u64, i as u64, &all[i], &long), "long path");
    let mut swapped = p.clone();
    swapped.swap(0, 1);
    assert!(
        !ok(&r, n as u64, i as u64, &all[i], &swapped),
        "swapped siblings"
    );
    let mut flipped = p.clone();
    flipped[1][0] ^= 1;
    assert!(
        !ok(&r, n as u64, i as u64, &all[i], &flipped),
        "tampered sibling"
    );
    // An inner node presented as a leaf (second-preimage style) fails: leaves and nodes hash with different prefixes.
    let inner = cc_vrf_verify::node::<Sha2>(&all[4], &all[5]);
    assert!(!ok(&r, n as u64, 2, &inner, &p[1..]), "inner node as leaf");
    // Fields: beta that is not the committed one, proof swapped, memo changed.
    let f = &fx[i % fx.len()];
    let memo = format!("vector-{i}");
    let good = LeafV1 {
        memo: memo.as_bytes(),
        alpha: &f.alpha,
        proof: &f.proof,
        beta: &f.beta,
    };
    assert!(verify_leaf_v1::<Sha2>(&r, n as u64, i as u64, &good, &p));
    let mut beta = f.beta;
    beta[63] ^= 1;
    assert!(
        !verify_leaf_v1::<Sha2>(
            &r,
            n as u64,
            i as u64,
            &LeafV1 {
                beta: &beta,
                ..good
            },
            &p
        ),
        "forged beta"
    );
    let other = &fx[(i + 1) % fx.len()];
    assert!(
        !verify_leaf_v1::<Sha2>(
            &r,
            n as u64,
            i as u64,
            &LeafV1 {
                proof: &other.proof,
                ..good
            },
            &p
        ),
        "other proof"
    );
    assert!(
        !verify_leaf_v1::<Sha2>(
            &r,
            n as u64,
            i as u64,
            &LeafV1 {
                memo: b"vector-6",
                ..good
            },
            &p
        ),
        "other memo"
    );
    assert!(
        !verify_leaf_v1::<Sha2>(&r, 1 << 21, i as u64, &good, &p),
        "count above the program's cap"
    );
}

#[test]
fn stream_blocks_match_vrfstream() {
    let c = corpus();
    let fx = fixtures(&c);
    for v in c["stream"].as_array().unwrap() {
        let beta = &fx[v["fixture"].as_u64().unwrap() as usize].beta;
        let segs: Vec<String> = v["path"]
            .as_array()
            .unwrap()
            .iter()
            .map(|s| s.as_str().unwrap().to_string())
            .collect();
        let path: Vec<&[u8]> = segs.iter().map(|s| s.as_bytes()).collect();
        let bytes = unhex(v["bytes"].as_str().unwrap());
        for (b, chunk) in bytes.chunks(64).enumerate() {
            assert_eq!(
                &vrf_stream_block::<Sha2>(beta, &path, b as u64)[..],
                chunk,
                "{segs:?} block {b}"
            );
        }
    }
}

#[test]
fn ring_reader() {
    let mut d = vec![0u8; ring::RING_ACCOUNT_LEN];
    d[..8].copy_from_slice(&ring::RING_DISCRIMINATOR);
    d[8] = 1; // version
    d[10..12].copy_from_slice(&128u16.to_le_bytes());
    d[16..24].copy_from_slice(&131u64.to_le_bytes()); // next_seq: seqs 3..=130 live
    for seq in 1..=130u64 {
        let o = 8 + 176 + (seq % 128) as usize * 56;
        d[o..o + 8].copy_from_slice(&seq.to_le_bytes());
        d[o + 16] = seq as u8;
        d[o + 48..o + 52].copy_from_slice(&(seq as u32).to_le_bytes());
        d[o + 52] = 1;
    }
    let h = ring::header(&d).unwrap();
    assert_eq!((h.version, h.capacity, h.next_seq), (1, 128, 131));
    assert!(ring::entry(&d, 0).is_none());
    assert!(
        ring::entry(&d, 1).is_none() && ring::entry(&d, 2).is_none(),
        "evicted by 129 and 130"
    );
    assert_eq!(ring::entry(&d, 3).unwrap().root[0], 3);
    assert_eq!(ring::entry(&d, 130).unwrap().count, 130);
    assert!(ring::entry(&d, 131).is_none(), "not committed yet");
    let mut bad = d.clone();
    bad[0] ^= 1;
    assert!(ring::header(&bad).is_none(), "discriminator");
    let mut v2 = d.clone();
    v2[8] = 2;
    assert!(ring::header(&v2).is_none(), "version");
    assert!(ring::header(&d[..d.len() - 1]).is_none(), "length");
}
