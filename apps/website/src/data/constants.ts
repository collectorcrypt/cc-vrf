export const CC_VRF_PROGRAM_ID = "5haPNg9hUP6EYXbUM8fWJr38VQQHj8X7ECnAkEctZe2c";

export const GITHUB_URL = "https://github.com/collectorcrypt/cc-vrf";

/**
 * Default RPC: a public Helius devnet endpoint that serves both Solana RPC
 * and Light Photon. Override via VITE_CC_VRF_RPC_URL at build time if you
 * want to point the demo at your own infra.
 */
export const DEFAULT_RPC_URL =
  "https://adjacent-ninette-fast-devnet.helius-rpc.com/";

export const VITE_RPC_URL =
  (import.meta.env.VITE_CC_VRF_RPC_URL as string | undefined) ||
  DEFAULT_RPC_URL;
