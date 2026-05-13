import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  AnchorWallet,
} from "@solana/wallet-adapter-react";
import { getProgram } from "@collectorcrypt/vrf-client";

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
