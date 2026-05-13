/**
 * Per-call USD pricing for on-chain VRF providers.
 *
 * Numbers gathered 2026-05-12; SOL ~$95, ETH ~$2,300, ETH gas ~1-2 gwei.
 * Sources are in `notes`/`sourceUrl`. Highly-variable rows (Chainlink L1)
 * use a typical-conditions estimate and flag the gas dependency.
 */
export type Chain = "solana" | "ethereum" | "arbitrum" | "base" | "evm-l2";

export interface Provider {
  name: string;
  shortName: string;
  chain: Chain;
  costPerCallUsd: number | null;
  /** One-sentence explanation of where the cost comes from. */
  breakdown: string;
  sourceUrl: string;
  /** Highlighted in primary chart color when true. */
  isCcVrf?: boolean;
  /** Excluded from the bar chart but shown in notes (e.g. Pyth on Solana). */
  excludeFromChart?: boolean;
  notes?: string;
}

export const PROVIDERS: Provider[] = [
  {
    name: "cc-vrf (batched)",
    shortName: "cc-vrf (batched)",
    chain: "solana",
    costPerCallUsd: 0.0002,
    breakdown:
      "Amortized compressed PDA + tx fee across a batch of requests.",
    sourceUrl: "https://github.com/collectorcrypt/cc-vrf",
    isCcVrf: true,
    notes: "Per-call cost when commits are batched into one tx.",
  },
  {
    name: "cc-vrf (standalone)",
    shortName: "cc-vrf",
    chain: "solana",
    costPerCallUsd: 0.004,
    breakdown:
      "Light Protocol compressed PDA mint (~$0.00001) + Solana base tx fee.",
    sourceUrl: "https://github.com/collectorcrypt/cc-vrf",
    isCcVrf: true,
    notes: "Per-call cost for a single-commit transaction.",
  },
  {
    name: "ORAO VRF",
    shortName: "ORAO",
    chain: "solana",
    costPerCallUsd: 0.095,
    breakdown:
      "Flat 0.001 SOL request fee paid to the ORAO network, plus a small one-time account-rent cost.",
    sourceUrl: "https://orao.network/solana-vrf",
    notes: "SOL-price-sensitive. Steady fee since mainnet launch.",
  },
  {
    name: "Switchboard On-Demand VRF",
    shortName: "Switchboard",
    chain: "solana",
    costPerCallUsd: 0.19,
    breakdown:
      "~0.002 SOL per request paid to the oracle network (announced fee point; v3 uses an escrow-funded oracle reward in the same ballpark).",
    sourceUrl:
      "https://switchboardxyz.medium.com/verifiable-randomness-on-solana-46f72a46d9cf",
    notes:
      "SOL-price-sensitive. v3 'Randomness On-Demand' uses SGX-attested oracles.",
  },
  {
    name: "Pyth Entropy (Solana)",
    shortName: "Pyth Entropy",
    chain: "solana",
    costPerCallUsd: null,
    breakdown:
      "Not deployed on Solana mainnet as of May 2026 — EVM-only product.",
    sourceUrl: "https://docs.pyth.network/entropy",
    excludeFromChart: true,
    notes:
      "Confirmed via Pyth docs: provider addresses are listed for EVM chains only.",
  },
  {
    name: "Pyth Entropy (typical EVM L2)",
    shortName: "Pyth Entropy (L2)",
    chain: "evm-l2",
    costPerCallUsd: 0.05,
    breakdown:
      "Protocol fee floor of $0.01 (Pyth governance, Q2 2026) + provider fee covering reveal-tx gas on the L2.",
    sourceUrl:
      "https://forum.pyth.network/t/passed-op-pip-112-pyth-entropy-fees-q2/2504",
    notes:
      "Cross-chain context only. Highly chain-dependent — call entropy.getFeeV2() for an exact quote.",
  },
  {
    name: "Chainlink VRF v2.5 (Arbitrum)",
    shortName: "Chainlink VRF (Arbitrum)",
    chain: "arbitrum",
    costPerCallUsd: 0.15,
    breakdown:
      "L2 verification + callback gas + L1 calldata buffer, plus 50% LINK / 60% native premium.",
    sourceUrl:
      "https://docs.chain.link/vrf/v2-5/arbitrum-cost-estimation",
    notes: "Cross-chain context. Typically $0.05–$0.50 depending on L1 gas.",
  },
  {
    name: "Chainlink VRF v2.5 (Ethereum L1)",
    shortName: "Chainlink VRF (L1)",
    chain: "ethereum",
    costPerCallUsd: 2.0,
    breakdown:
      "~300k gas (verification + callback) × current ETH gas + 20% LINK premium.",
    sourceUrl: "https://docs.chain.link/vrf/v2-5/supported-networks",
    notes:
      "Highly gas-sensitive. ~$1–3 at the current ~1–2 gwei; jumps to $15–80 during gas spikes.",
  },
];

/** Chart-friendly subset, in ascending cost order. */
export const CHART_PROVIDERS = PROVIDERS.filter(
  (p) => !p.excludeFromChart && p.costPerCallUsd != null,
).sort((a, b) => (a.costPerCallUsd! - b.costPerCallUsd!));

export const PRICING_AS_OF = "2026-05-12";
export const REFERENCE_PRICES = {
  sol: 95,
  eth: 2_300,
};
