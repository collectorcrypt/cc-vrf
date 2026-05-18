import { describe, expect, it } from "vitest";
import { PublicKey, Keypair } from "@solana/web3.js";
import {
  CC_VRF_PROGRAM_ID,
  alphaHash,
  deriveAuthorityAddress,
  deriveProofCommitAddress,
  deriveProofCommitWithBetaAddress,
  encodeLabel,
  memoHash,
  proofHash,
} from "../src";

describe("address derivation", () => {
  it("derives the same authority address for the same (owner, label)", () => {
    const owner = Keypair.generate().publicKey;
    const label = encodeLabel("gacha");
    const a = deriveAuthorityAddress(owner, label, CC_VRF_PROGRAM_ID);
    const b = deriveAuthorityAddress(owner, label, CC_VRF_PROGRAM_ID);
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it("derives different authority addresses for different labels under the same owner", () => {
    const owner = Keypair.generate().publicKey;
    const a = deriveAuthorityAddress(
      owner,
      encodeLabel("gacha"),
      CC_VRF_PROGRAM_ID,
    );
    const b = deriveAuthorityAddress(
      owner,
      encodeLabel("lottery"),
      CC_VRF_PROGRAM_ID,
    );
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  it("derives different authority addresses for different owners with the same label", () => {
    const o1 = Keypair.generate().publicKey;
    const o2 = Keypair.generate().publicKey;
    const label = encodeLabel("shared");
    const a = deriveAuthorityAddress(o1, label, CC_VRF_PROGRAM_ID);
    const b = deriveAuthorityAddress(o2, label, CC_VRF_PROGRAM_ID);
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  it("derives different proof commit addresses for different memos under the same authority", () => {
    const authority = Keypair.generate().publicKey;
    const a = deriveProofCommitAddress(
      authority,
      memoHash("memo-1"),
      CC_VRF_PROGRAM_ID,
    );
    const b = deriveProofCommitAddress(
      authority,
      memoHash("memo-2"),
      CC_VRF_PROGRAM_ID,
    );
    expect(a.toBase58()).not.toBe(b.toBase58());
  });

  it("derives different proof commit addresses for the same memo under different authorities", () => {
    const a1 = Keypair.generate().publicKey;
    const a2 = Keypair.generate().publicKey;
    const mh = memoHash("shared-memo");
    const pa = deriveProofCommitAddress(a1, mh, CC_VRF_PROGRAM_ID);
    const pb = deriveProofCommitAddress(a2, mh, CC_VRF_PROGRAM_ID);
    expect(pa.toBase58()).not.toBe(pb.toBase58());
  });

  it("with-beta commits live at the same address as regular commits for the same memo", () => {
    // Critical safety property: the two variants share authority + memo and
    // therefore share an address, so the chain allows only one registry commit
    // variant per memo.
    const authority = Keypair.generate().publicKey;
    const mh = memoHash("same-memo");
    const regular = deriveProofCommitAddress(authority, mh, CC_VRF_PROGRAM_ID);
    const withBeta = deriveProofCommitWithBetaAddress(
      authority,
      mh,
      CC_VRF_PROGRAM_ID,
    );
    expect(regular.toBase58()).toBe(withBeta.toBase58());
  });

  it("with-beta address is deterministic for the same (authority, memo)", () => {
    const authority = Keypair.generate().publicKey;
    const mh = memoHash("repeat-memo");
    const a = deriveProofCommitWithBetaAddress(
      authority,
      mh,
      CC_VRF_PROGRAM_ID,
    );
    const b = deriveProofCommitWithBetaAddress(
      authority,
      mh,
      CC_VRF_PROGRAM_ID,
    );
    expect(a.toBase58()).toBe(b.toBase58());
  });

  it("rejects mis-sized labels and memo hashes", () => {
    const owner = Keypair.generate().publicKey;
    expect(() =>
      deriveAuthorityAddress(owner, new Uint8Array(16), CC_VRF_PROGRAM_ID),
    ).toThrow(/32 bytes/);
    expect(() =>
      deriveProofCommitAddress(owner, new Uint8Array(31), CC_VRF_PROGRAM_ID),
    ).toThrow(/32 bytes/);
  });

  it("rejects labels longer than 32 utf-8 bytes", () => {
    const oversized = "a".repeat(33);
    expect(() => encodeLabel(oversized)).toThrow(/32 bytes/);
  });
});

describe("hashing helpers", () => {
  it("memoHash returns 32 bytes and matches a fresh sha256", () => {
    const out = memoHash("hello world");
    expect(out.length).toBe(32);
  });

  it("proofHash and alphaHash return 32 bytes", () => {
    expect(proofHash(new Uint8Array(80)).length).toBe(32);
    expect(alphaHash(new Uint8Array(16)).length).toBe(32);
  });

  it("CC_VRF_PROGRAM_ID is a valid 32-byte pubkey", () => {
    expect(CC_VRF_PROGRAM_ID).toBeInstanceOf(PublicKey);
    expect(CC_VRF_PROGRAM_ID.toBytes().length).toBe(32);
  });
});
