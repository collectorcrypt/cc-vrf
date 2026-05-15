import { beforeAll, describe, expect, it } from "vitest";
import { Connection, Keypair, Transaction, LAMPORTS_PER_SOL, ComputeBudgetProgram } from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { createRpc } from "@lightprotocol/stateless.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  generateKeyPair,
  proveVRF,
  vrfProofToHash,
  SUITE_EDWARDS25519_SHA512_TAI,
  buildInitAuthorityIx,
  buildFreezeAuthorityIx,
  buildCommitProofIx,
  buildCommitProofEventIx,
  buildCommitProofWithBetaIx,
  fetchAuthority,
  fetchProofCommit,
  fetchProofCommitWithBeta,
  fetchProofCommitEvents,
  getProgram,
  pickCanonicalCommit,
  verifyEndToEnd,
} from "@collectorcrypt/vrf-client";

/**
 * Live smoke test. Skipped by default. Run with:
 *
 *   CC_VRF_SMOKE=1 \
 *   CC_VRF_RPC_URL=https://devnet.helius-rpc.com/?api-key=... \
 *   CC_VRF_SMOKE_PAYER=/path/to/funded-devnet-id.json \
 *   pnpm --filter @collectorcrypt/dice-demo test
 *
 * Exercises the full lifecycle on a live cluster:
 *   1. init_authority for a fresh label
 *   2. commit_proof for one VRF call
 *   3. fetch + verifyEndToEnd
 *   4. freeze_authority
 */
const SMOKE = process.env.CC_VRF_SMOKE === "1";
const describeMaybe = SMOKE ? describe : describe.skip;

describeMaybe("cc-vrf live smoke test (devnet)", () => {
  let payer: Keypair;
  let provider: anchor.AnchorProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let program: anchor.Program<any>;
  let rpc: ReturnType<typeof createRpc>;
  const label = `smoke-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  let vrfSk: Uint8Array;
  let vrfPk: Uint8Array;

  beforeAll(async () => {
    const fs = await import("fs");
    const keypairPath = process.env.CC_VRF_SMOKE_PAYER;
    if (!keypairPath) throw new Error("CC_VRF_SMOKE_PAYER not set");
    payer = Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf8"))),
    );

    const rpcUrl = process.env.CC_VRF_RPC_URL || "https://api.devnet.solana.com";
    const photonUrl = process.env.CC_VRF_PHOTON_URL || rpcUrl;
    rpc = createRpc(rpcUrl, photonUrl);

    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(payer);
    provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    program = getProgram(provider);

    const bal = await connection.getBalance(payer.publicKey);
    console.log(`payer ${payer.publicKey.toBase58()} balance: ${bal / LAMPORTS_PER_SOL} SOL`);
    if (bal < 0.05 * LAMPORTS_PER_SOL) {
      throw new Error("payer balance < 0.05 SOL; fund the keypair first");
    }

    const kp = generateKeyPair();
    vrfSk = kp.sk;
    vrfPk = kp.pk;
  }, 120_000);

  it("init_authority creates a VrfAuthority on chain", { timeout: 120_000 }, async () => {
    const { ix, authorityAddress } = await buildInitAuthorityIx(program, rpc, {
      owner: payer.publicKey,
      pk: vrfPk,
      suite: SUITE_EDWARDS25519_SHA512_TAI,
      label,
    });
    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
      .add(ix);
    const sig = await provider.sendAndConfirm(tx, []);
    console.log("init tx:", sig);

    const fetched = await fetchAuthority(program, rpc, payer.publicKey, label);
    expect(fetched).not.toBeNull();
    expect(bytesToHex(Uint8Array.from(fetched!.decoded.pk))).toBe(
      bytesToHex(vrfPk),
    );
    expect(fetched!.decoded.frozen).toBe(false);
    expect(fetched!.decoded.revoked).toBe(false);
    expect(fetched!.authorityAddress.toBase58()).toBe(
      authorityAddress.toBase58(),
    );
  });

  it("commit_proof posts a verifiable randomness call", { timeout: 120_000 }, async () => {
    const memo = `${label}-roll-1`;
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(vrfSk, alpha);
    const beta = vrfProofToHash(proof);

    const { ix, commitAddress } = await buildCommitProofIx(program, rpc, {
      owner: payer.publicKey,
      label,
      memo,
      alpha,
      proof,
    });
    const sig = await provider.sendAndConfirm(
      new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
        .add(ix),
      [],
    );
    console.log("commit tx:", sig);

    const auth = (await fetchAuthority(program, rpc, payer.publicKey, label))!;
    const commit = await fetchProofCommit(
      program,
      rpc,
      auth.authorityAddress,
      memo,
    );
    expect(commit).not.toBeNull();
    expect(commit!.commitAddress.toBase58()).toBe(commitAddress.toBase58());

    const result = verifyEndToEnd({
      pk: vrfPk,
      alpha,
      proof,
      memo,
      onChainCommit: commit!.onChainCommit,
    });
    expect(result.valid).toBe(true);
    expect(bytesToHex(result.beta!)).toBe(bytesToHex(beta));
  });

  it("commit_proof_with_beta stores beta on chain alongside the commit (pda+beta mode)", { timeout: 180_000 }, async () => {
    const memo = `${label}-beta-1`;
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(vrfSk, alpha);
    const beta = vrfProofToHash(proof);

    const { ix, commitAddress } = await buildCommitProofWithBetaIx(program, rpc, {
      owner: payer.publicKey,
      label,
      memo,
      alpha,
      proof,
      beta,
    });
    const sig = await provider.sendAndConfirm(
      new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
        .add(ix),
      [],
    );
    console.log("commit-with-beta tx:", sig);

    const auth = (await fetchAuthority(program, rpc, payer.publicKey, label))!;
    const commit = await fetchProofCommitWithBeta(
      program,
      rpc,
      auth.authorityAddress,
      memo,
    );
    expect(commit).not.toBeNull();
    expect(commit!.commitAddress.toBase58()).toBe(commitAddress.toBase58());
    expect(bytesToHex(commit!.beta)).toBe(bytesToHex(beta));

    const result = verifyEndToEnd({
      pk: vrfPk,
      alpha,
      proof,
      memo,
      onChainCommit: commit!.onChainCommit,
    });
    expect(result.valid).toBe(true);
    expect(bytesToHex(result.beta!)).toBe(bytesToHex(beta));
  });

  it("commit_proof_event emits a verifiable randomness call (event mode)", { timeout: 180_000 }, async () => {
    const memo = `${label}-event-1`;
    const alpha = sha256(new TextEncoder().encode(memo));
    const { proof } = proveVRF(vrfSk, alpha);
    const beta = vrfProofToHash(proof);

    const ix = await buildCommitProofEventIx(program, {
      owner: payer.publicKey,
      label,
      memo,
      alpha,
      proof,
    });
    const sig = await provider.sendAndConfirm(
      new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }))
        .add(ix),
      [],
    );
    console.log("commit-event tx:", sig);

    const events = await fetchProofCommitEvents(
      program,
      provider.connection,
      payer.publicKey,
      label,
      memo,
    );
    expect(events.length).toBeGreaterThan(0);

    const picked = pickCanonicalCommit(
      events.map((e) => e.onChainCommit),
      proof,
    );
    expect(picked.canonical).not.toBeNull();

    const result = verifyEndToEnd({
      pk: vrfPk,
      alpha,
      proof,
      memo,
      onChainCommit: picked.canonical!,
    });
    expect(result.valid).toBe(true);
    expect(bytesToHex(result.beta!)).toBe(bytesToHex(beta));
  });

  it("freeze_authority sets frozen=true and rejects subsequent freezes", { timeout: 120_000 }, async () => {
    const ix = await buildFreezeAuthorityIx(program, rpc, {
      owner: payer.publicKey,
      label,
    });
    const sig = await provider.sendAndConfirm(
      new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
        .add(ix),
      [],
    );
    console.log("freeze tx:", sig);

    const fetched = await fetchAuthority(program, rpc, payer.publicKey, label);
    expect(fetched!.decoded.frozen).toBe(true);

    let threw = false;
    try {
      const ix2 = await buildFreezeAuthorityIx(program, rpc, {
        owner: payer.publicKey,
        label,
      });
      await provider.sendAndConfirm(
        new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
          .add(ix2),
        [],
      );
    } catch {
      threw = true;
    }
    expect(threw, "expected double-freeze to be rejected").toBe(true);
  });
});
