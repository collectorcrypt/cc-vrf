import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  alphaHash,
  bytesToHex,
  generateKeyPair,
  memoHash,
  proofHash,
  proveVRF,
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
});
