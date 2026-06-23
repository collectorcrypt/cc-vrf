export const CC_VRF_PROGRAM_ID = "ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ";

export const GITHUB_URL = "https://github.com/collectorcrypt/cc-vrf";

export const NPM_ECVRF_URL =
  "https://www.npmjs.com/package/@collectorcrypt/ecvrf";

export const NPM_VRF_CLIENT_URL =
  "https://www.npmjs.com/package/@collectorcrypt/vrf-client";

export interface ReferenceLink {
  title: string;
  href: string;
  note: string;
}

export interface ReferenceGroup {
  heading: string;
  links: ReferenceLink[];
}

/**
 * External reading on the cryptography cc-vrf is built on. Grouped by the
 * standards we implement, the academic background, and the audited libraries
 * we depend on.
 */
export const REFERENCES: ReferenceGroup[] = [
  {
    heading: "Standards we implement",
    links: [
      {
        title: "RFC 9381 — Verifiable Random Functions (VRFs)",
        href: "https://www.rfc-editor.org/rfc/rfc9381.html",
        note: "The IRTF CFRG standard cc-vrf implements end-to-end. §5.5 defines the ECVRF-EDWARDS25519-SHA512-TAI ciphersuite (suite 0x03) we use.",
      },
      {
        title: "RFC 8032 — Edwards-Curve Digital Signature Algorithm (EdDSA)",
        href: "https://www.rfc-editor.org/rfc/rfc8032.html",
        note: "Defines Ed25519 and the edwards25519 key/scalar derivation (§5.1.5) the VRF prover reuses.",
      },
      {
        title: "RFC 7748 — Elliptic Curves for Security",
        href: "https://www.rfc-editor.org/rfc/rfc7748.html",
        note: "Specifies Curve25519 / edwards25519 — the elliptic curve underneath the whole scheme.",
      },
    ],
  },
  {
    heading: "Background",
    links: [
      {
        title: "Verifiable Random Functions — Micali, Rabin & Vadhan (FOCS 1999)",
        href: "https://people.seas.harvard.edu/~salil/research/VRF-abs.html",
        note: "The original paper that introduced the VRF primitive.",
      },
      {
        title: "Verifiable random function — Wikipedia",
        href: "https://en.wikipedia.org/wiki/Verifiable_random_function",
        note: "A plain-English overview of what a VRF is and where they're used.",
      },
    ],
  },
  {
    heading: "Audited libraries we build on",
    links: [
      {
        title: "@noble/ed25519",
        href: "https://github.com/paulmillr/noble-ed25519",
        note: "The audited, dependency-free Ed25519 implementation our curve math runs on.",
      },
      {
        title: "@noble/hashes",
        href: "https://github.com/paulmillr/noble-hashes",
        note: "Audited SHA-512 / SHA-256 used for hashing, challenges, and commitments.",
      },
    ],
  },
];

export type Cluster = "devnet" | "mainnet";

/**
 * Per-cluster RPC overrides — one env var per cluster, named for the cluster
 * it serves so there's no ambiguity about which is which:
 *
 *   VITE_CC_VRF_MAINNET_RPC_URL → used when cluster = mainnet
 *   VITE_CC_VRF_DEVNET_RPC_URL  → used when cluster = devnet (+ wallet demo)
 *
 * Both must be Photon-capable (Helius/Triton) — the Lookup/Verify pages read
 * compressed PDAs, and the public-RPC fallbacks below will NOT serve those
 * reads. When a cluster's var is unset, it falls back to its public default.
 */
export const DEFAULT_DEVNET_RPC_URL =
  "https://adjacent-ninette-fast-devnet.helius-rpc.com/";

export const DEFAULT_MAINNET_RPC_URL = "https://api.mainnet-beta.solana.com/";

export const VITE_DEVNET_RPC_URL =
  (import.meta.env.VITE_CC_VRF_DEVNET_RPC_URL as string | undefined) ||
  DEFAULT_DEVNET_RPC_URL;

export const VITE_MAINNET_RPC_URL =
  (import.meta.env.VITE_CC_VRF_MAINNET_RPC_URL as string | undefined) ||
  DEFAULT_MAINNET_RPC_URL;

/** Generic connection endpoint. The wallet demo runs on devnet. */
export const VITE_RPC_URL = VITE_DEVNET_RPC_URL;

export function defaultRpcForCluster(cluster: Cluster): string {
  return cluster === "mainnet" ? VITE_MAINNET_RPC_URL : VITE_DEVNET_RPC_URL;
}

export function explorerAddressUrlFor(addr: string, cluster: Cluster): string {
  const suffix = cluster === "mainnet" ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/address/${addr}${suffix}`;
}

export function explorerTxUrlFor(sig: string, cluster: Cluster): string {
  const suffix = cluster === "mainnet" ? "" : "?cluster=devnet";
  return `https://explorer.solana.com/tx/${sig}${suffix}`;
}
