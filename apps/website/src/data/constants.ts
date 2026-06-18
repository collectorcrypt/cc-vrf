export const CC_VRF_PROGRAM_ID = "ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ";

export const GITHUB_URL = "https://github.com/collectorcrypt/cc-vrf";

export type Cluster = "devnet" | "mainnet";

/**
 * Default RPCs: public Helius endpoints that serve both Solana RPC and Light
 * Photon. Override via VITE_CC_VRF_RPC_URL (devnet) or
 * VITE_CC_VRF_MAINNET_RPC_URL at build time to point at your own infra.
 */
export const DEFAULT_DEVNET_RPC_URL =
  "https://adjacent-ninette-fast-devnet.helius-rpc.com/";

export const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com/";

export const VITE_RPC_URL =
  (import.meta.env.VITE_CC_VRF_RPC_URL as string | undefined) ||
  DEFAULT_DEVNET_RPC_URL;

export const VITE_MAINNET_RPC_URL =
  (import.meta.env.VITE_CC_VRF_MAINNET_RPC_URL as string | undefined) ||
  DEFAULT_MAINNET_RPC_URL;

export function defaultRpcForCluster(cluster: Cluster): string {
  return cluster === "mainnet" ? VITE_MAINNET_RPC_URL : VITE_RPC_URL;
}

export function explorerAddressUrlFor(addr: string, cluster: Cluster): string {
  const suffix = cluster === "mainnet" ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/address/${addr}${suffix}`;
}

export function explorerTxUrlFor(sig: string, cluster: Cluster): string {
  const suffix = cluster === "mainnet" ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/tx/${sig}${suffix}`;
}
