import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { createRpc, Rpc } from "@lightprotocol/stateless.js";
import { getProgram } from "@collector-crypt/vrf-client";

/**
 * Read-only flows (fetchAuthority, fetchProofCommit) need an AnchorProvider
 * with *some* wallet for type-correctness, but they never sign anything. We
 * construct a minimal wallet object inline because `anchor.Wallet` isn't
 * available in the browser bundle.
 */
export function buildReadOnlyProgram(rpcUrl: string): {
  program: ReturnType<typeof getProgram>;
  connection: Connection;
  rpc: Rpc;
} {
  const connection = new Connection(rpcUrl, "confirmed");
  const rpc = createRpc(rpcUrl, rpcUrl);
  const dummy = Keypair.generate();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wallet: any = {
    publicKey: dummy.publicKey as PublicKey,
    signTransaction: async () => {
      throw new Error("read-only wallet cannot sign");
    },
    signAllTransactions: async () => {
      throw new Error("read-only wallet cannot sign");
    },
  };
  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
    preflightCommitment: "confirmed",
  });
  return { program: getProgram(provider), connection, rpc };
}
