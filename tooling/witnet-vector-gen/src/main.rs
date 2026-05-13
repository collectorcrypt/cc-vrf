//! Generates RFC 9381 ECVRF-EDWARDS25519-SHA512-TAI test vectors using the
//! `vrf-rfc9381` crate as an authoritative reference implementation.
//!
//! Output is written to stdout as JSON. Used by the @collectorcrypt/ecvrf
//! Mocha tests to validate byte-exact spec compliance.

use serde::Serialize;
use vrf_rfc9381::Proof as _;
use vrf_rfc9381::Prover as _;
use vrf_rfc9381::VRF as _;
use vrf_rfc9381::Verifier as _;
use vrf_rfc9381::ec::edwards25519::tai::{
    EdVrfEdwards25519Tai, EdVrfEdwards25519TaiSecretKey,
};

#[derive(Serialize)]
struct Vector {
    label: String,
    sk: String,
    pk: String,
    alpha: String,
    proof: String,
    beta: String,
}

fn run_one(label: &str, sk_hex: &str, alpha_hex: &str) -> Vector {
    let sk_bytes = hex::decode(sk_hex).expect("sk hex");
    let alpha = hex::decode(alpha_hex).expect("alpha hex");

    let prover = EdVrfEdwards25519TaiSecretKey::from_slice(&sk_bytes).expect("from_slice");
    let verifier = prover.verifier();

    let suite = EdVrfEdwards25519Tai;
    let pi_bytes = suite.prove(&prover, &alpha).expect("prove");
    let beta = suite.verify(&verifier, &alpha, &pi_bytes).expect("verify");

    // Extract pk bytes by encoding the verifier. The Verifier trait doesn't
    // directly expose bytes; we serialize via Debug-format hack? Better: read
    // the public key from inside the prover via the verifier serialization.
    // Easiest path: use a Proof::decode_pi to confirm pi length and trust the
    // crate's pi output. PK bytes: the EdVrfEdwards25519Tai public key is the
    // Ed25519 standard 32-byte encoding. We derive it ourselves from sk using
    // the same method curve25519-dalek uses, since the crate doesn't expose
    // pk_bytes publicly. Use ed25519-style: pk = scalar(SHA512(sk)[0..32]
    // clamped) * BasePoint.
    let pk_bytes = derive_ed25519_pk(&sk_bytes);

    Vector {
        label: label.to_string(),
        sk: sk_hex.to_string(),
        pk: hex::encode(pk_bytes),
        alpha: alpha_hex.to_string(),
        proof: hex::encode(&pi_bytes),
        beta: hex::encode(beta),
    }
}

fn derive_ed25519_pk(sk_bytes: &[u8]) -> [u8; 32] {
    use curve25519_dalek::constants::ED25519_BASEPOINT_TABLE;
    use curve25519_dalek::scalar::Scalar;
    use sha2::{Digest, Sha512};

    let h = Sha512::digest(sk_bytes);
    let mut x_bytes = [0u8; 32];
    x_bytes.copy_from_slice(&h[..32]);
    x_bytes[0] &= 248;
    x_bytes[31] &= 127;
    x_bytes[31] |= 64;
    let x = Scalar::from_bytes_mod_order(x_bytes);
    let y = &x * ED25519_BASEPOINT_TABLE;
    y.compress().to_bytes()
}

fn main() {
    let cases = [
        (
            "rfc-8032-v1-empty",
            "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
            "",
        ),
        (
            "rfc-8032-v2-one-byte",
            "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
            "72",
        ),
        (
            "rfc-8032-v3-two-bytes",
            "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
            "af82",
        ),
        (
            "deterministic-sk-1",
            "0000000000000000000000000000000000000000000000000000000000000001",
            "",
        ),
        (
            "deterministic-sk-2",
            "1111111111111111111111111111111111111111111111111111111111111111",
            "deadbeef",
        ),
        (
            "deterministic-sk-3",
            "2222222222222222222222222222222222222222222222222222222222222222",
            "0102030405060708090a0b0c0d0e0f10",
        ),
        (
            "long-alpha",
            "5566778899aabbccddeeff00112233445566778899aabbccddeeff0011223344",
            "5468697320697320612074657374206f662061206c6f6e6720616c70686120737472696e67",
        ),
    ];

    let vectors: Vec<Vector> = cases
        .iter()
        .map(|(label, sk, alpha)| run_one(label, sk, alpha))
        .collect();
    println!("{}", serde_json::to_string_pretty(&vectors).unwrap());
}
