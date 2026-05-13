import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
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

/** Convenience: wrap a single ix into a Transaction. */
export function asTx(ix: TransactionInstruction): Transaction {
  return new Transaction().add(ix);
}
