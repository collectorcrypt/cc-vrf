# cc-vrf website

Marketing + demo site for [cc-vrf](https://github.com/collectorcrypt/cc-vrf).
Vite + React + Tailwind 4, deployable to Vercel as a static SPA.

## Local development

```bash
# from repo root
pnpm install
pnpm --filter @collectorcrypt/ecvrf build
pnpm --filter @collectorcrypt/vrf-client build

# then
cd apps/website
cp .env.example .env.local   # fill in the mainnet/devnet RPC URLs
pnpm dev
```

## Deploying to Vercel

The site is a static SPA. Vercel auto-detects Vite from `vercel.json`.

1. Push the repo to GitHub.
2. Import the project in Vercel. Set the project root to `apps/website`.
3. Set one env var per cluster, both Helius/Triton (must serve Light Photon;
   the public Solana RPCs do NOT):
   - `VITE_CC_VRF_MAINNET_RPC_URL` → your mainnet RPC URL
   - `VITE_CC_VRF_DEVNET_RPC_URL` → your devnet RPC URL
4. Build command and output are configured in `vercel.json` already.

## What's where

- `src/sections/Hero.tsx` — landing
- `src/sections/HowItWorks.tsx` — 4-step explanation
- `src/sections/ClientDemo.tsx` — pure-client ECVRF demo
- `src/sections/WalletDemo.tsx` — wallet-signed devnet demo
- `src/sections/ServerSidePattern.tsx` — server-side operator pattern + drand callout
- `src/sections/CostComparison.tsx` — interactive cost chart (Recharts)
- `src/sections/GetStarted.tsx` — install + quickstart
- `src/data/providers.ts` — VRF provider pricing data (edit here to update the chart)

## Updating pricing

Edit `src/data/providers.ts`. Keep `PRICING_AS_OF` accurate.
