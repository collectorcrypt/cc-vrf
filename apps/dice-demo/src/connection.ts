import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair } from "@solana/web3.js";
import { createRpc, Rpc } from "@lightprotocol/stateless.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Resolve a Solana payer keypair from:
 *   1. CC_VRF_PAYER_KEYPAIR env var pointing to a JSON file path
 *   2. ANCHOR_WALLET env var
 *   3. ~/.config/solana/id.json (Solana CLI default)
 */
export function loadPayer(): Keypair {
  const candidates = [
    process.env.CC_VRF_PAYER_KEYPAIR,
    process.env.ANCHOR_WALLET,
    path.join(os.homedir(), ".config", "solana", "id.json"),
  ].filter(Boolean) as string[];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      const data = JSON.parse(fs.readFileSync(p, "utf8")) as number[];
      return Keypair.fromSecretKey(Uint8Array.from(data));
    }
  }
  throw new Error(
    "no payer keypair found; set CC_VRF_PAYER_KEYPAIR or run `solana-keygen new`",
  );
}

/**
 * Resolve the Solana cluster RPC URL.
 *
 * Defaults to devnet via Helius (Photon-compatible). Override via env:
 *   CC_VRF_RPC_URL (used for both Solana RPC and Photon RPC, since Helius
 *   serves both)
 *   CC_VRF_PHOTON_URL (used only for the Light Photon RPC if you need a
 *   separate endpoint)
 */
export function resolveRpcUrls(): { rpc: string; photon: string } {
  const rpc = process.env.CC_VRF_RPC_URL || "https://api.devnet.solana.com";
  const photon = process.env.CC_VRF_PHOTON_URL || rpc;
  return { rpc, photon };
}

export function buildLightRpc(): Rpc {
  const { rpc, photon } = resolveRpcUrls();
  return createRpc(rpc, photon);
}

export function buildAnchorProvider(payer: Keypair): anchor.AnchorProvider {
  const { rpc } = resolveRpcUrls();
  const connection = new Connection(rpc, "confirmed");
  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return provider;
}
