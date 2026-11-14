/**
 * Root ring: the last 128 batch roots of one authority in a plain account (`["root_ring", authority_address]`,
 * 7,352 bytes), readable by other programs without CPI. Entry `seq` lives at `entries[seq % 128]` and is live iff
 * `seq != 0 && seq < next_seq && entries[seq % 128].seq == seq`. Same layout as crates/cc-vrf-verify `ring`.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { sha256 } from "@noble/hashes/sha2.js";
import { Connection, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Rpc } from "@lightprotocol/stateless.js";

import { CommitBatchInput, checkBatchInput } from "./batch";
import { CC_VRF_PROGRAM_ID } from "./constants";
import { buildReadOnlyAuthorityContext } from "./light";
import { assertAuthorityCanCommit, fetchAuthority } from "./operations";

export const ROOT_RING_SEED = new TextEncoder().encode("root_ring");
export const RING_CAPACITY = 128;
export const RING_ACCOUNT_LEN = 7352;
export const RING_DISCRIMINATOR = sha256(
  new TextEncoder().encode("account:VrfRootRing"),
).slice(0, 8);
const ENTRIES = 8 + 176;
const ENTRY_LEN = 56;

export function deriveRootRingAddress(
  authorityAddress: PublicKey,
  programId: PublicKey = CC_VRF_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [ROOT_RING_SEED, authorityAddress.toBytes()],
    programId,
  )[0];
}

export interface RootRingEntry {
  seq: bigint;
  slot: bigint;
  root: Uint8Array;
  count: number;
  leafVersion: number;
}

export interface RootRing {
  version: number;
  bump: number;
  capacity: number;
  nextSeq: bigint;
  authority: PublicKey;
  owner: PublicKey;
  label: Uint8Array;
}

/** Header of a version-1 ring, or null if the bytes are not one. */
export function decodeRootRing(data: Uint8Array): RootRing | null {
  if (data.length !== RING_ACCOUNT_LEN) return null;
  for (let i = 0; i < 8; i++)
    if (data[i] !== RING_DISCRIMINATOR[i]) return null;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const ring: RootRing = {
    version: data[8],
    bump: data[9],
    capacity: v.getUint16(10, true),
    nextSeq: v.getBigUint64(16, true),
    authority: new PublicKey(data.slice(24, 56)),
    owner: new PublicKey(data.slice(56, 88)),
    label: data.slice(88, 120),
  };
  return ring.version === 1 && ring.capacity === RING_CAPACITY ? ring : null;
}

/** The live entry for `seq`, or null (never committed, or evicted by `seq + 128`). */
export function rootRingEntry(
  data: Uint8Array,
  seq: bigint,
): RootRingEntry | null {
  const ring = decodeRootRing(data);
  if (!ring || seq === 0n || seq >= ring.nextSeq) return null;
  const o = ENTRIES + Number(seq % BigInt(RING_CAPACITY)) * ENTRY_LEN;
  const v = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const entry: RootRingEntry = {
    seq: v.getBigUint64(o, true),
    slot: v.getBigUint64(o + 8, true),
    root: data.slice(o + 16, o + 48),
    count: v.getUint32(o + 48, true),
    leafVersion: data[o + 52],
  };
  return entry.seq === seq ? entry : null;
}

/** The ring account if it exists and is owned by the program. */
export async function fetchRootRing(
  connection: Connection,
  authorityAddress: PublicKey,
  programId: PublicKey = CC_VRF_PROGRAM_ID,
): Promise<{ address: PublicKey; data: Uint8Array; ring: RootRing } | null> {
  const address = deriveRootRingAddress(authorityAddress, programId);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(programId)) return null;
  const data = Uint8Array.from(info.data);
  const ring = decodeRootRing(data);
  return ring ? { address, data, ring } : null;
}

export async function buildInitRootRingIx(
  program: Program,
  rpc: Rpc,
  input: { owner: PublicKey; label: string | Uint8Array },
): Promise<{ ix: TransactionInstruction; ringAddress: PublicKey }> {
  const auth = await fetchAuthority(program, rpc, input.owner, input.label);
  assertAuthorityCanCommit(auth);
  const ringAddress = deriveRootRingAddress(
    auth.authorityAddress,
    program.programId,
  );
  const ctx = await buildReadOnlyAuthorityContext(
    rpc,
    program.programId,
    auth.account,
  );
  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .initRootRing(
      Array.from(auth.onChainAuthority.label),
      ctx.proof,
      ctx.authorityReadOnlyMeta,
      auth.decoded,
    )
    .accounts({
      owner: input.owner,
      rootRing: ringAddress,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();
  return { ix, ringAddress };
}

/**
 * commit_batch_ring at `expectedSeq` (default: the ring's next_seq). A retried send with the same expectedSeq can
 * never insert twice: the program refuses it with RingSeqMismatch.
 */
export async function buildCommitBatchRingIx(
  program: Program,
  rpc: Rpc,
  input: CommitBatchInput & { expectedSeq?: bigint },
): Promise<{
  ix: TransactionInstruction;
  ringAddress: PublicKey;
  seq: bigint;
}> {
  const { labelBytes, leafVersion } = checkBatchInput(input);
  const auth = await fetchAuthority(program, rpc, input.owner, labelBytes);
  assertAuthorityCanCommit(auth);
  const ringAddress = deriveRootRingAddress(
    auth.authorityAddress,
    program.programId,
  );
  let seq = input.expectedSeq;
  if (seq === undefined) {
    const fetched = await fetchRootRing(
      program.provider.connection,
      auth.authorityAddress,
      program.programId,
    );
    if (!fetched)
      throw new Error("root ring not found: run init_root_ring first");
    seq = fetched.ring.nextSeq;
  }
  const ctx = await buildReadOnlyAuthorityContext(
    rpc,
    program.programId,
    auth.account,
  );
  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .commitBatchRing(
      Array.from(labelBytes),
      Array.from(input.root),
      input.count,
      leafVersion,
      new anchor.BN(seq.toString()),
      ctx.proof,
      ctx.authorityReadOnlyMeta,
      auth.decoded,
    )
    .accounts({ owner: input.owner, rootRing: ringAddress } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();
  return { ix, ringAddress, seq };
}
