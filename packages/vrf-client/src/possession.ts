/**
 * Opt-in key-possession proof: the authority's VRF key Ed25519-signs exactly
 * `"ccvrf-authority-v1" ‖ program_id ‖ owner ‖ label` (114 bytes), and attest_possession records it in the PDA
 * `["vrf_pop", authority_address]`. Possession = that account exists.
 *
 * ECVRF and Ed25519 share the SHA-512(sk)[32..64] nonce prefix, so the VRF key must never sign a 32-byte message
 * (it could equal an ECVRF hash-to-curve input and leak the key). {@link signPossessionMessage} signs nothing else.
 */
import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  Connection,
  Ed25519Program,
  PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  TransactionInstruction,
} from "@solana/web3.js";
import { Rpc } from "@lightprotocol/stateless.js";

import { encodeLabel } from "./addresses";
import { CC_VRF_PROGRAM_ID } from "./constants";
import { buildReadOnlyAuthorityContext } from "./light";
import {
  assertAuthorityCanCommit,
  bytesEqual,
  fetchAuthority,
} from "./operations";

export const POSSESSION_DOMAIN = new TextEncoder().encode("ccvrf-authority-v1");
export const POSSESSION_MESSAGE_LEN = 114;
export const POSSESSION_SEED = new TextEncoder().encode("vrf_pop");
export const POSSESSION_DISCRIMINATOR = sha256(
  new TextEncoder().encode("account:VrfPossession"),
).slice(0, 8);

export function possessionMessage(
  owner: PublicKey,
  label: string | Uint8Array,
  programId: PublicKey = CC_VRF_PROGRAM_ID,
): Uint8Array {
  const labelBytes = typeof label === "string" ? encodeLabel(label) : label;
  if (labelBytes.length !== 32)
    throw new Error("label must encode to exactly 32 bytes");
  const m = new Uint8Array(POSSESSION_MESSAGE_LEN);
  m.set(POSSESSION_DOMAIN, 0);
  m.set(programId.toBytes(), 18);
  m.set(owner.toBytes(), 50);
  m.set(labelBytes, 82);
  return m;
}

/** Signs a possession message with the 32-byte VRF secret key. Refuses any other message, whatever its content. */
export async function signPossessionMessage(
  vrfSecretKey: Uint8Array,
  message: Uint8Array,
): Promise<Uint8Array> {
  if (vrfSecretKey.length !== 32)
    throw new Error("VRF secret key must be the 32-byte seed");
  if (
    message.length !== POSSESSION_MESSAGE_LEN ||
    !bytesEqual(message.slice(0, POSSESSION_DOMAIN.length), POSSESSION_DOMAIN)
  ) {
    throw new Error(
      "refusing to sign: the VRF key signs only the 114-byte possession message",
    );
  }
  return ed.signAsync(message, vrfSecretKey);
}

export function derivePossessionAddress(
  authorityAddress: PublicKey,
  programId: PublicKey = CC_VRF_PROGRAM_ID,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [POSSESSION_SEED, authorityAddress.toBytes()],
    programId,
  )[0];
}

/**
 * [Ed25519 precompile instruction, attest_possession]. Pass the VRF secret key, or a signature made elsewhere (an HSM)
 * over {@link possessionMessage}. The pair must stay in this order in one transaction, with no other Ed25519 instruction.
 */
export async function buildAttestPossessionIxs(
  program: Program,
  rpc: Rpc,
  input: {
    owner: PublicKey;
    label: string | Uint8Array;
    vrfSecretKey?: Uint8Array;
    signature?: Uint8Array;
  },
): Promise<{ ixs: TransactionInstruction[]; attestationAddress: PublicKey }> {
  const auth = await fetchAuthority(program, rpc, input.owner, input.label);
  assertAuthorityCanCommit(auth);
  const pk = Uint8Array.from(auth.decoded.pk);
  const message = possessionMessage(
    input.owner,
    auth.onChainAuthority.label,
    program.programId,
  );
  let signature = input.signature;
  if (!signature) {
    if (!input.vrfSecretKey) throw new Error("pass vrfSecretKey or signature");
    if (!bytesEqual(await ed.getPublicKeyAsync(input.vrfSecretKey), pk)) {
      throw new Error("VRF secret key does not match the authority's pk");
    }
    signature = await signPossessionMessage(input.vrfSecretKey, message);
  }
  const attestationAddress = derivePossessionAddress(
    auth.authorityAddress,
    program.programId,
  );
  const ctx = await buildReadOnlyAuthorityContext(
    rpc,
    program.programId,
    auth.account,
  );
  const attest = await program.methods
    // @ts-ignore: Anchor IDL types are dynamic at this layer
    .attestPossession(
      Array.from(auth.onChainAuthority.label),
      ctx.proof,
      ctx.authorityReadOnlyMeta,
      auth.decoded,
    )
    .accounts({
      owner: input.owner,
      attestation: attestationAddress,
      instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    } as never)
    .remainingAccounts(ctx.remainingAccountMetas)
    .instruction();
  const precompile = Ed25519Program.createInstructionWithPublicKey({
    publicKey: pk,
    message,
    signature,
  });
  return { ixs: [precompile, attest], attestationAddress };
}

/** The recorded attestation, or null (never attested). */
export async function fetchPossession(
  connection: Connection,
  authorityAddress: PublicKey,
  programId: PublicKey = CC_VRF_PROGRAM_ID,
): Promise<{
  address: PublicKey;
  authority: Uint8Array;
  pk: Uint8Array;
  slot: bigint;
} | null> {
  const address = derivePossessionAddress(authorityAddress, programId);
  const info = await connection.getAccountInfo(address, "confirmed");
  if (!info || !info.owner.equals(programId) || info.data.length !== 80)
    return null;
  const d = Uint8Array.from(info.data);
  if (!bytesEqual(d.slice(0, 8), POSSESSION_DISCRIMINATOR)) return null;
  return {
    address,
    authority: d.slice(8, 40),
    pk: d.slice(40, 72),
    slot: new DataView(d.buffer).getBigUint64(72, true),
  };
}
