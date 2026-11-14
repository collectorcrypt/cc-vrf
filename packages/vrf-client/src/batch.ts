/**
 * Batch spec v1: one on-chain commit per Merkle root over many VRF results.
 *
 *   leaf = SHA256(0x00 ‖ "ccvrf-batch-v1" ‖ SHA256(memo) ‖ SHA256(alpha) ‖ SHA256(proof80) ‖ beta64)
 *   node = SHA256(0x01 ‖ left ‖ right)        root = RFC 9162 MTH over the leaves in index order
 *
 * The commit records the root with its leaf `count`; verify a leaf with that count (RFC 9162 §2.1.3.2), never a
 * caller-supplied one. Always rebuild the leaf from its fields. Same rules and vectors as the Rust crate
 * cc-vrf-verify (crates/cc-vrf-verify/vectors/batch-v1.json).
 */
import { Program } from "@coral-xyz/anchor";
import { verifyVRF, vrfProofToHash, hexToBytes } from "@collectorcrypt/ecvrf";
import { sha256 } from "@noble/hashes/sha2.js";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Rpc } from "@lightprotocol/stateless.js";

import { deriveAuthorityAddress, encodeLabel } from "./addresses";
import { CC_VRF_PROGRAM_ID, SUITE_EDWARDS25519_SHA512_TAI } from "./constants";
import { buildReadOnlyAuthorityContext } from "./light";
import { decodeCcVrfTransaction, nameIs, tryGetTransaction } from "./logs";
import {
  assertAuthorityCanCommit,
  bytesEqual,
  fetchAuthority,
} from "./operations";
import { OnChainAuthority } from "./verifyEndToEnd";

export const BATCH_LEAF_VERSION = 1;
/** Largest `count` the program accepts in one commit. */
export const MAX_BATCH_COUNT = 1 << 20;
const LEAF_TAG = new TextEncoder().encode("ccvrf-batch-v1");

function concat(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface BatchLeafFields {
  memo: string | Uint8Array;
  alpha: Uint8Array;
  /** The 80-byte ECVRF proof (required whole: the leaf binds its hash). */
  proof: Uint8Array;
  /** The 64-byte beta (vrfProofToHash(proof)). */
  beta: Uint8Array;
}

export function batchLeafV1(f: BatchLeafFields): Uint8Array {
  if (f.proof.length !== 80) throw new Error("proof must be 80 bytes");
  if (f.beta.length !== 64) throw new Error("beta must be 64 bytes");
  const memo =
    typeof f.memo === "string" ? new TextEncoder().encode(f.memo) : f.memo;
  return sha256(
    concat(
      Uint8Array.of(0x00),
      LEAF_TAG,
      sha256(memo),
      sha256(f.alpha),
      sha256(f.proof),
      f.beta,
    ),
  );
}

/**
 * Leaf for a stored award (hex fields as gachamachine keeps them). Beta is recomputed from the proof; a stored beta
 * that disagrees throws instead of committing an inconsistent leaf.
 */
export function batchLeafFromPack(p: {
  memo: string;
  alphaHex: string;
  proofHex: string;
  betaHex?: string | null;
}): Uint8Array {
  const proof = hexToBytes(p.proofHex.replace(/^0x/, ""));
  const beta = vrfProofToHash(proof);
  if (
    p.betaHex &&
    !bytesEqual(hexToBytes(p.betaHex.replace(/^0x/, "")), beta)
  ) {
    throw new Error("stored beta does not match vrfProofToHash(proof)");
  }
  return batchLeafV1({
    memo: p.memo,
    alpha: hexToBytes(p.alphaHex.replace(/^0x/, "")),
    proof,
    beta,
  });
}

export function batchNode(left: Uint8Array, right: Uint8Array): Uint8Array {
  return sha256(concat(Uint8Array.of(0x01), left, right));
}

/** Largest power of two strictly below n (n >= 2). */
function split(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

export interface Batch {
  root: Uint8Array;
  count: number;
  /** RFC 9162 PATH(index), leaf level first. */
  path(index: number): Uint8Array[];
}

/** RFC 9162 tree over leaf hashes; subtree roots are memoized, so every path costs O(log n). */
export function buildBatch(leaves: Uint8Array[]): Batch {
  if (leaves.length === 0) throw new Error("a batch has at least one leaf");
  if (leaves.length > MAX_BATCH_COUNT)
    throw new Error(`a batch holds at most ${MAX_BATCH_COUNT} leaves`);
  const memo = new Map<string, Uint8Array>();
  const mth = (start: number, end: number): Uint8Array => {
    if (end - start === 1) return leaves[start];
    const key = `${start}:${end}`;
    const hit = memo.get(key);
    if (hit) return hit;
    const k = split(end - start);
    const r = batchNode(mth(start, start + k), mth(start + k, end));
    memo.set(key, r);
    return r;
  };
  const root = mth(0, leaves.length);
  return {
    root,
    count: leaves.length,
    path(index: number): Uint8Array[] {
      if (!Number.isInteger(index) || index < 0 || index >= leaves.length)
        throw new Error("index out of range");
      const out: Uint8Array[] = [];
      const walk = (start: number, end: number, i: number) => {
        if (end - start <= 1) return;
        const k = split(end - start);
        if (i < start + k) {
          walk(start, start + k, i);
          out.push(mth(start + k, end));
        } else {
          walk(start + k, end, i);
          out.push(mth(start, start + k));
        }
      };
      walk(0, leaves.length, index);
      return out;
    },
  };
}

/** RFC 9162 §2.1.3.2 inclusion check of a leaf hash. Prefer {@link verifyBatchPath}, which rebuilds the leaf. */
export function verifyInclusion(
  root: Uint8Array,
  count: number,
  index: number,
  leaf: Uint8Array,
  path: Uint8Array[],
): boolean {
  if (!Number.isSafeInteger(count) || !Number.isSafeInteger(index))
    return false;
  if (count < 1 || count > MAX_BATCH_COUNT || index < 0 || index >= count)
    return false;
  let fn = index;
  let sn = count - 1;
  let r = leaf;
  for (const p of path) {
    if (sn === 0) return false;
    if (fn % 2 === 1 || fn === sn) {
      r = batchNode(p, r);
      while (fn % 2 === 0 && fn !== 0) {
        fn = Math.floor(fn / 2);
        sn = Math.floor(sn / 2);
      }
    } else {
      r = batchNode(r, p);
    }
    fn = Math.floor(fn / 2);
    sn = Math.floor(sn / 2);
  }
  return sn === 0 && bytesEqual(r, root);
}

/** Rebuilds the v1 leaf from its fields and checks it against the committed root and count. */
export function verifyBatchPath(input: {
  root: Uint8Array;
  count: number;
  index: number;
  fields: BatchLeafFields;
  path: Uint8Array[];
}): boolean {
  return verifyInclusion(
    input.root,
    input.count,
    input.index,
    batchLeafV1(input.fields),
    input.path,
  );
}

export interface CommitBatchInput {
  owner: PublicKey;
  label: string | Uint8Array;
  root: Uint8Array;
  count: number;
  leafVersion?: number;
}

export function checkBatchInput(input: CommitBatchInput): {
  labelBytes: Uint8Array;
  leafVersion: number;
} {
  const labelBytes =
    typeof input.label === "string" ? encodeLabel(input.label) : input.label;
  if (labelBytes.length !== 32)
    throw new Error("label must encode to exactly 32 bytes");
  if (input.root.length !== 32 || input.root.every((b) => b === 0))
    throw new Error("root must be 32 non-zero bytes");
  if (
    !Number.isInteger(input.count) ||
    input.count < 1 ||
    input.count > MAX_BATCH_COUNT
  ) {
    throw new Error(`count must be 1..${MAX_BATCH_COUNT}`);
  }
  const leafVersion = input.leafVersion ?? BATCH_LEAF_VERSION;
  if (leafVersion !== BATCH_LEAF_VERSION)
    throw new Error(`unsupported leaf version ${leafVersion}`);
  return { labelBytes, leafVersion };
}

/** commit_batch_event: one VrfBatchCommitted log, no account writes. Data prefix (label, root, count, leaf_version) at [8..77]. */
export async function buildCommitBatchEventIx(
  program: Program,
  rpc: Rpc,
  input: CommitBatchInput,
): Promise<TransactionInstruction> {
  const { labelBytes, leafVersion } = checkBatchInput(input);
  const auth = await fetchAuthority(program, rpc, input.owner, labelBytes);
  assertAuthorityCanCommit(auth);
  const ctx = await buildReadOnlyAuthorityContext(
    rpc,
    program.programId,
    auth.account,
  );
  return (
    program.methods
      // @ts-ignore: Anchor IDL types are dynamic at this layer
      .commitBatchEvent(
        Array.from(labelBytes),
        Array.from(input.root),
        input.count,
        leafVersion,
        ctx.proof,
        ctx.authorityReadOnlyMeta,
        auth.decoded,
      )
      .accounts({ owner: input.owner } as never)
      .remainingAccounts(ctx.remainingAccountMetas)
      .instruction()
  );
}

/** One `VrfBatchCommitted` (from the log, or from the signed instruction when the RPC returned no usable log). */
export interface BatchCommit {
  owner: PublicKey;
  label: Uint8Array;
  root: Uint8Array;
  count: number;
  leafVersion: number;
  /** Ring sequence for commit_batch_ring, null for commit_batch_event. */
  ringSeq: bigint | null;
  committedSlot: bigint;
  txSignature: string;
  slot: number;
}

/** The batch commits in one transaction (normally exactly one). `unfetched` = the RPC returned no transaction. */
export async function findBatchCommits(
  program: Program,
  connection: Connection,
  signature: string,
): Promise<{ commits: BatchCommit[]; unfetched: boolean }> {
  const tx = await tryGetTransaction(connection, signature);
  if (!tx) return { commits: [], unfetched: true };
  const { events, instructions } = decodeCcVrfTransaction(program, tx);
  const commits: BatchCommit[] = [];
  for (const ev of events) {
    if (!nameIs(ev.name, "vrf_batch_committed")) continue;
    const d = ev.data;
    const seq = d.ringSeq ?? d.ring_seq;
    commits.push({
      owner: new PublicKey(d.owner),
      label: Uint8Array.from(d.label),
      root: Uint8Array.from(d.root),
      count: Number(d.count),
      leafVersion: Number(d.leafVersion ?? d.leaf_version),
      ringSeq: seq == null ? null : BigInt(seq.toString()),
      committedSlot: BigInt((d.committedSlot ?? d.committed_slot).toString()),
      txSignature: signature,
      slot: tx.slot,
    });
  }
  if (commits.length === 0) {
    for (const ix of instructions) {
      const ring = nameIs(ix.name, "commit_batch_ring");
      if (!ring && !nameIs(ix.name, "commit_batch_event")) continue;
      const d = ix.data;
      commits.push({
        owner: ix.owner,
        label: Uint8Array.from(d.label),
        root: Uint8Array.from(d.root),
        count: Number(d.count),
        leafVersion: Number(d.leafVersion ?? d.leaf_version),
        ringSeq: ring
          ? BigInt((d.expectedSeq ?? d.expected_seq).toString())
          : null,
        committedSlot: BigInt(tx.slot),
        txSignature: signature,
        slot: tx.slot,
      });
    }
  }
  return { commits, unfetched: false };
}

export interface VerifyBatchCommitInput {
  authority: OnChainAuthority;
  batch: BatchCommit;
  memo: string | Uint8Array;
  alpha: Uint8Array;
  proof: Uint8Array;
  index: number;
  path: Uint8Array[];
  expectedOwner?: PublicKey;
  expectedLabel?: Uint8Array;
  programId?: PublicKey;
}

export interface VerifyBatchCommitResult {
  /** ECVRF valid, leaf in the committed batch, authority frozen and bound to the batch's (owner, label). */
  valid: boolean;
  ecvrfValid: boolean;
  leafInBatch: boolean;
  leafVersionSupported: boolean;
  authorityFrozen: boolean;
  batchAuthorityMatches: boolean;
  authorityOwnerMatches: boolean;
  authorityLabelMatches: boolean;
  /** Informational: a revoked flag never invalidates a commit. */
  authorityNotRevoked: boolean;
  beta: Uint8Array | null;
  authorityAddress: PublicKey;
  reasons: string[];
  notes: string[];
}

/** Full check of one VRF result committed in a batch. Fetch `authority` from (batch.owner, batch.label). */
export function verifyBatchCommitEndToEnd(
  input: VerifyBatchCommitInput,
): VerifyBatchCommitResult {
  const reasons: string[] = [];
  const notes: string[] = [];
  const a = input.authority;
  const suiteOk = a.suite === SUITE_EDWARDS25519_SHA512_TAI;
  if (!suiteOk) reasons.push(`unsupported-suite-${a.suite}`);
  const ecvrfValid =
    suiteOk &&
    input.proof.length === 80 &&
    verifyVRF(a.pk, input.alpha, input.proof);
  if (!ecvrfValid) reasons.push("ecvrf-verify-failed");
  const beta = ecvrfValid ? vrfProofToHash(input.proof) : null;

  const leafVersionSupported = input.batch.leafVersion === BATCH_LEAF_VERSION;
  if (!leafVersionSupported)
    reasons.push(`unsupported-leaf-version-${input.batch.leafVersion}`);
  const leafInBatch =
    beta !== null &&
    leafVersionSupported &&
    verifyBatchPath({
      root: input.batch.root,
      count: input.batch.count,
      index: input.index,
      fields: {
        memo: input.memo,
        alpha: input.alpha,
        proof: input.proof,
        beta,
      },
      path: input.path,
    });
  if (!leafInBatch) reasons.push("leaf-not-in-batch");

  const authorityFrozen = a.frozen;
  if (!authorityFrozen) reasons.push("authority-not-frozen");
  const authorityNotRevoked = !a.revoked;
  if (!authorityNotRevoked) notes.push("authority-revoked");
  const batchAuthorityMatches =
    input.batch.owner.equals(a.owner) && bytesEqual(input.batch.label, a.label);
  if (!batchAuthorityMatches) reasons.push("batch-authority-mismatch");
  const authorityOwnerMatches = input.expectedOwner
    ? a.owner.equals(input.expectedOwner)
    : true;
  if (!authorityOwnerMatches) reasons.push("authority-owner-mismatch");
  const authorityLabelMatches = input.expectedLabel
    ? bytesEqual(a.label, input.expectedLabel)
    : true;
  if (!authorityLabelMatches) reasons.push("authority-label-mismatch");

  // The authority must be the one at (owner, label): its address is what the program proved read-only.
  const programId = input.programId ?? CC_VRF_PROGRAM_ID;
  const authorityAddress = deriveAuthorityAddress(a.owner, a.label, programId);
  const addressOk =
    !a.authorityAddress || a.authorityAddress.equals(authorityAddress);
  if (!addressOk) reasons.push("authority-address-mismatch");

  const valid =
    ecvrfValid &&
    leafInBatch &&
    authorityFrozen &&
    batchAuthorityMatches &&
    authorityOwnerMatches &&
    authorityLabelMatches &&
    addressOk;
  return {
    valid,
    ecvrfValid,
    leafInBatch,
    leafVersionSupported,
    authorityFrozen,
    batchAuthorityMatches,
    authorityOwnerMatches,
    authorityLabelMatches,
    authorityNotRevoked,
    beta,
    authorityAddress,
    reasons,
    notes,
  };
}
