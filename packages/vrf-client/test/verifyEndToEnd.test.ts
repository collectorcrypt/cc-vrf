import { describe, expect, it } from "vitest";
import { Keypair } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  alphaHash,
  bytesToHex,
  generateKeyPair,
  memoHash,
  proofHash,
  proveVRF,
  SUITE_EDWARDS25519_SHA512_TAI,
  verifyAuthorityCommitEndToEnd,
  verifyEndToEnd,
  vrfProofToHash,
} from "../src";

describe("verifyEndToEnd", () => {
  function makeFixture() {
    const { sk, pk } = generateKeyPair();
    const memo = "test-memo-" + Math.random().toString(36).slice(2);
    const alpha = sha256(new TextEncoder().encode(memo + "salt"));
    const { proof } = proveVRF(sk, alpha);
    const onChainCommit = {
      memoHash: memoHash(memo),
      proofHash: proofHash(proof),
      alphaHash: alphaHash(alpha),
      committedSlot: 12345n,
    };
    return { pk, memo, alpha, proof, onChainCommit };
  }

  it("returns valid=true for a fully consistent record", () => {
    const f = makeFixture();
    const r = verifyEndToEnd(f);
    expect(r.valid).toBe(true);
    expect(r.ecvrfValid).toBe(true);
    expect(r.suiteSupported).toBe(true);
    expect(r.proofHashMatches).toBe(true);
    expect(r.alphaHashMatches).toBe(true);
    expect(r.memoHashMatches).toBe(true);
    expect(r.reasons).toEqual([]);
    expect(r.beta).not.toBeNull();
    expect(r.beta!.length).toBe(64);
  });

  it("returns valid=false with ecvrf-verify-failed when proof bytes are tampered", () => {
    const f = makeFixture();
    const tampered = new Uint8Array(f.proof);
    tampered[0] ^= 1;
    // Update on-chain hash to match tampered proof — otherwise we'd also fail proofHashMatches.
    const r = verifyEndToEnd({
      ...f,
      proof: tampered,
      onChainCommit: {
        ...f.onChainCommit,
        proofHash: proofHash(tampered),
      },
    });
    expect(r.valid).toBe(false);
    expect(r.ecvrfValid).toBe(false);
    expect(r.reasons).toContain("ecvrf-verify-failed");
  });

  it("returns valid=false with proof-hash-mismatch when on-chain proof hash differs", () => {
    const f = makeFixture();
    const r = verifyEndToEnd({
      ...f,
      onChainCommit: {
        ...f.onChainCommit,
        proofHash: new Uint8Array(32),
      },
    });
    expect(r.valid).toBe(false);
    expect(r.proofHashMatches).toBe(false);
    expect(r.reasons.some((s) => s.startsWith("proof-hash-mismatch"))).toBe(
      true,
    );
  });

  it("returns valid=false with alpha-hash-mismatch", () => {
    const f = makeFixture();
    const r = verifyEndToEnd({
      ...f,
      onChainCommit: {
        ...f.onChainCommit,
        alphaHash: new Uint8Array(32),
      },
    });
    expect(r.valid).toBe(false);
    expect(r.alphaHashMatches).toBe(false);
    expect(r.reasons).toContain("alpha-hash-mismatch");
  });

  it("returns valid=false with memo-hash-mismatch", () => {
    const f = makeFixture();
    const r = verifyEndToEnd({
      ...f,
      onChainCommit: {
        ...f.onChainCommit,
        memoHash: new Uint8Array(32),
      },
    });
    expect(r.valid).toBe(false);
    expect(r.memoHashMatches).toBe(false);
    expect(r.reasons).toContain("memo-hash-mismatch");
  });

  it("verifies the beta matches what vrfProofToHash returns", () => {
    const f = makeFixture();
    const r = verifyEndToEnd(f);
    const expectedBeta = vrfProofToHash(f.proof);
    expect(bytesToHex(r.beta!)).toBe(bytesToHex(expectedBeta));
  });

  it("rejects unsupported suites", () => {
    const f = makeFixture();
    const r = verifyEndToEnd({ ...f, suite: 0x04 });
    expect(r.valid).toBe(false);
    expect(r.suiteSupported).toBe(false);
    expect(r.reasons).toContain("unsupported-suite-4");
  });

  it("checks authority lifecycle, commit authority, and beta in the full verifier", () => {
    const f = makeFixture();
    const owner = Keypair.generate();
    const authorityAddress = Keypair.generate().publicKey;
    const label = new Uint8Array(32);
    label.set(new TextEncoder().encode("full-check"));
    const beta = vrfProofToHash(f.proof);
    const r = verifyAuthorityCommitEndToEnd({
      authority: {
        authorityAddress,
        owner: owner.publicKey,
        pk: f.pk,
        suite: SUITE_EDWARDS25519_SHA512_TAI,
        frozen: true,
        revoked: false,
        label,
      },
      expectedOwner: owner.publicKey,
      expectedLabel: label,
      expectedAuthorityAddress: authorityAddress,
      alpha: f.alpha,
      proof: f.proof,
      memo: f.memo,
      onChainCommit: {
        ...f.onChainCommit,
        authority: authorityAddress,
      },
      onChainBeta: beta,
    });
    expect(r.valid).toBe(true);
    expect(r.authorityFrozen).toBe(true);
    expect(r.authorityNotRevoked).toBe(true);
    expect(r.commitAuthorityMatches).toBe(true);
    expect(r.betaMatches).toBe(true);
  });

  it("rejects unfrozen authorities in the full verifier", () => {
    const f = makeFixture();
    const owner = Keypair.generate();
    const authorityAddress = Keypair.generate().publicKey;
    const r = verifyAuthorityCommitEndToEnd({
      authority: {
        authorityAddress,
        owner: owner.publicKey,
        pk: f.pk,
        suite: SUITE_EDWARDS25519_SHA512_TAI,
        frozen: false,
        revoked: false,
        label: new Uint8Array(32),
      },
      alpha: f.alpha,
      proof: f.proof,
      memo: f.memo,
      onChainCommit: { ...f.onChainCommit, authority: authorityAddress },
    });
    expect(r.valid).toBe(false);
    expect(r.reasons).toContain("authority-not-frozen");
  });
});
