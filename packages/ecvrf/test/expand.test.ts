import { describe, expect, it } from "vitest";
import { sha512 } from "@noble/hashes/sha2.js";
import { bytesToHex, vrfStream } from "../src";

const beta = sha512(new TextEncoder().encode("expand-test-beta"));
const otherBeta = sha512(new TextEncoder().encode("expand-test-beta-2"));

describe("vrfStream", () => {
  it("rejects beta of wrong length", () => {
    expect(() => vrfStream(new Uint8Array(32))).toThrow(/64 bytes/);
  });

  it("is deterministic for the same beta and path", () => {
    const a = vrfStream(beta, "combat").nextBytes(128);
    const b = vrfStream(beta, "combat").nextBytes(128);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });

  it("decorrelates different paths", () => {
    const a = vrfStream(beta, "combat").nextBytes(64);
    const b = vrfStream(beta, "loot").nextBytes(64);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("decorrelates different betas under the same path", () => {
    const a = vrfStream(beta, "combat").nextBytes(64);
    const b = vrfStream(otherBeta, "combat").nextBytes(64);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("treats path segments unambiguously (length-prefixed)", () => {
    const a = vrfStream(beta, "ab", "c").nextBytes(32);
    const b = vrfStream(beta, "a", "bc").nextBytes(32);
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });

  it("crosses block boundaries correctly", () => {
    const ref = vrfStream(beta, "blocks").nextBytes(200);
    const s = vrfStream(beta, "blocks");
    const chunks: Uint8Array[] = [];
    const sizes = [1, 7, 56, 1, 64, 71];
    let total = 0;
    for (const n of sizes) {
      chunks.push(s.nextBytes(n));
      total += n;
    }
    const joined = new Uint8Array(total);
    let off = 0;
    for (const c of chunks) {
      joined.set(c, off);
      off += c.length;
    }
    expect(bytesToHex(joined)).toBe(bytesToHex(ref.subarray(0, total)));
  });

  it("nextU32 yields a 32-bit unsigned integer", () => {
    const s = vrfStream(beta, "u32");
    for (let i = 0; i < 16; i++) {
      const v = s.nextU32();
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(0xffffffff);
    }
  });

  it("nextRange stays within bounds", () => {
    const s = vrfStream(beta, "range");
    for (let i = 0; i < 1000; i++) {
      const v = s.nextRange(10, 17);
      expect(v).toBeGreaterThanOrEqual(10);
      expect(v).toBeLessThan(17);
    }
  });

  it("nextRange is roughly uniform on a biased modulus (d6)", () => {
    const counts = new Array(6).fill(0);
    const s = vrfStream(beta, "d6");
    const N = 60_000;
    for (let i = 0; i < N; i++) counts[s.nextRange(0, 6)]++;
    const expected = N / 6;
    for (const c of counts) {
      expect(Math.abs(c - expected) / expected).toBeLessThan(0.05);
    }
  });

  it("nextRange rejects bad bounds", () => {
    const s = vrfStream(beta);
    expect(() => s.nextRange(5, 5)).toThrow();
    expect(() => s.nextRange(5, 4)).toThrow();
    expect(() => s.nextRange(1.5, 4)).toThrow();
  });

  it("shuffle is a permutation", () => {
    const input = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const out = vrfStream(beta, "shuffle").shuffle(input);
    expect(out.length).toBe(input.length);
    expect([...out].sort((a, b) => a - b)).toEqual(input);
    expect(out).not.toEqual(input);
  });

  it("shuffle does not mutate input", () => {
    const input = [1, 2, 3, 4];
    const snapshot = [...input];
    vrfStream(beta, "shuffle").shuffle(input);
    expect(input).toEqual(snapshot);
  });

  it("pick returns a member of the array", () => {
    const arr = ["a", "b", "c", "d"];
    const picked = vrfStream(beta, "pick").pick(arr);
    expect(arr).toContain(picked);
  });

  it("fork yields independent, reproducible sub-streams", () => {
    const root = vrfStream(beta, "match-42");
    const a1 = root.fork("combat").nextBytes(32);
    const a2 = root.fork("combat").nextBytes(32);
    const b1 = root.fork("loot").nextBytes(32);
    expect(bytesToHex(a1)).toBe(bytesToHex(a2));
    expect(bytesToHex(a1)).not.toBe(bytesToHex(b1));
  });

  it("fork equals direct construction with the joined path", () => {
    const viaFork = vrfStream(beta, "a").fork("b", "c").nextBytes(64);
    const direct = vrfStream(beta, "a", "b", "c").nextBytes(64);
    expect(bytesToHex(viaFork)).toBe(bytesToHex(direct));
  });

  it("parent stream consumption is independent of forks", () => {
    const root = vrfStream(beta, "root");
    const before = root.nextU32();
    const fork = root.fork("child");
    fork.nextBytes(1024);
    const after = root.nextU32();
    const reference = vrfStream(beta, "root");
    expect(reference.nextU32()).toBe(before);
    expect(reference.nextU32()).toBe(after);
  });

  it("nextFloat stays in [0, 1)", () => {
    const s = vrfStream(beta, "float");
    for (let i = 0; i < 256; i++) {
      const v = s.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("exposed beta is a defensive copy", () => {
    const s = vrfStream(beta, "iso");
    s.beta[0] ^= 0xff;
    const a = vrfStream(beta, "iso").nextBytes(16);
    const b = s.nextBytes(16);
    expect(bytesToHex(a)).toBe(bytesToHex(b));
  });
});
