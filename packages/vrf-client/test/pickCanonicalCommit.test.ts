import { describe, expect, it } from "vitest";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  alphaHash,
  generateKeyPair,
  memoHash,
  pickCanonicalCommit,
  proofHash,
  proveVRF,
} from "../src";

/**
 * pickCanonicalCommit is the verifier-side defense against the one soundness
 * gap in event mode: the chain doesn't enforce one-commit-per-memo, so a
 * verifier might see multiple `VrfProofCommitted` events for the same memo.
 *
 * Because ECVRF is deterministic, at most one event can have a `proof_hash`
 * that matches a verifying proof. pickCanonicalCommit finds that row.
 */
describe("pickCanonicalCommit", () => {
  function makeFixture() {
    const { sk, pk } = generateKeyPair();
    const memo = "evt-memo-" + Math.random().toString(36).slice(2);
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(sk, alpha);
    const mh = memoHash(memo);
    const ah = alphaHash(alpha);
    const realCommit = {
      memoHash: mh,
      proofHash: proofHash(proof),
      alphaHash: ah,
      committedSlot: 1000n,
    };
    const garbageCommit = {
      memoHash: mh,
      // 32 bytes of zero — sha256 of nothing matches this, but not our real proof.
      proofHash: new Uint8Array(32),
      alphaHash: ah,
      committedSlot: 1001n,
    };
    return { pk, memo, alpha, proof, realCommit, garbageCommit };
  }

  it("selects the canonical row when only one event exists", () => {
    const f = makeFixture();
    const r = pickCanonicalCommit([f.realCommit], f.proof);
    expect(r.canonical).toBe(f.realCommit);
    expect(r.duplicateMemoEvents).toBe(false);
    expect(r.multipleVerifying).toBe(false);
  });

  it("selects the real commit even when a garbage duplicate is present", () => {
    const f = makeFixture();
    // Two events for the same memo. Real first, garbage second.
    const r = pickCanonicalCommit([f.realCommit, f.garbageCommit], f.proof);
    expect(r.canonical).toBe(f.realCommit);
    expect(r.duplicateMemoEvents).toBe(true);
    expect(r.multipleVerifying).toBe(false);
  });

  it("selects the real commit when a garbage event was posted FIRST", () => {
    const f = makeFixture();
    // The attack: emit garbage event before the real one. A naive verifier
    // that picks "the first event" would be fooled — pickCanonicalCommit
    // still finds the real one via the proof_hash check.
    const r = pickCanonicalCommit([f.garbageCommit, f.realCommit], f.proof);
    expect(r.canonical).toBe(f.realCommit);
    expect(r.duplicateMemoEvents).toBe(true);
  });

  it("returns null canonical when no candidates match the proof", () => {
    const f = makeFixture();
    const r = pickCanonicalCommit([f.garbageCommit], f.proof);
    expect(r.canonical).toBeNull();
    expect(r.duplicateMemoEvents).toBe(false);
  });

  it("returns empty result for an empty candidate list", () => {
    const f = makeFixture();
    const r = pickCanonicalCommit([], f.proof);
    expect(r.canonical).toBeNull();
    expect(r.candidates).toEqual([]);
    expect(r.duplicateMemoEvents).toBe(false);
    expect(r.multipleVerifying).toBe(false);
  });
});
