#!/usr/bin/env node
import {
  cmdFreeze,
  cmdInit,
  cmdRevoke,
  cmdRoll,
  cmdSimulate,
  cmdStatus,
  cmdVerify,
} from "./commands";

function usage(): never {
  console.log(`cc-vrf-demo — end-to-end demo for the cc-vrf on-chain VRF program

usage: cc-vrf-demo <command> [args]

commands:
  init                  generate a VRF keypair, init_authority on chain
  freeze                freeze the authority (lock pk permanently)
  revoke                revoke the authority (informational)
  roll [memo]           prove + commit one randomness call (1..100)
  verify [memo]         verify a previously-committed roll end-to-end
  simulate <N>          roll + verify N times back-to-back; expect N passes
  status                print local state

env:
  CC_VRF_RPC_URL        Solana cluster RPC (default: devnet)
  CC_VRF_PHOTON_URL     Light Photon RPC (default: same as RPC)
  CC_VRF_PAYER_KEYPAIR  path to a JSON keypair file
                        (fallback: ANCHOR_WALLET, then ~/.config/solana/id.json)
`);
  process.exit(1);
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
      case "revoke":
        await cmdRevoke();
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

main();
