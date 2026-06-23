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
import { verifyVRF, vrfProofToHash } from "@collectorcrypt/ecvrf";

import {
  alphaHash as alphaHashFn,
  deriveAuthorityAddress,
  deriveProofCommitAddress,
  deriveProofCommitWithBetaAddress,
  encodeLabel,
  memoHash as memoHashFn,
  proofHash as proofHashFn,
} from "./addresses";
import { SUITE_EDWARDS25519_SHA512_TAI } from "./constants";
import {
  buildCommitProofContext,
  buildCreateContext,
  buildMutateContext,
  buildReadOnlyAuthorityContext,
  forceLightV2,
} from "./light";
import { OnChainAuthority, OnChainCommit } from "./verifyEndToEnd";

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
  onChainAuthority: OnChainAuthority;
} | null> {
  forceLightV2();
  const labelBytes = typeof label === "string" ? encodeLabel(label) : label;
  const authorityAddress = deriveAuthorityAddress(
    owner,
    labelBytes,
    program.programId,
  );
  const account = await rpc.getCompressedAccount(
    bn(authorityAddress.toBytes()),
  );
  if (!account) return null;
  const decoded = decodeAuthority(program, Uint8Array.from(account.data!.data));
  return {
    authorityAddress,
    account,
    decoded,
    onChainAuthority: {
      authorityAddress,
      owner: decoded.owner,
      pk: Uint8Array.from(decoded.pk),
      suite: decoded.suite,
      frozen: decoded.frozen,
      revoked: decoded.revoked,
      label: Uint8Array.from(decoded.label),
    },
  };
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
  const decoded = decodeProofCommit(
    program,
    Uint8Array.from(account.data!.data),
  );
  return {
    commitAddress,
    account,
    decoded,
    onChainCommit: {
      authority: decoded.authority,
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
  if (input.suite !== SUITE_EDWARDS25519_SHA512_TAI) {
    throw new Error(
      "only ECVRF-EDWARDS25519-SHA512-TAI suite 0x03 is supported",
    );
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

  const ctx = await buildCreateContext(
    rpc,
    program.programId,
    authorityAddress,
  );

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

type FetchedAuthority = NonNullable<Awaited<ReturnType<typeof fetchAuthority>>>;

function assertAuthorityCanCommit(
  auth: FetchedAuthority | null,
): asserts auth is FetchedAuthority {
  if (!auth) throw new Error("authority not found");
  if (auth.decoded.suite !== SUITE_EDWARDS25519_SHA512_TAI) {
    throw new Error("authority suite is not supported");
  }
  if (!auth.decoded.frozen) throw new Error("authority is not frozen");
  if (auth.decoded.revoked) throw new Error("authority is revoked");
}

function assertProofMatchesAuthority(
  auth: FetchedAuthority,
  input: CommitProofInput,
) {
  const pk = Uint8Array.from(auth.decoded.pk);
  if (!verifyVRF(pk, input.alpha, input.proof)) {
    throw new Error("proof does not verify against authority pk and alpha");
  }
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
  assertAuthorityCanCommit(auth);
  assertProofMatchesAuthority(auth, input);

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
 * Build the commit_proof_event instruction (event mode). Proves the authority
 * read-only, requires it to be frozen and unrevoked, and emits a Solana log
 * event rather than writing a compressed PDA.
 *
 * The trade-off is that the chain doesn't enforce one-commit-per-memo;
 * verifiers must scan for duplicate `memo_hash` events and pick the one where
 * ECVRF math passes.
 */
export async function buildCommitProofEventIx(
  program: Program,
  rpc: Rpc,
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
  const auth = await fetchAuthority(program, rpc, input.owner, labelBytes);
  assertAuthorityCanCommit(auth);
  assertProofMatchesAuthority(auth, input);

  const ctx = await buildReadOnlyAuthorityContext(
    rpc,
    program.programId,
    auth.account,
  );
  const mh = memoHashFn(input.memo);

  const ix = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .commitProofEvent(
      ctx.proof,
      ctx.authorityReadOnlyMeta,
      auth.decoded,
      Array.from(labelBytes),
      Array.from(mh),
      Array.from(proofHashFn(input.proof)),
      Array.from(alphaHashFn(input.alpha)),
    )
    .accounts({ owner: input.owner } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();

  return ix;
}

/**
 * One row decoded from a `VrfProofCommitted` log event. `txSignature` is the
 * Solana tx the event was emitted in; `slot` is the slot that tx confirmed in.
 *
 * `onChainCommit` is the same shape the verifier helpers expect, so the same
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
 * Options for {@link findProofCommitEvents} and {@link fetchProofCommitEvents}.
 */
export interface ProofCommitEventQuery {
  /**
   * Look up exactly this transaction signature instead of scanning the owner's
   * wallet history. This is the ROBUST path: a committer already knows the
   * signature it submitted, so it sidesteps the history-scan failure mode
   * entirely (see {@link ProofCommitEventResult.truncated}). When set, `limit`
   * is ignored.
   */
  signature?: string;
  /**
   * Max number of recent signatures to scan when walking the owner's wallet
   * history (default 1000). Only used when `signature` is not provided.
   *
   * NOTE: this counts ALL of the owner's transactions, not just VRF commits —
   * on a busy mainnet wallet the target commit can fall outside the window, in
   * which case the result is flagged `truncated` rather than silently returning
   * an empty list.
   */
  limit?: number;
}

/**
 * Result of {@link findProofCommitEvents}. Unlike a bare event array, this lets
 * a caller distinguish "this memo was never committed" from "I could not
 * confirm it within the scanned window / some transactions were unfetchable".
 */
export interface ProofCommitEventResult {
  /** Matching events, ordered oldest → newest. */
  events: ProofCommitEvent[];
  /**
   * True if the wallet-history scan hit `limit` before reaching the end of the
   * owner's history. When true, an empty or short `events` list is NOT
   * conclusive — the commit may simply be older than the scanned window.
   * Re-query with a larger `limit`, or (preferably) pass the known `signature`.
   * Always false when `signature` was provided.
   */
  truncated: boolean;
  /**
   * Signatures whose transaction could not be fetched (RPC retention gap or
   * throttling — `getTransaction` returned null or threw). A genuine event may
   * be hiding in one of these, so an empty `events` list is likewise
   * inconclusive when this is non-empty.
   */
  unfetchedSignatures: string[];
}

/**
 * Find `VrfProofCommitted` events for a `(owner, label, memo)` tuple, returning
 * a structured result that surfaces scan completeness.
 *
 * Two modes:
 *   - Pass `query.signature` to fetch ONE known transaction directly. This is
 *     the recommended path for any caller that submitted the commit (it already
 *     has the signature) and is immune to the history-scan limit below.
 *   - Otherwise the owner's wallet history is paginated (newest → oldest) up to
 *     `query.limit` signatures (default 1000). Because this counts every
 *     transaction the owner signed — not just VRF commits — a busy mainnet
 *     wallet can push the target commit past the window; that case is reported
 *     via `truncated: true` instead of an indistinguishable empty array.
 *
 * IMPORTANT: this can return MORE than one event. The on-chain program does not
 * enforce uniqueness in event mode. A safe verifier:
 *
 *   1. Collects all matches for the requested memo.
 *   2. Runs `verifyAuthorityCommitEndToEnd` against each candidate proof.
 *   3. Accepts the unique row where the ECVRF math passes.
 *
 * Because ECVRF proofs are deterministic for a fixed (pk, alpha), at most one
 * candidate can have a valid `proof_hash`. The presence of extra events is
 * detectable noise, not a successful forgery — but a naive verifier that picks
 * "the latest event" without running ECVRF can be misled (see
 * `pickCanonicalCommit`).
 *
 * `connection` and `programId` are passed in explicitly so log scanning works
 * against a plain Solana RPC. Fetching compressed authority state still needs a
 * Photon-capable RPC unless the verifier already has that state.
 */
export async function findProofCommitEvents(
  program: Program,
  connection: Connection,
  owner: PublicKey,
  label: string | Uint8Array,
  memo: string | Uint8Array,
  query: ProofCommitEventQuery = {},
): Promise<ProofCommitEventResult> {
  const labelBytes = typeof label === "string" ? encodeLabel(label) : label;
  const targetMemoHash = memoHashFn(memo);

  const parser = new EventParser(
    program.programId,
    new BorshCoder(program.idl),
  );
  const out: ProofCommitEvent[] = [];
  const unfetchedSignatures: string[] = [];

  // Fetch a single tx, treating RPC failure (retention gap / throttling returns
  // null or throws) as a recoverable miss rather than crashing the scan.
  const tryGetTx = async (signature: string) => {
    try {
      return await connection.getTransaction(signature, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
    } catch {
      return null;
    }
  };

  // Extract any matching VrfProofCommitted events from one fetched tx.
  const collectFromTx = (
    signature: string,
    tx: Awaited<ReturnType<typeof tryGetTx>>,
  ) => {
    if (!tx?.meta?.logMessages) return;
    for (const ev of parser.parseLogs(tx.meta.logMessages, false)) {
      if (ev.name !== "VrfProofCommitted" && ev.name !== "vrfProofCommitted")
        continue;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data = ev.data as any;
      const eventOwner: PublicKey = data.owner;
      const eventLabel: Uint8Array = Uint8Array.from(data.label);
      const eventMemoHash: Uint8Array = Uint8Array.from(data.memoHash);

      if (!eventOwner.equals(owner)) continue;
      if (!bytesEqual(eventLabel, labelBytes)) continue;
      if (!bytesEqual(eventMemoHash, targetMemoHash)) continue;

      const authority = deriveAuthorityAddress(
        eventOwner,
        eventLabel,
        program.programId,
      );
      out.push({
        owner: eventOwner,
        label: eventLabel,
        txSignature: signature,
        slot: tx.slot,
        onChainCommit: {
          authority,
          memoHash: eventMemoHash,
          proofHash: Uint8Array.from(data.proofHash),
          alphaHash: Uint8Array.from(data.alphaHash),
          committedSlot: BigInt(data.committedSlot.toString()),
        },
      });
    }
  };

  // Direct-by-signature mode: robust, no history scan, never truncated.
  if (query.signature) {
    const tx = await tryGetTx(query.signature);
    if (!tx) unfetchedSignatures.push(query.signature);
    else collectFromTx(query.signature, tx);
    out.reverse();
    return { events: out, truncated: false, unfetchedSignatures };
  }

  // History-scan mode.
  const limit = query.limit ?? 1000;
  let before: string | undefined;
  let scanned = 0;
  let reachedEnd = false;
  while (scanned < limit) {
    const pageLimit = Math.min(1000, limit - scanned);
    const sigInfos = await connection.getSignaturesForAddress(owner, {
      limit: pageLimit,
      before,
    });
    if (sigInfos.length === 0) {
      reachedEnd = true;
      break;
    }
    scanned += sigInfos.length;
    before = sigInfos[sigInfos.length - 1].signature;

    for (const sigInfo of sigInfos) {
      if (sigInfo.err) continue;
      const tx = await tryGetTx(sigInfo.signature);
      if (!tx) {
        unfetchedSignatures.push(sigInfo.signature);
        continue;
      }
      collectFromTx(sigInfo.signature, tx);
    }
  }

  // RPC returns newest first — reverse so oldest comes first.
  out.reverse();
  // If we exited because the cap was hit (not because history ran out), the
  // result is incomplete: a missing event here is inconclusive, not "absent".
  return { events: out, truncated: !reachedEnd, unfetchedSignatures };
}

/**
 * Backward-compatible wrapper around {@link findProofCommitEvents} that returns
 * just the events (oldest → newest).
 *
 * Prefer {@link findProofCommitEvents} when you need to tell "not committed"
 * apart from "scan was truncated / some transactions were unfetchable" — on a
 * busy mainnet wallet a bare empty array is ambiguous. Pass `options.signature`
 * to look up a known commit directly and skip the history scan entirely.
 */
export async function fetchProofCommitEvents(
  program: Program,
  connection: Connection,
  owner: PublicKey,
  label: string | Uint8Array,
  memo: string | Uint8Array,
  options: ProofCommitEventQuery = {},
): Promise<ProofCommitEvent[]> {
  const { events } = await findProofCommitEvents(
    program,
    connection,
    owner,
    label,
    memo,
    options,
  );
  return events;
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
 * Stored at the same seed prefix as regular commits, so one authority+memo can
 * only use one registry mode.
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
  assertAuthorityCanCommit(auth);
  assertProofMatchesAuthority(auth, input);
  if (!bytesEqual(input.beta, vrfProofToHash(input.proof))) {
    throw new Error("beta does not match vrfProofToHash(proof)");
  }

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
      authority: decoded.authority,
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
