#!/usr/bin/env node
import {
  cmdAttest,
  cmdCost,
  cmdFreeze,
  cmdInit,
  cmdInitRing,
  cmdRoll,
  cmdRollBatch,
  cmdRollEvent,
  cmdRollWithBeta,
  cmdSimulate,
  cmdSimulateEvent,
  cmdStatus,
  cmdVerify,
  cmdVerifyBatch,
  cmdVerifyEvent,
  cmdVerifyWithBeta,
} from "./commands";

function usage(): never {
  console.log(`cc-vrf-demo — end-to-end demo for the cc-vrf on-chain VRF program

usage: cc-vrf-demo <command> [args]

lifecycle:
  init                    generate a VRF keypair, init_authority on chain
  freeze                  freeze the authority (lock pk permanently)
  attest                  attest_possession: prove the VRF key signs for
                          this authority (opt-in, one-time)
  status                  print local state

pda mode (chain enforces 1-commit-per-memo):
  roll [memo]             commit_proof: write a compressed PDA per roll
  verify [memo]           fetch PDA + verifyAuthorityCommitEndToEnd
  simulate <N>            N back-to-back PDA roll+verify cycles

pda + beta mode (PDA mode + on-chain beta for cross-program reads):
  roll-with-beta [memo]   commit_proof_with_beta: stores 64-byte beta on chain
  verify-with-beta [memo] fetch PDA, verify, also check on-chain beta

event mode (cheapest state footprint, verifier-side replay handling):
  roll-event [memo]       commit_proof_event: emit a log event per roll
  verify-event [memo]     fetch events for the memo, pick canonical, verify
  simulate-event <N>      N back-to-back event roll+verify cycles

batch mode (one commit per Merkle root over many rolls):
  roll-batch [N]          commit_batch_event: N rolls, one root (default 8)
  verify-batch [memo]     root + count from the tx, proof + path from state
  init-ring               create the root ring (on-chain readable roots)
  roll-ring [N]           commit_batch_ring: like roll-batch, also writes
                          the root into the ring (default 8)

cost:
  cost [N] [--sol-usd=NN] [--batch-size=NN]
                          run N rolls in each mode, report real SOL spent +
                          extrapolation to 100k. Default N=100, SOL price =
                          160, batch size = 100.

env:
  CC_VRF_RPC_URL          Solana cluster RPC (default: devnet)
  CC_VRF_PHOTON_URL       Light Photon RPC (default: same as RPC)
  CC_VRF_PAYER_KEYPAIR    path to a JSON keypair file
                          (fallback: ANCHOR_WALLET, then ~/.config/solana/id.json)
`);
  process.exit(1);
}

function parseSolUsd(args: string[]): number {
  for (const a of args) {
    if (a.startsWith("--sol-usd=")) {
      const n = Number(a.slice("--sol-usd=".length));
      if (Number.isFinite(n) && n > 0) return n;
    }
  }
  return 160;
}

function parseBatchSize(args: string[]): number {
  const a = args.find((x) => x.startsWith("--batch-size="));
  return a ? Number(a.slice("--batch-size=".length)) : 100;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const cmd = args[0];
  if (!cmd) usage();

  try {
    switch (cmd) {
      case "init":
        await cmdInit();
        break;
      case "freeze":
        await cmdFreeze();
        break;
      case "attest":
        await cmdAttest();
        break;
      case "roll":
        await cmdRoll(args[1]);
        break;
      case "verify":
        await cmdVerify(args[1]);
        break;
      case "simulate":
        await cmdSimulate(Number(args[1]));
        break;
      case "roll-with-beta":
        await cmdRollWithBeta(args[1]);
        break;
      case "verify-with-beta":
        await cmdVerifyWithBeta(args[1]);
        break;
      case "roll-event":
        await cmdRollEvent(args[1]);
        break;
      case "verify-event":
        await cmdVerifyEvent(args[1]);
        break;
      case "simulate-event":
        await cmdSimulateEvent(Number(args[1]));
        break;
      case "roll-batch":
        await cmdRollBatch(args[1] ? Number(args[1]) : 8, false);
        break;
      case "roll-ring":
        await cmdRollBatch(args[1] ? Number(args[1]) : 8, true);
        break;
      case "verify-batch":
        await cmdVerifyBatch(args[1]);
        break;
      case "init-ring":
        await cmdInitRing();
        break;
      case "cost": {
        const positional = args.slice(1).filter((a) => !a.startsWith("--"));
        const n = positional[0] ? Number(positional[0]) : 100;
        const solUsd = parseSolUsd(args);
        await cmdCost(n, solUsd, parseBatchSize(args));
        break;
      }
      case "status":
        cmdStatus();
        break;
      default:
        usage();
    }
  } catch (err) {
    console.error("error:", err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

// Exit explicitly: the confirmation WebSocket web3.js opens keeps node alive after the command finishes.
main().then(() => process.exit(0));
