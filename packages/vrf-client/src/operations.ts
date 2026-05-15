import * as anchor from "@coral-xyz/anchor";
import { BorshCoder, EventParser, Program } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  bn,
  CompressedAccountWithMerkleContext,
  Rpc,
} from "@lightprotocol/stateless.js";

import {
  alphaHash as alphaHashFn,
  deriveAuthorityAddress,
  deriveProofCommitAddress,
  deriveProofCommitWithBetaAddress,
  encodeLabel,
  memoHash as memoHashFn,
  proofHash as proofHashFn,
} from "./addresses";
import {
  buildCommitProofContext,
  buildCreateContext,
  buildMutateContext,
  forceLightV2,
} from "./light";
import { OnChainCommit } from "./verifyEndToEnd";

/**
 * Decode a VrfAuthority record from a fetched compressed-account row.
 * Wraps the Anchor coder so callers can stay in terms of typed fields.
 */
export function decodeAuthority(program: Program, dataBytes: Uint8Array) {
  // Anchor 0.31 normalizes IDL type names to camelCase on `program.idl`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (program as any).coder.types.decode(
    "vrfAuthority",
    Buffer.from(dataBytes),
  ) as {
    owner: PublicKey;
    pk: number[];
    suite: number;
    frozen: boolean;
    revoked: boolean;
    label: number[];
    createdSlot: anchor.BN;
  };
}

export function decodeProofCommit(program: Program, dataBytes: Uint8Array) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (program as any).coder.types.decode(
    "vrfProofCommit",
    Buffer.from(dataBytes),
  ) as {
    authority: PublicKey;
    memoHash: number[];
    proofHash: number[];
    alphaHash: number[];
    committedSlot: anchor.BN;
  };
}

export function decodeProofCommitWithBeta(
  program: Program,
  dataBytes: Uint8Array,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (program as any).coder.types.decode(
    "vrfProofCommitWithBeta",
    Buffer.from(dataBytes),
  ) as {
    authority: PublicKey;
    memoHash: number[];
    proofHash: number[];
    alphaHash: number[];
    betaLo: number[];
    betaHi: number[];
    committedSlot: anchor.BN;
  };
}

/**
 * Fetch a VrfAuthority compressed account by (owner, label). Returns null
 * if no such authority exists.
 */
export async function fetchAuthority(
  program: Program,
  rpc: Rpc,
  owner: PublicKey,
  label: string | Uint8Array,
): Promise<{
  authorityAddress: PublicKey;
  account: CompressedAccountWithMerkleContext;
  decoded: ReturnType<typeof decodeAuthority>;
} | null> {
  forceLightV2();
  const labelBytes =
    typeof label === "string" ? encodeLabel(label) : label;
  const authorityAddress = deriveAuthorityAddress(
    owner,
    labelBytes,
    program.programId,
  );
  const account = await rpc.getCompressedAccount(bn(authorityAddress.toBytes()));
  if (!account) return null;
  const decoded = decodeAuthority(program, Uint8Array.from(account.data!.data));
  return { authorityAddress, account, decoded };
}

/**
 * Fetch a VrfProofCommit by (authority, memo). Returns null if no such
 * commit exists yet.
 */
export async function fetchProofCommit(
  program: Program,
  rpc: Rpc,
  authority: PublicKey,
  memo: string | Uint8Array,
): Promise<{
  commitAddress: PublicKey;
  account: CompressedAccountWithMerkleContext;
  decoded: ReturnType<typeof decodeProofCommit>;
  onChainCommit: OnChainCommit;
} | null> {
  forceLightV2();
  const mh = memoHashFn(memo);
  const commitAddress = deriveProofCommitAddress(
    authority,
    mh,
    program.programId,
  );
  const account = await rpc.getCompressedAccount(bn(commitAddress.toBytes()));
  if (!account) return null;
  const decoded = decodeProofCommit(program, Uint8Array.from(account.data!.data));
  return {
    commitAddress,
    account,
    decoded,
    onChainCommit: {
      memoHash: Uint8Array.from(decoded.memoHash),
      proofHash: Uint8Array.from(decoded.proofHash),
      alphaHash: Uint8Array.from(decoded.alphaHash),
      committedSlot: BigInt(decoded.committedSlot.toString()),
    },
  };
}

export interface InitAuthorityInput {
  owner: PublicKey;
  pk: Uint8Array;
  suite: number;
  label: string | Uint8Array;
}

/**
 * Build the init_authority instruction. Caller is responsible for adding it
 * to a transaction with the owner as signer and submitting it.
 */
export async function buildInitAuthorityIx(
  program: Program,
  rpc: Rpc,
  input: InitAuthorityInput,
): Promise<{ ix: TransactionInstruction; authorityAddress: PublicKey }> {
  if (input.pk.length !== 32) {
    throw new Error("pk must be 32 bytes");
  }
  const labelBytes =
    typeof input.label === "string" ? encodeLabel(input.label) : input.label;
  if (labelBytes.length !== 32) {
    throw new Error("label must encode to exactly 32 bytes");
  }
  const authorityAddress = deriveAuthorityAddress(
    input.owner,
    labelBytes,
    program.programId,
  );

  const ctx = await buildCreateContext(rpc, program.programId, authorityAddress);

  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .initAuthority(
      ctx.proof,
      ctx.packedAddressTreeInfo,
      ctx.outputStateTreeIndex,
      Array.from(input.pk),
      input.suite,
      Array.from(labelBytes),
    )
    .accounts({
      owner: input.owner,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();

  return { ix, authorityAddress };
}

export interface FreezeAuthorityInput {
  owner: PublicKey;
  label: string | Uint8Array;
}

export async function buildFreezeAuthorityIx(
  program: Program,
  rpc: Rpc,
  input: FreezeAuthorityInput,
): Promise<TransactionInstruction> {
  const auth = await fetchAuthority(program, rpc, input.owner, input.label);
  if (!auth) throw new Error("authority not found");

  const ctx = await buildMutateContext(rpc, program.programId, auth.account);

  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .freezeAuthority(ctx.proof, auth.decoded, ctx.accountMeta)
    .accounts({ owner: input.owner } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();
  return ix;
}

export async function buildRevokeAuthorityIx(
  program: Program,
  rpc: Rpc,
  input: FreezeAuthorityInput,
): Promise<TransactionInstruction> {
  const auth = await fetchAuthority(program, rpc, input.owner, input.label);
  if (!auth) throw new Error("authority not found");

  const ctx = await buildMutateContext(rpc, program.programId, auth.account);

  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .revokeAuthority(ctx.proof, auth.decoded, ctx.accountMeta)
    .accounts({ owner: input.owner } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();
  return ix;
}

export interface CommitProofInput {
  owner: PublicKey;
  label: string | Uint8Array;
  memo: string | Uint8Array;
  alpha: Uint8Array;
  proof: Uint8Array;
}

/**
 * Build the commit_proof instruction. The authority is looked up via
 * (owner, label) — must already exist on chain. memo/alpha/proof are hashed
 * via SHA-256 and stored in the new VrfProofCommit PDA.
 */
export async function buildCommitProofIx(
  program: Program,
  rpc: Rpc,
  input: CommitProofInput,
): Promise<{ ix: TransactionInstruction; commitAddress: PublicKey }> {
  if (input.proof.length !== 80) {
    throw new Error("proof must be 80 bytes (RFC 9381 Ed25519 ECVRF proof)");
  }

  const auth = await fetchAuthority(program, rpc, input.owner, input.label);
  if (!auth) throw new Error("authority not found");
  if (auth.decoded.revoked) throw new Error("authority is revoked");

  const mh = memoHashFn(input.memo);
  const commitAddress = deriveProofCommitAddress(
    auth.authorityAddress,
    mh,
    program.programId,
  );

  // One unified context: a single validity proof covers both the authority
  // input (read-only) and the new commit address, and both pack against the
  // same remainingAccounts list.
  const ctx = await buildCommitProofContext(
    rpc,
    program.programId,
    auth.account,
    commitAddress,
  );

  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .commitProof(
      ctx.proof,
      ctx.authorityReadOnlyMeta,
      auth.decoded,
      ctx.packedAddressTreeInfo,
      ctx.outputStateTreeIndex,
      Array.from(mh),
      Array.from(proofHashFn(input.proof)),
      Array.from(alphaHashFn(input.alpha)),
    )
    .accounts({ owner: input.owner } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();

  return { ix, commitAddress };
}

/**
 * Build the commit_proof_event instruction (event mode). Skips the Light CPI
 * entirely — the signer is taken as the implicit authority owner, and the
 * commitment is emitted as a Solana log event rather than written to a
 * compressed PDA.
 *
 * Roughly ~5x cheaper than `buildCommitProofIx` because there's no validity
 * proof, no address-tree slot, no state-tree slot, and no read-only authority
 * load. The trade-off is that the chain doesn't enforce one-commit-per-memo;
 * verifiers must scan for duplicate `memo_hash` events and pick the one
 * where ECVRF math passes (which is always exactly one, since proofs are
 * deterministic).
 */
export async function buildCommitProofEventIx(
  program: Program,
  input: CommitProofInput,
): Promise<TransactionInstruction> {
  if (input.proof.length !== 80) {
    throw new Error("proof must be 80 bytes (RFC 9381 Ed25519 ECVRF proof)");
  }
  const labelBytes =
    typeof input.label === "string" ? encodeLabel(input.label) : input.label;
  if (labelBytes.length !== 32) {
    throw new Error("label must encode to exactly 32 bytes");
  }
  const mh = memoHashFn(input.memo);

  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .commitProofEvent(
      Array.from(labelBytes),
      Array.from(mh),
      Array.from(proofHashFn(input.proof)),
      Array.from(alphaHashFn(input.alpha)),
    )
    .accounts({ owner: input.owner } as never)
    .instruction();

  return ix;
}

/**
 * One row decoded from a `VrfProofCommitted` log event. `txSignature` is the
 * Solana tx the event was emitted in; `slot` is the slot that tx confirmed in.
 *
 * `onChainCommit` is the same shape `verifyEndToEnd` expects, so the same
 * verification path works for PDA-mode and event-mode commits.
 */
export interface ProofCommitEvent {
  owner: PublicKey;
  label: Uint8Array;
  txSignature: string;
  slot: number;
  onChainCommit: OnChainCommit;
}

/**
 * Fetch all `VrfProofCommitted` events emitted for a given `(owner, label,
 * memo)` tuple, ordered oldest → newest. Returns an empty array if none
 * exist.
 *
 * IMPORTANT: this can return MORE than one row. The on-chain program does
 * not enforce uniqueness in event mode. A safe verifier:
 *
 *   1. Collects all matches for the requested memo.
 *   2. Runs `verifyEndToEnd` against each candidate proof.
 *   3. Accepts the unique row where the ECVRF math passes.
 *
 * Because ECVRF proofs are deterministic for a fixed (pk, alpha), at most
 * one of the candidates can have a valid `proof_hash`. The presence of extra
 * events is detectable noise, not a successful forgery — but a naive verifier
 * that picks "the latest event" without running ECVRF can be misled, which is
 * the only soundness gap relative to the PDA path.
 *
 * `connection` and `programId` are passed in explicitly so this works
 * against a plain Solana RPC — no Photon dependency.
 *
 * `limit` caps how many recent signatures to scan (default 1000); pagination
 * happens automatically via `getSignaturesForAddress`'s `before` cursor.
 */
export async function fetchProofCommitEvents(
  program: Program,
  connection: Connection,
  owner: PublicKey,
  label: string | Uint8Array,
  memo: string | Uint8Array,
  options: { limit?: number } = {},
): Promise<ProofCommitEvent[]> {
  const labelBytes =
    typeof label === "string" ? encodeLabel(label) : label;
  const targetMemoHash = memoHashFn(memo);

  const limit = options.limit ?? 1000;
  const sigInfos = await connection.getSignaturesForAddress(owner, { limit });

  const parser = new EventParser(program.programId, new BorshCoder(program.idl));
  const out: ProofCommitEvent[] = [];

  for (const sigInfo of sigInfos) {
    if (sigInfo.err) continue;
    const tx = await connection.getTransaction(sigInfo.signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx?.meta?.logMessages) continue;

    for (const ev of parser.parseLogs(tx.meta.logMessages, false)) {
      if (ev.name !== "VrfProofCommitted" && ev.name !== "vrfProofCommitted") continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = ev.data as any;
      const eventOwner: PublicKey = data.owner;
      const eventLabel: Uint8Array = Uint8Array.from(data.label);
      const eventMemoHash: Uint8Array = Uint8Array.from(data.memoHash);

      if (!eventOwner.equals(owner)) continue;
      if (!bytesEqual(eventLabel, labelBytes)) continue;
      if (!bytesEqual(eventMemoHash, targetMemoHash)) continue;

      out.push({
        owner: eventOwner,
        label: eventLabel,
        txSignature: sigInfo.signature,
        slot: tx.slot,
        onChainCommit: {
          memoHash: eventMemoHash,
          proofHash: Uint8Array.from(data.proofHash),
          alphaHash: Uint8Array.from(data.alphaHash),
          committedSlot: BigInt(data.committedSlot.toString()),
        },
      });
    }
  }

  // RPC returns newest first — reverse so oldest comes first.
  out.reverse();
  return out;
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Build the commit_proof_with_beta instruction (PDA mode + on-chain beta).
 * Like buildCommitProofIx, but additionally stores the 64-byte ECVRF beta
 * (output of vrfProofToHash) in the new compressed PDA so other Solana
 * programs can read it via a Light SDK CPI.
 *
 * Stored at a different seed prefix than regular commits — a single
 * authority can use both modes for different memos without collision.
 */
export async function buildCommitProofWithBetaIx(
  program: Program,
  rpc: Rpc,
  input: CommitProofInput & { beta: Uint8Array },
): Promise<{ ix: TransactionInstruction; commitAddress: PublicKey }> {
  if (input.proof.length !== 80) {
    throw new Error("proof must be 80 bytes (RFC 9381 Ed25519 ECVRF proof)");
  }
  if (input.beta.length !== 64) {
    throw new Error("beta must be 64 bytes (SHA-512 output of vrfProofToHash)");
  }

  const auth = await fetchAuthority(program, rpc, input.owner, input.label);
  if (!auth) throw new Error("authority not found");
  if (auth.decoded.revoked) throw new Error("authority is revoked");

  const mh = memoHashFn(input.memo);
  const commitAddress = deriveProofCommitWithBetaAddress(
    auth.authorityAddress,
    mh,
    program.programId,
  );

  const ctx = await buildCommitProofContext(
    rpc,
    program.programId,
    auth.account,
    commitAddress,
  );

  // Split beta into two 32-byte halves to match the on-chain field layout.
  const betaLo = input.beta.slice(0, 32);
  const betaHi = input.beta.slice(32, 64);

  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .commitProofWithBeta(
      ctx.proof,
      ctx.authorityReadOnlyMeta,
      auth.decoded,
      ctx.packedAddressTreeInfo,
      ctx.outputStateTreeIndex,
      Array.from(mh),
      Array.from(proofHashFn(input.proof)),
      Array.from(alphaHashFn(input.alpha)),
      Array.from(betaLo),
      Array.from(betaHi),
    )
    .accounts({ owner: input.owner } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();

  return { ix, commitAddress };
}

/**
 * Fetch a VrfProofCommitWithBeta by (authority, memo). Returns null if no such
 * commit exists yet. Reassembles the 64-byte beta from its two on-chain halves.
 */
export async function fetchProofCommitWithBeta(
  program: Program,
  rpc: Rpc,
  authority: PublicKey,
  memo: string | Uint8Array,
): Promise<{
  commitAddress: PublicKey;
  account: CompressedAccountWithMerkleContext;
  decoded: ReturnType<typeof decodeProofCommitWithBeta>;
  onChainCommit: OnChainCommit;
  /** Full 64-byte beta, reassembled from beta_lo + beta_hi. */
  beta: Uint8Array;
} | null> {
  const mh = memoHashFn(memo);
  const commitAddress = deriveProofCommitWithBetaAddress(
    authority,
    mh,
    program.programId,
  );
  const account = await rpc.getCompressedAccount(bn(commitAddress.toBytes()));
  if (!account) return null;
  const decoded = decodeProofCommitWithBeta(
    program,
    Uint8Array.from(account.data!.data),
  );
  const beta = new Uint8Array(64);
  beta.set(Uint8Array.from(decoded.betaLo), 0);
  beta.set(Uint8Array.from(decoded.betaHi), 32);
  return {
    commitAddress,
    account,
    decoded,
    beta,
    onChainCommit: {
      memoHash: Uint8Array.from(decoded.memoHash),
      proofHash: Uint8Array.from(decoded.proofHash),
      alphaHash: Uint8Array.from(decoded.alphaHash),
      committedSlot: BigInt(decoded.committedSlot.toString()),
    },
  };
}

/** Convenience: wrap a single ix into a Transaction. */
export function asTx(ix: TransactionInstruction): Transaction {
  return new Transaction().add(ix);
}
