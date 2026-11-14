import { describe, expect, it } from "vitest";
import { Keypair, PublicKey } from "@solana/web3.js";
import * as ed from "@noble/ed25519";
import {
  CC_VRF_PROGRAM_ID,
  decodeRootRing,
  derivePossessionAddress,
  deriveRootRingAddress,
  encodeLabel,
  possessionMessage,
  POSSESSION_DISCRIMINATOR,
  RING_ACCOUNT_LEN,
  RING_DISCRIMINATOR,
  rootRingEntry,
  signPossessionMessage,
} from "../src";

describe("root ring decoder", () => {
  function ring(nextSeq: bigint, commits: number): Uint8Array {
    const d = new Uint8Array(RING_ACCOUNT_LEN);
    const v = new DataView(d.buffer);
    d.set(RING_DISCRIMINATOR, 0);
    d[8] = 1;
    d[9] = 254;
    v.setUint16(10, 128, true);
    v.setBigUint64(16, nextSeq, true);
    d.fill(7, 24, 56);
    for (let seq = 1; seq <= commits; seq++) {
      const o = 8 + 176 + (seq % 128) * 56;
      v.setBigUint64(o, BigInt(seq), true);
      v.setBigUint64(o + 8, BigInt(1000 + seq), true);
      d[o + 16] = seq & 0xff;
      v.setUint32(o + 48, seq, true);
      d[o + 52] = 1;
    }
    return d;
  }

  it("reads the header and only live entries", () => {
    const d = ring(131n, 130);
    const h = decodeRootRing(d)!;
    expect([h.version, h.bump, h.capacity, h.nextSeq]).toEqual([
      1,
      254,
      128,
      131n,
    ]);
    expect(h.authority.toBytes()).toEqual(new Uint8Array(32).fill(7));
    expect(rootRingEntry(d, 0n)).toBeNull();
    expect(rootRingEntry(d, 1n)).toBeNull();
    expect(rootRingEntry(d, 2n)).toBeNull();
    expect(rootRingEntry(d, 3n)).toMatchObject({
      seq: 3n,
      slot: 1003n,
      count: 3,
      leafVersion: 1,
    });
    expect(rootRingEntry(d, 130n)?.count).toBe(130);
    expect(rootRingEntry(d, 131n)).toBeNull();
  });

  it("refuses foreign bytes", () => {
    const d = ring(2n, 1);
    const bad = Uint8Array.from(d);
    bad[0] ^= 1;
    expect(decodeRootRing(bad)).toBeNull();
    const v2 = Uint8Array.from(d);
    v2[8] = 2;
    expect(decodeRootRing(v2)).toBeNull();
    expect(decodeRootRing(d.slice(0, -1))).toBeNull();
  });

  it("uses the program's account discriminators (pinned in the Rust wire tests)", () => {
    expect(Buffer.from(RING_DISCRIMINATOR).toString("hex")).toBe(
      "44f3cbc931dae42e",
    );
    expect(Buffer.from(POSSESSION_DISCRIMINATOR).toString("hex")).toBe(
      "bb6f80e184a2ecff",
    );
  });

  it("derives the program's PDAs", () => {
    const authority = Keypair.generate().publicKey;
    const [ring] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("root_ring"), authority.toBytes()],
      CC_VRF_PROGRAM_ID,
    );
    expect(deriveRootRingAddress(authority).equals(ring)).toBe(true);
    const [pop] = PublicKey.findProgramAddressSync(
      [new TextEncoder().encode("vrf_pop"), authority.toBytes()],
      CC_VRF_PROGRAM_ID,
    );
    expect(derivePossessionAddress(authority).equals(pop)).toBe(true);
  });
});

describe("possession", () => {
  const owner = Keypair.generate().publicKey;
  const sk = ed.utils.randomSecretKey();

  it("builds the 114-byte message in program order", () => {
    const m = possessionMessage(owner, "gacha");
    expect(m.length).toBe(114);
    expect(new TextDecoder().decode(m.slice(0, 18))).toBe("ccvrf-authority-v1");
    expect(m.slice(18, 50)).toEqual(CC_VRF_PROGRAM_ID.toBytes());
    expect(m.slice(50, 82)).toEqual(owner.toBytes());
    expect(m.slice(82)).toEqual(encodeLabel("gacha"));
  });

  it("signs the possession message, verifiable with the VRF pk", async () => {
    const m = possessionMessage(owner, "gacha");
    const sig = await signPossessionMessage(sk, m);
    expect(await ed.verifyAsync(sig, m, await ed.getPublicKeyAsync(sk))).toBe(
      true,
    );
  });

  it("refuses to sign anything else, a 32-byte message above all", async () => {
    const m = possessionMessage(owner, "gacha");
    await expect(signPossessionMessage(sk, m.slice(0, 32))).rejects.toThrow(
      /refusing/,
    );
    await expect(
      signPossessionMessage(sk, new Uint8Array(114)),
    ).rejects.toThrow(/refusing/);
    await expect(
      signPossessionMessage(sk, new Uint8Array([...m, 0])),
    ).rejects.toThrow(/refusing/);
    await expect(signPossessionMessage(sk.slice(0, 31), m)).rejects.toThrow(
      /32-byte/,
    );
  });
});
