import {
  ComputeBudgetProgram,
  PublicKey,
  Transaction,
} from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  generateKeyPair,
  hexToBytes,
  proveVRF,
  vrfProofToHash,
  CC_VRF_PROGRAM_ID,
  SUITE_EDWARDS25519_SHA512_TAI,
  buildInitAuthorityIx,
  buildFreezeAuthorityIx,
  buildRevokeAuthorityIx,
  buildCommitProofIx,
  fetchAuthority,
  fetchProofCommit,
  getProgram,
  verifyEndToEnd,
} from "@collectorcrypt/vrf-client";

import {
  buildAnchorProvider,
  buildLightRpc,
  loadPayer,
} from "./connection";
import { loadState, saveState } from "./state";

const COMPUTE_UNITS = 600_000;

function withComputeBudget(tx: Transaction): Transaction {
  tx.instructions.unshift(
    ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNITS }),
  );
  return tx;
}

export async function cmdInit(): Promise<void> {
  const state = loadState();
  if (state.vrfSk) {
    throw new Error(
      "VRF keypair already exists in state — delete ~/.cc-vrf-demo first if you want a fresh one",
    );
  }
  const { sk, pk } = generateKeyPair();
  state.vrfSk = bytesToHex(sk);
  state.vrfPk = bytesToHex(pk);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  console.log("generated VRF keypair");
  console.log("  pk:", state.vrfPk);
  console.log("  owner:", payer.publicKey.toBase58());
  console.log("  label:", state.label);

  const { ix, authorityAddress } = await buildInitAuthorityIx(program, rpc, {
    owner: payer.publicKey,
    pk,
    suite: SUITE_EDWARDS25519_SHA512_TAI,
    label: state.label,
  });

  const tx = withComputeBudget(new Transaction().add(ix));
  const sig = await provider.sendAndConfirm(tx, []);

  state.ownerPubkeyBase58 = payer.publicKey.toBase58();
  state.programIdBase58 = CC_VRF_PROGRAM_ID.toBase58();
  saveState(state);

  console.log("authority created at:", authorityAddress.toBase58());
  console.log("  signature:", sig);
}

export async function cmdFreeze(): Promise<void> {
  const state = loadState();
  if (!state.vrfSk) throw new Error("run `init` first");

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const ix = await buildFreezeAuthorityIx(program, rpc, {
    owner: payer.publicKey,
    label: state.label,
  });
  const sig = await provider.sendAndConfirm(
    withComputeBudget(new Transaction().add(ix)),
    [],
  );
  console.log("authority frozen.");
  console.log("  signature:", sig);
}

export async function cmdRevoke(): Promise<void> {
  const state = loadState();
  if (!state.vrfSk) throw new Error("run `init` first");

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const ix = await buildRevokeAuthorityIx(program, rpc, {
    owner: payer.publicKey,
    label: state.label,
  });
  const sig = await provider.sendAndConfirm(
    withComputeBudget(new Transaction().add(ix)),
    [],
  );
  console.log("authority revoked.");
  console.log("  signature:", sig);
}

export async function cmdRoll(memo?: string): Promise<void> {
  const state = loadState();
  if (!state.vrfSk || !state.vrfPk) throw new Error("run `init` first");
  const sk = hexToBytes(state.vrfSk);
  const pk = hexToBytes(state.vrfPk);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const memoStr =
    memo ||
    `dice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alpha = sha256(new TextEncoder().encode(memoStr));
  const { proof } = proveVRF(sk, alpha);
  const beta = vrfProofToHash(proof);
  const rollValue = Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1; // 1..100

  const { ix, commitAddress } = await buildCommitProofIx(program, rpc, {
    owner: payer.publicKey,
    label: state.label,
    memo: memoStr,
    alpha,
    proof,
  });
  const sig = await provider.sendAndConfirm(
    withComputeBudget(new Transaction().add(ix)),
    [],
  );

  state.rolls.push({
    memo: memoStr,
    alpha: bytesToHex(alpha),
    proof: bytesToHex(proof),
    beta: bytesToHex(beta),
    rollValue,
    commitAddressBase58: commitAddress.toBase58(),
    committedAtIso: new Date().toISOString(),
  });
  saveState(state);

  console.log("rolled", rollValue, "/100");
  console.log("  memo:        ", memoStr);
  console.log("  pk:          ", state.vrfPk);
  console.log("  commit addr: ", commitAddress.toBase58());
  console.log("  tx sig:      ", sig);
}

export async function cmdVerify(memo?: string): Promise<void> {
  const state = loadState();
  const targetMemo = memo || state.rolls[state.rolls.length - 1]?.memo;
  if (!targetMemo) throw new Error("no memo specified and no rolls in state");

  const stored = state.rolls.find((r) => r.memo === targetMemo);
  if (!stored)
    throw new Error(`memo ${targetMemo} not found in local roll history`);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const auth = await fetchAuthority(program, rpc, payer.publicKey, state.label);
  if (!auth) throw new Error("authority not found on chain");
  const pk = Uint8Array.from(auth.decoded.pk);

  const commit = await fetchProofCommit(
    program,
    rpc,
    auth.authorityAddress,
    targetMemo,
  );
  if (!commit) throw new Error("commit not found on chain");

  const result = verifyEndToEnd({
    pk,
    alpha: hexToBytes(stored.alpha),
    proof: hexToBytes(stored.proof),
    memo: targetMemo,
    onChainCommit: commit.onChainCommit,
  });

  console.log("verify", targetMemo);
  console.log("  ecvrf-valid:    ", result.ecvrfValid);
  console.log("  proof-matches:  ", result.proofHashMatches);
  console.log("  alpha-matches:  ", result.alphaHashMatches);
  console.log("  memo-matches:   ", result.memoHashMatches);
  console.log("  VALID:          ", result.valid);
  if (!result.valid) console.log("  reasons:", result.reasons);
  console.log(
    "  beta first 8B: ",
    result.beta ? bytesToHex(result.beta).slice(0, 16) : "(invalid)",
  );
}

export async function cmdSimulate(n: number): Promise<void> {
  if (!Number.isFinite(n) || n < 1)
    throw new Error("simulate count must be >= 1");
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const memo = `sim-${Date.now()}-${i}`;
    try {
      await cmdRoll(memo);
      await cmdVerify(memo);
      passed++;
    } catch (err) {
      failed++;
      console.error(`  iteration ${i} failed:`, err);
    }
  }
  console.log("");
  console.log(`simulated ${n}: passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
}

export function cmdStatus(): void {
  const state = loadState();
  console.log("state file:", require.resolve("./state").replace("dist/", "src/"));
  console.log("label:           ", state.label);
  console.log("vrf pk:          ", state.vrfPk || "(not initialized)");
  console.log("owner:           ", state.ownerPubkeyBase58 || "(none)");
  console.log("program:         ", state.programIdBase58 || "(none)");
  console.log("recorded rolls:  ", state.rolls.length);
  if (state.rolls.length > 0) {
    const last = state.rolls[state.rolls.length - 1];
    console.log("last roll:");
    console.log("  memo:        ", last.memo);
    console.log("  value:       ", last.rollValue);
    console.log("  commit addr: ", last.commitAddressBase58);
  }
}

// Re-export utility so callers can reuse it for the verifier path.
export { PublicKey };
