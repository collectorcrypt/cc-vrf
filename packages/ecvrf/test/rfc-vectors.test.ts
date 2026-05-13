import { beforeAll, describe, expect, it } from "vitest";
import {
  bytesToHex,
  hexToBytes,
  generateKeyPair,
  proveVRF,
  publicKeyFromSeed,
  verifyVRF,
  vrfProofToHash,
  PROOF_LEN,
} from "../src";

/**
 * The (sk, pk) pairs below come directly from RFC 8032 §7.1 — these are the
 * canonical Ed25519 test keys reused across every cfrg-vrf draft. We assert
 * our deriveScalar / publicKeyFromSeed reproduces these. Proof byte values
 * have changed across draft iterations (suite_string, challenge ordering,
 * endianness) so we do NOT compare prove output bytes to externally-published
 * vectors here — those checks belong behind an interop suite gated on a known
 * reference implementation. See README §Interop.
 */
const ED25519_KEY_VECTORS = [
  {
    label: "RFC 8032 §7.1 vector 1",
    sk: "9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60",
    pk: "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a",
  },
  {
    label: "RFC 8032 §7.1 vector 2",
    sk: "4ccd089b28ff96da9db6c346ec114e0f5b8a319f35aba624da8cf6ed4fb8a6fb",
    pk: "3d4017c3e843895a92b70aa74d1b7ebc9c982ccf2ec4968cc0cd55f12af4660c",
  },
  {
    label: "RFC 8032 §7.1 vector 3",
    sk: "c5aa8df43f9f837bedb7442f31dcb7b166d38535076f094b85ce3a2e0b4458f7",
    pk: "fc51cd8e6218a1a38da47ed00230f0580816ed13ba3303ac5deb911548908025",
  },
];

describe("Ed25519 key derivation against RFC 8032 §7.1 keys", () => {
  for (const v of ED25519_KEY_VECTORS) {
    it(`${v.label}: derives correct public key`, () => {
      const pk = publicKeyFromSeed(hexToBytes(v.sk));
      expect(bytesToHex(pk)).toBe(v.pk);
    });
  }
});

describe("ECVRF proof structure", () => {
  it("produces exactly 80-byte proofs", () => {
    const { sk } = generateKeyPair();
    const { proof } = proveVRF(sk, new TextEncoder().encode("structure-test"));
    expect(proof.length).toBe(PROOF_LEN);
    expect(PROOF_LEN).toBe(80);
  });

  it("produces 64-byte beta hashes", () => {
    const { sk } = generateKeyPair();
    const { proof } = proveVRF(sk, new Uint8Array([1, 2, 3]));
    expect(vrfProofToHash(proof).length).toBe(64);
  });
});

describe("ECVRF round-trip and verifier correctness", () => {
  it("verifies its own proofs across 200 random keypairs and alphas", () => {
    for (let i = 0; i < 200; i++) {
      const { sk, pk } = generateKeyPair();
      const alpha = new Uint8Array(1 + (i % 64));
      crypto.getRandomValues(alpha);
      const { proof } = proveVRF(sk, alpha);
      const ok = verifyVRF(pk, alpha, proof);
      expect(ok, `iteration ${i}`).toBe(true);
    }
  });

  it("produces identical proofs for identical inputs (determinism)", () => {
    const sk = hexToBytes(ED25519_KEY_VECTORS[0].sk);
    const alpha = new TextEncoder().encode("determinism-check");
    const a = proveVRF(sk, alpha);
    const b = proveVRF(sk, alpha);
    expect(bytesToHex(a.proof)).toBe(bytesToHex(b.proof));
    expect(bytesToHex(a.gamma)).toBe(bytesToHex(b.gamma));
  });

  it("produces identical beta for identical proof (proof_to_hash determinism)", () => {
    const { sk } = generateKeyPair();
    const alpha = new TextEncoder().encode("beta-determinism");
    const { proof } = proveVRF(sk, alpha);
    const b1 = vrfProofToHash(proof);
    const b2 = vrfProofToHash(proof);
    expect(bytesToHex(b1)).toBe(bytesToHex(b2));
  });

  it("different alphas under the same key produce different proofs", () => {
    const sk = hexToBytes(ED25519_KEY_VECTORS[0].sk);
    const a = proveVRF(sk, new Uint8Array([1])).proof;
    const b = proveVRF(sk, new Uint8Array([2])).proof;
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("different keys on the same alpha produce different proofs", () => {
    const alpha = new TextEncoder().encode("same-alpha");
    const k1 = generateKeyPair();
    const k2 = generateKeyPair();
    const p1 = proveVRF(k1.sk, alpha).proof;
    const p2 = proveVRF(k2.sk, alpha).proof;
    expect(bytesToHex(p1)).not.toBe(bytesToHex(p2));
  });
});

describe("ECVRF negative cases", () => {
  let pk: Uint8Array;
  let sk: Uint8Array;
  let alpha: Uint8Array;
  let proof: Uint8Array;

  beforeAll(() => {
    const kp = generateKeyPair();
    sk = kp.sk;
    pk = kp.pk;
    alpha = new TextEncoder().encode("negative-cases");
    proof = proveVRF(sk, alpha).proof;
  });

  it("accepts the well-formed proof (baseline)", () => {
    expect(verifyVRF(pk, alpha, proof)).toBe(true);
  });

  it("rejects a proof with tampered Gamma byte", () => {
    const t = new Uint8Array(proof);
    t[0] ^= 0x01;
    expect(verifyVRF(pk, alpha, t)).toBe(false);
  });

  it("rejects a proof with tampered c byte", () => {
    const t = new Uint8Array(proof);
    t[32] ^= 0x01;
    expect(verifyVRF(pk, alpha, t)).toBe(false);
  });

  it("rejects a proof with tampered s byte", () => {
    const t = new Uint8Array(proof);
    t[48] ^= 0x01;
    expect(verifyVRF(pk, alpha, t)).toBe(false);
  });

  it("rejects when verified against the wrong pk", () => {
    const { pk: otherPk } = generateKeyPair();
    expect(verifyVRF(otherPk, alpha, proof)).toBe(false);
  });

  it("rejects when verified against the wrong alpha", () => {
    expect(verifyVRF(pk, new Uint8Array([0xff]), proof)).toBe(false);
  });

  it("rejects a proof with wrong length", () => {
    expect(verifyVRF(pk, alpha, proof.slice(0, 79))).toBe(false);
    expect(
      verifyVRF(pk, alpha, new Uint8Array([...Array.from(proof), 0x00])),
    ).toBe(false);
  });

  it("rejects a proof with s >= curve order", () => {
    // Construct a proof with s = q (one past the order) — should be rejected.
    const t = new Uint8Array(proof);
    // Curve order in little-endian bytes for s slot (48..80).
    // 2^252 + 27742317777372353535851937790883648493
    const qLE = hexToBytes(
      "edd3f55c1a631258d69cf7a2def9de1400000000000000000000000000000010",
    );
    t.set(qLE, 48);
    expect(verifyVRF(pk, alpha, t)).toBe(false);
  });
});
