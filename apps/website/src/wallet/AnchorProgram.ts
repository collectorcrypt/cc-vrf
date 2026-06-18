import * as anchor from "@coral-xyz/anchor";
import {
  ComputeBudgetProgram,
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AnchorWallet } from "@solana/wallet-adapter-react";
import { getProgram } from "@collector-crypt/vrf-client";

/**
 * Build an Anchor Program instance pinned to the connected wallet. The
 * wallet adapter's AnchorWallet shape matches what AnchorProvider expects.
 */
export function buildProgramFromWallet(
  connection: Connection,
  wallet: AnchorWallet,
) {
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return { program: getProgram(provider), provider };
}

/**
 * Send an instruction via the connected wallet, using a *finalized*
 * blockhash so that the wallet's own RPC (which often lags our Helius
 * fast-devnet endpoint by a few slots) can still validate the tx during
 * its preflight simulation. Without this, Phantom commonly rejects with
 * "Blockhash is invalid or can not be validated".
 */
export async function sendIxViaWallet(
  connection: Connection,
  wallet: AnchorWallet,
  ix: TransactionInstruction,
  opts: { computeUnits?: number } = {},
): Promise<string> {
  const tx = new Transaction()
    .add(
      ComputeBudgetProgram.setComputeUnitLimit({
        units: opts.computeUnits ?? 600_000,
      }),
    )
    .add(ix);
  tx.feePayer = wallet.publicKey;

  // Finalized blockhash: at least ~32 slots old. Slow-to-propagate RPCs
  // will already see it, so the wallet's preflight won't fail.
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash("finalized");
  tx.recentBlockhash = blockhash;

  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), {
    skipPreflight: false,
    preflightCommitment: "confirmed",
  });
  await connection.confirmTransaction(
    { signature: sig, blockhash, lastValidBlockHeight },
    "confirmed",
  );
  return sig;
}

export function isLikelyHeliusOrEquivalent(rpcUrl: string): boolean {
  // The public devnet RPC at api.devnet.solana.com does NOT serve Light
  // Photon, so the SDK's `rpc.getValidityProofV0` will fail. Anything else
  // (Helius, Triton, local light-test-validator, etc.) is assumed to be
  // Photon-capable until proven otherwise — we surface a warning instead
  // of hard-blocking so users with their own infra can still try the demo.
  const u = rpcUrl.toLowerCase();
  if (u.includes("api.devnet.solana.com")) return false;
  if (u.includes("api.mainnet-beta.solana.com")) return false;
  if (u.includes("api.testnet.solana.com")) return false;
  return true;
}

export function explorerTxUrl(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
}

export function explorerAddressUrl(addr: string | PublicKey): string {
  const s = typeof addr === "string" ? addr : addr.toBase58();
  return `https://explorer.solana.com/address/${s}?cluster=devnet`;
}
