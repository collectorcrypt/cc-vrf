//! The v2 IDL must contain RC1's IDL unchanged (docs aside), minus revoke_authority. Regenerate first:
//! anchor idl build -p cc_vrf -o target/idl/cc_vrf.json
use serde_json::Value;

fn strip_docs(v: &Value) -> Value {
    match v {
        Value::Object(m) => Value::Object(
            m.iter()
                .filter(|(k, _)| *k != "docs")
                .map(|(k, v)| (k.clone(), strip_docs(v)))
                .collect(),
        ),
        Value::Array(a) => Value::Array(a.iter().map(strip_docs).collect()),
        other => other.clone(),
    }
}

fn load(path: &std::path::Path) -> Value {
    serde_json::from_str(
        &std::fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display())),
    )
    .unwrap()
}

fn by_name<'a>(idl: &'a Value, section: &str) -> Vec<(&'a str, &'a Value)> {
    idl[section]
        .as_array()
        .map(|a| a.iter().map(|x| (x["name"].as_str().unwrap(), x)).collect())
        .unwrap_or_default()
}

#[test]
fn v2_idl_is_a_superset_of_rc1() {
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
    let new_path = manifest.join("../../target/idl/cc_vrf.json");
    let built = std::fs::metadata(&new_path)
        .and_then(|m| m.modified())
        .expect("generate the IDL first");
    let src = std::fs::read_dir(manifest.join("src/instructions"))
        .unwrap()
        .chain(std::fs::read_dir(manifest.join("src")).unwrap())
        .filter_map(|e| e.ok()?.metadata().ok()?.modified().ok())
        .max()
        .unwrap();
    assert!(
        built >= src,
        "target/idl/cc_vrf.json is older than the program source: regenerate it"
    );

    let rc1 = load(&manifest.join("tests/fixtures/rc1/cc_vrf.idl.json"));
    let v2 = load(&new_path);
    assert_eq!(rc1["address"], v2["address"]);

    for section in ["instructions", "events", "types", "accounts"] {
        let new: std::collections::HashMap<_, _> = by_name(&v2, section).into_iter().collect();
        for (name, old) in by_name(&rc1, section) {
            if section == "instructions" && name == "revoke_authority" {
                assert!(!new.contains_key(name), "revoke_authority must be gone");
                continue;
            }
            let now = new
                .get(name)
                .unwrap_or_else(|| panic!("{section}.{name} missing from the v2 IDL"));
            assert_eq!(strip_docs(old), strip_docs(now), "{section}.{name} changed");
        }
    }
    let new_errors = v2["errors"].as_array().unwrap();
    for (i, e) in rc1["errors"].as_array().unwrap().iter().enumerate() {
        assert_eq!(e, &new_errors[i], "error {i} changed");
    }

    let names: Vec<_> = by_name(&v2, "instructions")
        .into_iter()
        .map(|(n, _)| n)
        .collect();
    for added in [
        "commit_batch_event",
        "init_root_ring",
        "commit_batch_ring",
        "attest_possession",
    ] {
        assert!(names.contains(&added), "{added} missing");
    }
    let batch = by_name(&v2, "instructions")
        .into_iter()
        .find(|(n, _)| *n == "commit_batch_event")
        .unwrap()
        .1;
    let args: Vec<_> = batch["args"]
        .as_array()
        .unwrap()
        .iter()
        .map(|a| a["name"].as_str().unwrap())
        .collect();
    assert_eq!(
        &args[..4],
        ["label", "root", "count", "leaf_version"],
        "the fixed prefix consumers read"
    );
}
