import {
  ComputeBudgetProgram,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  TransactionInstruction,
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
  buildCommitProofIx,
  buildCommitProofEventIx,
  buildCommitProofWithBetaIx,
  buildCommitBatchEventIx,
  buildCommitBatchRingIx,
  buildInitRootRingIx,
  buildAttestPossessionIxs,
  batchLeafV1,
  buildBatch,
  fetchAuthority,
  fetchProofCommit,
  fetchProofCommitWithBeta,
  fetchPossession,
  fetchRootRing,
  findBatchCommits,
  findProofCommitEvents,
  getProgram,
  pickCanonicalCommit,
  rootRingEntry,
  verifyAuthorityCommitEndToEnd,
  verifyBatchCommitEndToEnd,
  encodeLabel,
} from "@collectorcrypt/vrf-client";

import { buildAnchorProvider, buildLightRpc, loadPayer } from "./connection";
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

export async function cmdRoll(memo?: string): Promise<void> {
  const state = loadState();
  if (!state.vrfSk || !state.vrfPk) throw new Error("run `init` first");
  const sk = hexToBytes(state.vrfSk);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const memoStr =
    memo || `dice-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alpha = sha256(new TextEncoder().encode(memoStr));
  const { proof } = proveVRF(sk, alpha);
  const beta = vrfProofToHash(proof);
  const rollValue =
    Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1; // 1..100

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

  const commit = await fetchProofCommit(
    program,
    rpc,
    auth.authorityAddress,
    targetMemo,
  );
  if (!commit) throw new Error("commit not found on chain");

  const result = verifyAuthorityCommitEndToEnd({
    authority: auth.onChainAuthority,
    expectedOwner: payer.publicKey,
    expectedLabel: encodeLabel(state.label),
    expectedAuthorityAddress: auth.authorityAddress,
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

/**
 * Roll once in EVENT MODE — emits a VrfProofCommitted log instead of
 * creating a compressed PDA. ~5x cheaper. The roll is recorded with
 * `mode: "event"` so verify can route correctly.
 */
/**
 * Roll once in PDA+BETA mode — like cmdRoll but stores the 64-byte ECVRF
 * beta on chain so other Solana programs can read it via Light SDK CPI.
 * Slightly more expensive than plain PDA mode (larger leaf), but enables
 * on-chain consumption of the random value.
 */
export async function cmdRollWithBeta(memo?: string): Promise<void> {
  const state = loadState();
  if (!state.vrfSk || !state.vrfPk) throw new Error("run `init` first");
  const sk = hexToBytes(state.vrfSk);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const memoStr =
    memo || `dice-beta-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alpha = sha256(new TextEncoder().encode(memoStr));
  const { proof } = proveVRF(sk, alpha);
  const beta = vrfProofToHash(proof);
  const rollValue =
    Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1;

  const { ix, commitAddress } = await buildCommitProofWithBetaIx(program, rpc, {
    owner: payer.publicKey,
    label: state.label,
    memo: memoStr,
    alpha,
    proof,
    beta,
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
    mode: "pda-beta",
    txSignature: sig,
  });
  saveState(state);

  console.log("rolled (pda+beta)", rollValue, "/100");
  console.log("  memo:        ", memoStr);
  console.log("  pk:          ", state.vrfPk);
  console.log("  commit addr: ", commitAddress.toBase58());
  console.log("  beta on-chain: yes (64 bytes)");
  console.log("  tx sig:      ", sig);
}

export async function cmdVerifyWithBeta(memo?: string): Promise<void> {
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

  const commit = await fetchProofCommitWithBeta(
    program,
    rpc,
    auth.authorityAddress,
    targetMemo,
  );
  if (!commit) throw new Error("commit-with-beta not found on chain");

  const result = verifyAuthorityCommitEndToEnd({
    authority: auth.onChainAuthority,
    expectedOwner: payer.publicKey,
    expectedLabel: encodeLabel(state.label),
    expectedAuthorityAddress: auth.authorityAddress,
    alpha: hexToBytes(stored.alpha),
    proof: hexToBytes(stored.proof),
    memo: targetMemo,
    onChainCommit: commit.onChainCommit,
    onChainBeta: commit.beta,
  });

  console.log("verify (pda+beta)", targetMemo);
  console.log("  ecvrf-valid:    ", result.ecvrfValid);
  console.log("  proof-matches:  ", result.proofHashMatches);
  console.log("  alpha-matches:  ", result.alphaHashMatches);
  console.log("  memo-matches:   ", result.memoHashMatches);
  console.log("  beta-matches:   ", result.betaMatches);
  console.log("  VALID:          ", result.valid);
  if (!result.valid) console.log("  reasons:", result.reasons);
  if (result.betaMatches === false)
    console.log("  on-chain beta does NOT match vrfProofToHash(proof)");
  console.log(
    "  on-chain beta:  ",
    bytesToHex(commit.beta).slice(0, 32) + "...",
  );
}

export async function cmdRollEvent(memo?: string): Promise<void> {
  const state = loadState();
  if (!state.vrfSk || !state.vrfPk) throw new Error("run `init` first");
  const sk = hexToBytes(state.vrfSk);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const memoStr =
    memo || `dice-evt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const alpha = sha256(new TextEncoder().encode(memoStr));
  const { proof } = proveVRF(sk, alpha);
  const beta = vrfProofToHash(proof);
  const rollValue =
    Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1;

  const ix = await buildCommitProofEventIx(program, rpc, {
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
    commitAddressBase58: "(event-mode — no PDA address)",
    committedAtIso: new Date().toISOString(),
    mode: "event",
    txSignature: sig,
  });
  saveState(state);

  console.log("rolled (event)", rollValue, "/100");
  console.log("  memo:        ", memoStr);
  console.log("  pk:          ", state.vrfPk);
  console.log("  tx sig:      ", sig);
}

export async function cmdVerifyEvent(memo?: string): Promise<void> {
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

  // The stored signature avoids scanning the owner's whole wallet history.
  const { events, truncated, unfetchedSignatures } =
    await findProofCommitEvents(
      program,
      provider.connection,
      payer.publicKey,
      state.label,
      targetMemo,
      stored.txSignature ? { signature: stored.txSignature } : {},
    );
  if (events.length === 0) {
    throw new Error(
      truncated || unfetchedSignatures.length > 0
        ? "no events found, but the lookup was incomplete (scan limit or unfetchable transactions)"
        : "no events found on chain for this memo",
    );
  }

  const picked = pickCanonicalCommit(
    events.map((e) => e.onChainCommit),
    hexToBytes(stored.proof),
  );

  console.log("verify (event)", targetMemo);
  console.log("  events found:   ", events.length);
  if (picked.duplicateMemoEvents) {
    console.log(
      "  duplicate-memo events present — selecting canonical via ECVRF math",
    );
  }
  if (!picked.canonical) {
    console.log(
      "  no canonical commit matches the local proof — verification fails",
    );
    process.exit(1);
  }

  const result = verifyAuthorityCommitEndToEnd({
    authority: auth.onChainAuthority,
    expectedOwner: payer.publicKey,
    expectedLabel: encodeLabel(state.label),
    expectedAuthorityAddress: auth.authorityAddress,
    alpha: hexToBytes(stored.alpha),
    proof: hexToBytes(stored.proof),
    memo: targetMemo,
    onChainCommit: picked.canonical,
  });

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

function rollValueOf(beta: Uint8Array): number {
  return Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1; // 1..100
}

/** Proves `n` rolls and their batch spec v1 leaves. */
function proveRolls(sk: Uint8Array, prefix: string, n: number) {
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return Array.from({ length: n }, (_, i) => {
    const memo = `${prefix}-${stamp}-${i}`;
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(sk, alpha);
    const beta = vrfProofToHash(proof);
    return {
      memo,
      alpha,
      proof,
      beta,
      leaf: batchLeafV1({ memo, alpha, proof, beta }),
    };
  });
}

/**
 * Rolls `n` dice and commits all of them as ONE Merkle root: commit_batch_event, or commit_batch_ring when `ring`
 * (which also records the root in the authority's root ring; run `init-ring` first).
 */
export async function cmdRollBatch(n: number, ring: boolean): Promise<void> {
  if (!Number.isInteger(n) || n < 1 || n > 4096)
    throw new Error("batch size must be 1..4096");
  const state = loadState();
  if (!state.vrfSk || !state.vrfPk) throw new Error("run `init` first");
  const sk = hexToBytes(state.vrfSk);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const rolls = proveRolls(sk, ring ? "dice-ring" : "dice-batch", n);
  const batch = buildBatch(rolls.map((r) => r.leaf));
  const input = {
    owner: payer.publicKey,
    label: state.label,
    root: batch.root,
    count: batch.count,
  };
  let ix: TransactionInstruction;
  let ringSeq: bigint | undefined;
  if (ring) {
    ({ ix, seq: ringSeq } = await buildCommitBatchRingIx(program, rpc, input));
  } else {
    ix = await buildCommitBatchEventIx(program, rpc, input);
  }
  const sig = await provider.sendAndConfirm(
    withComputeBudget(new Transaction().add(ix)),
    [],
  );

  const committedAtIso = new Date().toISOString();
  rolls.forEach((r, i) =>
    state.rolls.push({
      memo: r.memo,
      alpha: bytesToHex(r.alpha),
      proof: bytesToHex(r.proof),
      beta: bytesToHex(r.beta),
      rollValue: rollValueOf(r.beta),
      commitAddressBase58: "(batch mode — no PDA address)",
      committedAtIso,
      mode: ring ? "ring" : "batch",
      txSignature: sig,
      batchIndex: i,
      batchPath: batch.path(i).map(bytesToHex),
      ringSeq: ringSeq?.toString(),
    }),
  );
  saveState(state);

  console.log(`rolled ${n} dice in one ${ring ? "ring" : "batch"} commit`);
  console.log(
    "  values:      ",
    rolls.map((r) => rollValueOf(r.beta)).join(" "),
  );
  console.log("  root:        ", bytesToHex(batch.root));
  if (ringSeq !== undefined) console.log("  ring seq:    ", ringSeq.toString());
  console.log("  last memo:   ", rolls[n - 1].memo);
  console.log("  tx sig:      ", sig);
}

/** Verifies one batch or ring roll: root and count from the chain, proof + path from local state. */
export async function cmdVerifyBatch(memo?: string): Promise<void> {
  const state = loadState();
  const stored = memo
    ? state.rolls.find((r) => r.memo === memo)
    : [...state.rolls]
        .reverse()
        .find((r) => r.mode === "batch" || r.mode === "ring");
  if (!stored) throw new Error("no batch roll found in local roll history");
  if (
    stored.batchIndex === undefined ||
    !stored.batchPath ||
    !stored.txSignature
  ) {
    throw new Error(`memo ${stored.memo} is not a batch roll`);
  }

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const { commits, unfetched } = await findBatchCommits(
    program,
    provider.connection,
    stored.txSignature,
  );
  if (unfetched)
    throw new Error(`RPC returned no transaction for ${stored.txSignature}`);
  if (commits.length !== 1)
    throw new Error(`expected one batch commit, found ${commits.length}`);
  const batch = commits[0];
  const auth = await fetchAuthority(program, rpc, batch.owner, batch.label);
  if (!auth) throw new Error("authority not found on chain");

  const result = verifyBatchCommitEndToEnd({
    authority: auth.onChainAuthority,
    batch,
    memo: stored.memo,
    alpha: hexToBytes(stored.alpha),
    proof: hexToBytes(stored.proof),
    index: stored.batchIndex,
    path: stored.batchPath.map(hexToBytes),
    expectedOwner: payer.publicKey,
    expectedLabel: encodeLabel(state.label),
  });

  console.log(`verify (${stored.mode})`, stored.memo);
  console.log(
    "  batch:          ",
    `${batch.count} leaves, index ${stored.batchIndex}`,
  );
  console.log("  ecvrf-valid:    ", result.ecvrfValid);
  console.log("  leaf-in-batch:  ", result.leafInBatch);
  console.log("  VALID:          ", result.valid);
  if (!result.valid) console.log("  reasons:", result.reasons);
  if (result.notes.length > 0) console.log("  notes:", result.notes);
  console.log(
    "  beta first 8B: ",
    result.beta ? bytesToHex(result.beta).slice(0, 16) : "(invalid)",
  );
  if (batch.ringSeq !== null) {
    const ring = await fetchRootRing(
      provider.connection,
      auth.authorityAddress,
    );
    const entry = ring ? rootRingEntry(ring.data, batch.ringSeq) : null;
    const matches =
      entry !== null &&
      bytesToHex(entry.root) === bytesToHex(batch.root) &&
      entry.count === batch.count;
    console.log(
      "  ring entry:     ",
      entry === null
        ? `seq ${batch.ringSeq} evicted (128 newer commits) or missing`
        : matches
          ? `seq ${batch.ringSeq} live, matches`
          : `seq ${batch.ringSeq} live, DOES NOT MATCH the commit`,
    );
  }
}

/** Creates the authority's root ring (7,352-byte account, rent ~0.038 SOL), needed before `roll-ring`. */
export async function cmdInitRing(): Promise<void> {
  const state = loadState();
  if (!state.vrfSk) throw new Error("run `init` first");

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const { ix, ringAddress } = await buildInitRootRingIx(program, rpc, {
    owner: payer.publicKey,
    label: state.label,
  });
  const sig = await provider.sendAndConfirm(
    withComputeBudget(new Transaction().add(ix)),
    [],
  );
  console.log("root ring created at:", ringAddress.toBase58());
  console.log("  signature:", sig);
}

/** attest_possession: the VRF key signs the 114-byte possession message; the program records it in a PDA. */
export async function cmdAttest(): Promise<void> {
  const state = loadState();
  if (!state.vrfSk) throw new Error("run `init` first");

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);

  const { ixs, attestationAddress } = await buildAttestPossessionIxs(
    program,
    rpc,
    {
      owner: payer.publicKey,
      label: state.label,
      vrfSecretKey: hexToBytes(state.vrfSk),
    },
  );
  const sig = await provider.sendAndConfirm(
    withComputeBudget(new Transaction().add(...ixs)),
    [],
  );
  const auth = await fetchAuthority(program, rpc, payer.publicKey, state.label);
  const recorded = auth
    ? await fetchPossession(provider.connection, auth.authorityAddress)
    : null;
  console.log("possession attested at:", attestationAddress.toBase58());
  console.log(
    "  recorded pk:",
    recorded ? bytesToHex(recorded.pk) : "(not found yet)",
  );
  console.log("  signature:", sig);
}

export async function cmdSimulateEvent(n: number): Promise<void> {
  if (!Number.isFinite(n) || n < 1)
    throw new Error("simulate count must be >= 1");
  let passed = 0;
  let failed = 0;
  for (let i = 0; i < n; i++) {
    const memo = `sim-evt-${Date.now()}-${i}`;
    try {
      await cmdRollEvent(memo);
      await cmdVerifyEvent(memo);
      passed++;
    } catch (err) {
      failed++;
      console.error(`  iteration ${i} failed:`, err);
    }
  }
  console.log("");
  console.log(`simulated ${n} (event mode): passed=${passed} failed=${failed}`);
  if (failed > 0) process.exit(1);
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

/**
 * Measure actual SOL spent committing N rolls in each mode (PDA, PDA+beta,
 * event, batch) on the configured cluster. Reports per-call cost, total cost,
 * and an extrapolation to 100k calls. Batch mode commits the N rolls as
 * ceil(N / batchSize) Merkle roots.
 *
 * Reads the wallet's pre/post lamport balance to capture true tx fees +
 * priority fees + light tree slot costs, no estimation. Intended as a small
 * sample (default N=100) before any large-scale run.
 *
 * Requires init_authority to have already been run for the demo's label.
 *
 * Usage: cc-vrf-demo cost [N] [--sol-usd=160] [--batch-size=100]
 */
export async function cmdCost(
  n: number,
  solUsd: number,
  batchSize: number,
): Promise<void> {
  if (!Number.isFinite(n) || n < 1) throw new Error("cost count must be >= 1");
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 4096)
    throw new Error("--batch-size must be 1..4096");
  if (!Number.isFinite(solUsd) || solUsd <= 0)
    throw new Error("--sol-usd must be > 0");

  const state = loadState();
  if (!state.vrfSk || !state.vrfPk) throw new Error("run `init` first");
  const sk = hexToBytes(state.vrfSk);

  const payer = loadPayer();
  const provider = buildAnchorProvider(payer);
  const rpc = buildLightRpc();
  const program = getProgram(provider);
  const connection = provider.connection;

  const startBal = await connection.getBalance(payer.publicKey);
  console.log("cost-measure config:");
  console.log("  rolls per mode:    ", n);
  console.log("  payer:             ", payer.publicKey.toBase58());
  console.log(
    "  start balance:     ",
    (startBal / LAMPORTS_PER_SOL).toFixed(9),
    "SOL",
  );
  console.log("  SOL/USD reference: ", solUsd);
  console.log("");

  // --- PDA mode ---
  console.log(`[1/4] running ${n} PDA-mode rolls...`);
  const pdaStart = await connection.getBalance(payer.publicKey);
  const t0Pda = Date.now();
  let pdaOk = 0;
  let pdaFail = 0;
  for (let i = 0; i < n; i++) {
    const memo = `cost-pda-${Date.now()}-${i}`;
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(sk, alpha);
    try {
      const { ix } = await buildCommitProofIx(program, rpc, {
        owner: payer.publicKey,
        label: state.label,
        memo,
        alpha,
        proof,
      });
      await provider.sendAndConfirm(
        withComputeBudget(new Transaction().add(ix)),
        [],
      );
      pdaOk++;
    } catch (err) {
      pdaFail++;
      console.error(
        `  pda iter ${i} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const pdaEnd = await connection.getBalance(payer.publicKey);
  const pdaDurationMs = Date.now() - t0Pda;
  const pdaSpentLamports = pdaStart - pdaEnd;

  // --- PDA+Beta mode ---
  console.log(`[2/4] running ${n} PDA+beta-mode rolls...`);
  const betaStart = await connection.getBalance(payer.publicKey);
  const t0Beta = Date.now();
  let betaOk = 0;
  let betaFail = 0;
  for (let i = 0; i < n; i++) {
    const memo = `cost-beta-${Date.now()}-${i}`;
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(sk, alpha);
    const beta = vrfProofToHash(proof);
    try {
      const { ix } = await buildCommitProofWithBetaIx(program, rpc, {
        owner: payer.publicKey,
        label: state.label,
        memo,
        alpha,
        proof,
        beta,
      });
      await provider.sendAndConfirm(
        withComputeBudget(new Transaction().add(ix)),
        [],
      );
      betaOk++;
    } catch (err) {
      betaFail++;
      console.error(
        `  beta iter ${i} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const betaEnd = await connection.getBalance(payer.publicKey);
  const betaDurationMs = Date.now() - t0Beta;
  const betaSpentLamports = betaStart - betaEnd;

  // --- Event mode ---
  console.log(`[3/4] running ${n} event-mode rolls...`);
  const eventStart = await connection.getBalance(payer.publicKey);
  const t0Evt = Date.now();
  let evtOk = 0;
  let evtFail = 0;
  for (let i = 0; i < n; i++) {
    const memo = `cost-evt-${Date.now()}-${i}`;
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(sk, alpha);
    try {
      const ix = await buildCommitProofEventIx(program, rpc, {
        owner: payer.publicKey,
        label: state.label,
        memo,
        alpha,
        proof,
      });
      await provider.sendAndConfirm(
        withComputeBudget(new Transaction().add(ix)),
        [],
      );
      evtOk++;
    } catch (err) {
      evtFail++;
      console.error(
        `  evt iter ${i} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const eventEnd = await connection.getBalance(payer.publicKey);
  const eventDurationMs = Date.now() - t0Evt;
  const eventSpentLamports = eventStart - eventEnd;

  // --- Batch mode ---
  const batches = Math.ceil(n / batchSize);
  console.log(
    `[4/4] running ${n} batch-mode rolls as ${batches} commit(s) of up to ${batchSize}...`,
  );
  const batchStart = await connection.getBalance(payer.publicKey);
  const t0Batch = Date.now();
  let batchOk = 0;
  let batchFail = 0;
  let batchTxOk = 0;
  for (let done = 0; done < n; done += batchSize) {
    const size = Math.min(batchSize, n - done);
    const rolls = proveRolls(sk, "cost-batch", size);
    try {
      const ix = await buildCommitBatchEventIx(program, rpc, {
        owner: payer.publicKey,
        label: state.label,
        root: buildBatch(rolls.map((r) => r.leaf)).root,
        count: size,
      });
      await provider.sendAndConfirm(
        withComputeBudget(new Transaction().add(ix)),
        [],
      );
      batchOk += size;
      batchTxOk++;
    } catch (err) {
      batchFail += size;
      console.error(
        `  batch at roll ${done} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
  const batchEnd = await connection.getBalance(payer.publicKey);
  const batchDurationMs = Date.now() - t0Batch;
  const batchSpentLamports = batchStart - batchEnd;

  // --- Report ---
  const pdaSol = pdaSpentLamports / LAMPORTS_PER_SOL;
  const betaSol = betaSpentLamports / LAMPORTS_PER_SOL;
  const evtSol = eventSpentLamports / LAMPORTS_PER_SOL;
  const pdaPerCallSol = pdaOk > 0 ? pdaSol / pdaOk : 0;
  const betaPerCallSol = betaOk > 0 ? betaSol / betaOk : 0;
  const evtPerCallSol = evtOk > 0 ? evtSol / evtOk : 0;
  const pdaPerCallUsd = pdaPerCallSol * solUsd;
  const betaPerCallUsd = betaPerCallSol * solUsd;
  const evtPerCallUsd = evtPerCallSol * solUsd;
  const batchSol = batchSpentLamports / LAMPORTS_PER_SOL;
  const batchPerCallSol = batchOk > 0 ? batchSol / batchOk : 0;
  const batchPerCallUsd = batchPerCallSol * solUsd;
  const batchPerTxSol = batchTxOk > 0 ? batchSol / batchTxOk : 0;

  console.log("");
  console.log("===== cost results =====");
  console.log("");
  console.log("PDA mode (commit_proof):");
  console.log(`  rolls:               ${pdaOk} ok / ${pdaFail} fail`);
  console.log(
    `  total spent:         ${pdaSol.toFixed(9)} SOL  ($${(pdaSol * solUsd).toFixed(4)})`,
  );
  console.log(
    `  per-call:            ${pdaPerCallSol.toFixed(9)} SOL  ($${pdaPerCallUsd.toFixed(6)})`,
  );
  console.log(
    `  extrapolated 100k:   ${(pdaPerCallSol * 100_000).toFixed(4)} SOL  ($${(pdaPerCallUsd * 100_000).toFixed(2)})`,
  );
  console.log(
    `  wall time:           ${(pdaDurationMs / 1000).toFixed(1)}s (${pdaOk > 0 ? (pdaDurationMs / pdaOk).toFixed(0) : "—"}ms/call)`,
  );
  console.log("");
  console.log("PDA+beta mode (commit_proof_with_beta):");
  console.log(`  rolls:               ${betaOk} ok / ${betaFail} fail`);
  console.log(
    `  total spent:         ${betaSol.toFixed(9)} SOL  ($${(betaSol * solUsd).toFixed(4)})`,
  );
  console.log(
    `  per-call:            ${betaPerCallSol.toFixed(9)} SOL  ($${betaPerCallUsd.toFixed(6)})`,
  );
  console.log(
    `  extrapolated 100k:   ${(betaPerCallSol * 100_000).toFixed(4)} SOL  ($${(betaPerCallUsd * 100_000).toFixed(2)})`,
  );
  console.log(
    `  wall time:           ${(betaDurationMs / 1000).toFixed(1)}s (${betaOk > 0 ? (betaDurationMs / betaOk).toFixed(0) : "—"}ms/call)`,
  );
  console.log("");
  console.log("Event mode (commit_proof_event):");
  console.log(`  rolls:               ${evtOk} ok / ${evtFail} fail`);
  console.log(
    `  total spent:         ${evtSol.toFixed(9)} SOL  ($${(evtSol * solUsd).toFixed(4)})`,
  );
  console.log(
    `  per-call:            ${evtPerCallSol.toFixed(9)} SOL  ($${evtPerCallUsd.toFixed(6)})`,
  );
  console.log(
    `  extrapolated 100k:   ${(evtPerCallSol * 100_000).toFixed(4)} SOL  ($${(evtPerCallUsd * 100_000).toFixed(2)})`,
  );
  console.log(
    `  wall time:           ${(eventDurationMs / 1000).toFixed(1)}s (${evtOk > 0 ? (eventDurationMs / evtOk).toFixed(0) : "—"}ms/call)`,
  );
  console.log("");
  console.log(`Batch mode (commit_batch_event, up to ${batchSize} per root):`);
  console.log(
    `  rolls:               ${batchOk} ok / ${batchFail} fail (${batchTxOk} commit tx)`,
  );
  console.log(
    `  total spent:         ${batchSol.toFixed(9)} SOL  ($${(batchSol * solUsd).toFixed(4)})`,
  );
  console.log(
    `  per commit tx:       ${batchPerTxSol.toFixed(9)} SOL  ($${(batchPerTxSol * solUsd).toFixed(6)})`,
  );
  console.log(
    `  per-call:            ${batchPerCallSol.toFixed(9)} SOL  ($${batchPerCallUsd.toFixed(6)})`,
  );
  console.log(
    `  extrapolated 100k:   ${(batchPerCallSol * 100_000).toFixed(4)} SOL  ($${(batchPerCallUsd * 100_000).toFixed(2)})`,
  );
  console.log(`  wall time:           ${(batchDurationMs / 1000).toFixed(1)}s`);
  console.log("");
  if (pdaPerCallSol > 0 && evtPerCallSol > 0) {
    console.log(
      `Event mode is ${(pdaPerCallSol / evtPerCallSol).toFixed(2)}x cheaper than plain PDA per call.`,
    );
  }
  if (pdaPerCallSol > 0 && betaPerCallSol > 0) {
    console.log(
      `PDA+beta vs PDA: ${(betaPerCallSol / pdaPerCallSol).toFixed(2)}x cost (beta adds 64 bytes per leaf).`,
    );
  }
  console.log("");
  console.log(
    "NOTE: prices include base tx fee, priority fees, and Light Protocol",
  );
  console.log(
    "tree slot costs. Real production cost depends on the priority-fee",
  );
  console.log("market at execution time and may differ.");

  if (pdaFail > 0 || betaFail > 0 || evtFail > 0 || batchFail > 0)
    process.exit(1);
}

export function cmdStatus(): void {
  const state = loadState();
  console.log(
    "state file:",
    require.resolve("./state").replace("dist/", "src/"),
  );
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
