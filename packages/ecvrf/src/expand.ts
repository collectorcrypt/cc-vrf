import { sha512 } from "@noble/hashes/sha2.js";
import { concatBytes } from "./encoding";
import { HASH_LEN } from "./suite";

/**
 * Deterministic expansion of a VRF beta (64-byte SHA-512 output) into an
 * arbitrary stream of typed random values.
 *
 * Block i of the stream is:
 *
 *   SHA-512( "ecvrf-expand-v1" || beta || encode(path) || u64_be(i) )
 *
 * where encode(path) is length-prefixed so distinct path arrays never collide.
 * The prefix tag is disjoint from RFC 9381 §5.2 proof_to_hash input, so a
 * stream value can never collide with another beta.
 *
 * Anyone with beta — which any verifier can recompute from a valid proof via
 * vrfProofToHash — can reconstruct every value in every fork by calling
 * vrfStream(beta, ...path) with the same path the operator committed to.
 */

const EXPAND_TAG = new TextEncoder().encode("ecvrf-expand-v1");

function u32be(n: number): Uint8Array {
  return new Uint8Array([
    (n >>> 24) & 0xff,
    (n >>> 16) & 0xff,
    (n >>> 8) & 0xff,
    n & 0xff,
  ]);
}

function u64be(n: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = n;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function encodePath(path: readonly string[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [u32be(path.length)];
  for (const p of path) {
    const b = enc.encode(p);
    parts.push(u32be(b.length));
    parts.push(b);
  }
  return concatBytes(...parts);
}

export interface VrfStream {
  readonly beta: Uint8Array;
  readonly path: readonly string[];
  nextBytes(n: number): Uint8Array;
  nextU32(): number;
  nextU64(): bigint;
  nextRange(minInclusive: number, maxExclusive: number): number;
  nextFloat(): number;
  pick<T>(arr: readonly T[]): T;
  shuffle<T>(arr: readonly T[]): T[];
  fork(...label: string[]): VrfStream;
}

export function vrfStream(beta: Uint8Array, ...path: string[]): VrfStream {
  if (beta.length !== HASH_LEN) {
    throw new Error(`beta must be ${HASH_LEN} bytes (SHA-512 output)`);
  }
  const betaCopy = new Uint8Array(beta);
  const encodedPath = encodePath(path);
  const pathCopy = Object.freeze([...path]);

  let blockIndex = 0n;
  let buf = new Uint8Array(0);
  let bufOffset = 0;

  function refill(): void {
    buf = sha512(
      concatBytes(EXPAND_TAG, betaCopy, encodedPath, u64be(blockIndex)),
    );
    bufOffset = 0;
    blockIndex += 1n;
  }

  function nextBytes(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0) {
      throw new Error("nextBytes: n must be a non-negative integer");
    }
    const out = new Uint8Array(n);
    let written = 0;
    while (written < n) {
      if (bufOffset >= buf.length) refill();
      const take = Math.min(n - written, buf.length - bufOffset);
      out.set(buf.subarray(bufOffset, bufOffset + take), written);
      bufOffset += take;
      written += take;
    }
    return out;
  }

  function nextU32(): number {
    const b = nextBytes(4);
    return ((b[0] << 24) | (b[1] << 16) | (b[2] << 8) | b[3]) >>> 0;
  }

  function nextU64(): bigint {
    const b = nextBytes(8);
    let v = 0n;
    for (let i = 0; i < 8; i++) v = (v << 8n) | BigInt(b[i]);
    return v;
  }

  function nextFloat(): number {
    return Number(nextU64() >> 11n) / 2 ** 53;
  }

  function nextRange(minInclusive: number, maxExclusive: number): number {
    if (!Number.isInteger(minInclusive) || !Number.isInteger(maxExclusive)) {
      throw new Error("nextRange: bounds must be integers");
    }
    if (maxExclusive <= minInclusive) {
      throw new Error("nextRange: maxExclusive must exceed minInclusive");
    }
    const range = maxExclusive - minInclusive;
    if (range > 0x100000000) {
      throw new Error("nextRange: range exceeds 2^32");
    }
    let mask = range - 1;
    mask |= mask >>> 1;
    mask |= mask >>> 2;
    mask |= mask >>> 4;
    mask |= mask >>> 8;
    mask |= mask >>> 16;
    mask = mask >>> 0;
    for (;;) {
      const v = nextU32() & mask;
      if (v < range) return minInclusive + v;
    }
  }

  function pick<T>(arr: readonly T[]): T {
    if (arr.length === 0) throw new Error("pick: empty array");
    return arr[nextRange(0, arr.length)];
  }

  function shuffle<T>(arr: readonly T[]): T[] {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = nextRange(0, i + 1);
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }

  function fork(...label: string[]): VrfStream {
    return vrfStream(betaCopy, ...pathCopy, ...label);
  }

  return {
    beta: new Uint8Array(betaCopy),
    path: pathCopy,
    nextBytes,
    nextU32,
    nextU64,
    nextRange,
    nextFloat,
    pick,
    shuffle,
    fork,
  };
}
