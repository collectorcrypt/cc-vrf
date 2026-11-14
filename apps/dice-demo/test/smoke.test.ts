import { beforeAll, describe, expect, it } from "vitest";
import {
  Connection,
  Ed25519Program,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  ComputeBudgetProgram,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { createRpc } from "@lightprotocol/stateless.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  bytesToHex,
  hexToBytes,
  generateKeyPair,
  proveVRF,
  vrfProofToHash,
  SUITE_EDWARDS25519_SHA512_TAI,
  batchLeafV1,
  buildAttestPossessionIxs,
  buildBatch,
  buildCommitBatchEventIx,
  buildCommitBatchRingIx,
  buildInitAuthorityIx,
  buildInitRootRingIx,
  buildFreezeAuthorityIx,
  buildCommitProofIx,
  buildCommitProofEventIx,
  buildCommitProofWithBetaIx,
  buildReadOnlyAuthorityContext,
  fetchAuthority,
  fetchPossession,
  fetchProofCommit,
  fetchProofCommitWithBeta,
  fetchRootRing,
  findBatchCommits,
  findProofCommitEvents,
  getProgram,
  pickCanonicalCommit,
  possessionMessage,
  rootRingEntry,
  signPossessionMessage,
  verifyAuthorityCommitEndToEnd,
  verifyBatchCommitEndToEnd,
  encodeLabel,
} from "@collectorcrypt/vrf-client";

/**
 * Live smoke test (T4). Skipped by default. Run with:
 *
 *   CC_VRF_SMOKE=1 \
 *   CC_VRF_RPC_URL=https://devnet.helius-rpc.com/?api-key=... \
 *   CC_VRF_SMOKE_PAYER=/path/to/funded-devnet-id.json \
 *   pnpm --filter @collectorcrypt/dice-demo test
 *
 * Exercises the full lifecycle on a live cluster with a fresh label: init, freeze, the three per-call commit
 * modes, batch, root ring, possession, the refused malformed batches, and the removed revoke_authority. Logs CU
 * for every v2 instruction. Optional:
 *   CC_VRF_SMOKE_PINNED=pins.json   re-verify commits made before the upgrade: a JSON array of
 *                                   { mode: "registry"|"beta"|"event", owner, label, memo, alpha, proof, signature? }
 *                                   (alpha and proof hex; signature required for event mode)
 *   CC_VRF_SMOKE_AGED_LABEL=<label> CU of the batch instructions for an older frozen authority the payer owns, whose
 *                                   validity proof takes the ZK path (a fresh authority proves by index)
 */
const SMOKE = process.env.CC_VRF_SMOKE === "1";
const describeMaybe = SMOKE ? describe : describe.skip;
const PINNED = process.env.CC_VRF_SMOKE_PINNED;
const AGED_LABEL = process.env.CC_VRF_SMOKE_AGED_LABEL;

interface Pin {
  mode: "registry" | "beta" | "event";
  owner: string;
  label: string;
  memo: string;
  alpha: string;
  proof: string;
  signature?: string;
}

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

    const rpcUrl =
      process.env.CC_VRF_RPC_URL || "https://api.devnet.solana.com";
    const photonUrl = process.env.CC_VRF_PHOTON_URL || rpcUrl;
    rpc = createRpc(rpcUrl, photonUrl);

    const connection = new Connection(rpcUrl, "confirmed");
    const wallet = new anchor.Wallet(payer);
    provider = new anchor.AnchorProvider(connection, wallet, {
      commitment: "confirmed",
    });
    program = getProgram(provider);

    const bal = await connection.getBalance(payer.publicKey);
    console.log(
      `payer ${payer.publicKey.toBase58()} balance: ${bal / LAMPORTS_PER_SOL} SOL`,
    );
    // Ring rent (~0.038 SOL) + attestation rent (~0.001 SOL) + fees.
    if (bal < 0.1 * LAMPORTS_PER_SOL) {
      throw new Error("payer balance < 0.1 SOL; fund the keypair first");
    }

    const kp = generateKeyPair();
    vrfSk = kp.sk;
    vrfPk = kp.pk;
  }, 120_000);

  async function send(ixs: TransactionInstruction[]): Promise<string> {
    return provider.sendAndConfirm(
      new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
        .add(...ixs),
      [],
    );
  }

  /** CU of a confirmed tx; the RPC can lag getTransaction by a few seconds behind confirmation. */
  async function cu(sig: string): Promise<number | undefined> {
    for (let i = 0; i < 10; i++) {
      const tx = await provider.connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (tx) return tx.meta?.computeUnitsConsumed;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    return undefined;
  }

  /** Expects the transaction to fail with this program error code, or with a message containing `text`. */
  async function expectFailure(
    ixs: TransactionInstruction[],
    expected: number | string,
  ): Promise<void> {
    let msg = "";
    try {
      await send(ixs);
    } catch (err) {
      const logs = (err as { logs?: string[] }).logs ?? [];
      msg = `${String(err)}\n${logs.join("\n")}`;
    }
    const needle =
      typeof expected === "number"
        ? `custom program error: 0x${expected.toString(16)}`
        : expected;
    expect(msg, `expected failure "${needle}"`).toContain(needle);
  }

  function rollsFor(prefix: string, n: number) {
    return Array.from({ length: n }, (_, i) => {
      const memo = `${label}-${prefix}-${i}`;
      const alpha = sha256(new TextEncoder().encode(memo));
      const { proof } = proveVRF(vrfSk, alpha);
      return { memo, alpha, proof, beta: vrfProofToHash(proof) };
    });
  }

  it(
    "init_authority creates and freezes a VrfAuthority on chain",
    { timeout: 180_000 },
    async () => {
      const { ix, authorityAddress } = await buildInitAuthorityIx(
        program,
        rpc,
        {
          owner: payer.publicKey,
          pk: vrfPk,
          suite: SUITE_EDWARDS25519_SHA512_TAI,
          label,
        },
      );
      const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
        .add(ix);
      const sig = await provider.sendAndConfirm(tx, []);
      console.log("init tx:", sig);

      const fetched = await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      );
      expect(fetched).not.toBeNull();
      expect(bytesToHex(Uint8Array.from(fetched!.decoded.pk))).toBe(
        bytesToHex(vrfPk),
      );
      expect(fetched!.decoded.frozen).toBe(false);
      expect(fetched!.decoded.revoked).toBe(false);
      expect(fetched!.authorityAddress.toBase58()).toBe(
        authorityAddress.toBase58(),
      );

      const freezeIx = await buildFreezeAuthorityIx(program, rpc, {
        owner: payer.publicKey,
        label,
      });
      const freezeSig = await provider.sendAndConfirm(
        new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
          .add(freezeIx),
        [],
      );
      console.log("freeze tx:", freezeSig);

      const frozen = await fetchAuthority(program, rpc, payer.publicKey, label);
      expect(frozen!.decoded.frozen).toBe(true);
    },
  );

  it(
    "commit_proof posts a verifiable randomness call",
    { timeout: 120_000 },
    async () => {
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

      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      ))!;
      const commit = await fetchProofCommit(
        program,
        rpc,
        auth.authorityAddress,
        memo,
      );
      expect(commit).not.toBeNull();
      expect(commit!.commitAddress.toBase58()).toBe(commitAddress.toBase58());

      const result = verifyAuthorityCommitEndToEnd({
        authority: auth.onChainAuthority,
        expectedOwner: payer.publicKey,
        expectedLabel: encodeLabel(label),
        expectedAuthorityAddress: auth.authorityAddress,
        alpha,
        proof,
        memo,
        onChainCommit: commit!.onChainCommit,
      });
      expect(result.valid).toBe(true);
      expect(bytesToHex(result.beta!)).toBe(bytesToHex(beta));
    },
  );

  it(
    "commit_proof_with_beta stores beta on chain alongside the commit (pda+beta mode)",
    { timeout: 180_000 },
    async () => {
      const memo = `${label}-beta-1`;
      const alpha = sha256(new TextEncoder().encode(memo));
      const { proof } = proveVRF(vrfSk, alpha);
      const beta = vrfProofToHash(proof);

      const { ix, commitAddress } = await buildCommitProofWithBetaIx(
        program,
        rpc,
        {
          owner: payer.publicKey,
          label,
          memo,
          alpha,
          proof,
          beta,
        },
      );
      const sig = await provider.sendAndConfirm(
        new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
          .add(ix),
        [],
      );
      console.log("commit-with-beta tx:", sig);

      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      ))!;
      const commit = await fetchProofCommitWithBeta(
        program,
        rpc,
        auth.authorityAddress,
        memo,
      );
      expect(commit).not.toBeNull();
      expect(commit!.commitAddress.toBase58()).toBe(commitAddress.toBase58());
      expect(bytesToHex(commit!.beta)).toBe(bytesToHex(beta));

      const result = verifyAuthorityCommitEndToEnd({
        authority: auth.onChainAuthority,
        expectedOwner: payer.publicKey,
        expectedLabel: encodeLabel(label),
        expectedAuthorityAddress: auth.authorityAddress,
        alpha,
        proof,
        memo,
        onChainCommit: commit!.onChainCommit,
        onChainBeta: commit!.beta,
      });
      expect(result.valid).toBe(true);
      expect(bytesToHex(result.beta!)).toBe(bytesToHex(beta));
    },
  );

  it(
    "commit_proof_event emits a verifiable randomness call (event mode)",
    { timeout: 180_000 },
    async () => {
      const memo = `${label}-event-1`;
      const alpha = sha256(new TextEncoder().encode(memo));
      const { proof } = proveVRF(vrfSk, alpha);
      const beta = vrfProofToHash(proof);

      const ix = await buildCommitProofEventIx(program, rpc, {
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

      // By signature: a history scan of a busy payer is slow and can miss the commit.
      const { events } = await findProofCommitEvents(
        program,
        provider.connection,
        payer.publicKey,
        label,
        memo,
        { signature: sig },
      );
      expect(events.length).toBeGreaterThan(0);

      const picked = pickCanonicalCommit(
        events.map((e) => e.onChainCommit),
        proof,
      );
      expect(picked.canonical).not.toBeNull();

      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      ))!;
      const result = verifyAuthorityCommitEndToEnd({
        authority: auth.onChainAuthority,
        expectedOwner: payer.publicKey,
        expectedLabel: encodeLabel(label),
        expectedAuthorityAddress: auth.authorityAddress,
        alpha,
        proof,
        memo,
        onChainCommit: picked.canonical!,
      });
      expect(result.valid).toBe(true);
      expect(bytesToHex(result.beta!)).toBe(bytesToHex(beta));
    },
  );

  it(
    "freeze_authority rejects subsequent freezes",
    { timeout: 120_000 },
    async () => {
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
    },
  );

  it(
    "commit_batch_event commits one root; every leaf verifies",
    { timeout: 180_000 },
    async () => {
      const rolls = rollsFor("batch", 5);
      const batch = buildBatch(rolls.map((r) => batchLeafV1(r)));
      const ix = await buildCommitBatchEventIx(program, rpc, {
        owner: payer.publicKey,
        label,
        root: batch.root,
        count: batch.count,
      });
      const sig = await send([ix]);
      console.log("commit_batch_event tx:", sig, "CU:", await cu(sig));

      const { commits, unfetched } = await findBatchCommits(
        program,
        provider.connection,
        sig,
      );
      expect(unfetched).toBe(false);
      expect(commits).toHaveLength(1);
      expect(commits[0].ringSeq).toBeNull();
      expect(commits[0].count).toBe(5);

      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      ))!;
      const check = (i: number, path: Uint8Array[]) =>
        verifyBatchCommitEndToEnd({
          authority: auth.onChainAuthority,
          batch: commits[0],
          memo: rolls[i].memo,
          alpha: rolls[i].alpha,
          proof: rolls[i].proof,
          index: i,
          path,
          expectedOwner: payer.publicKey,
          expectedLabel: encodeLabel(label),
        });
      rolls.forEach((_, i) => {
        const result = check(i, batch.path(i));
        expect(result.valid, result.reasons.join(",")).toBe(true);
      });
      expect(check(1, batch.path(2)).valid).toBe(false);
    },
  );

  it(
    "the program refuses malformed batches before the Light CPI",
    { timeout: 180_000 },
    async () => {
      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      ))!;
      // Built without the SDK's input checks, so the program's own checks answer.
      const raw = async (
        root: Uint8Array,
        count: number,
        leafVersion: number,
      ) => {
        const ctx = await buildReadOnlyAuthorityContext(
          rpc,
          program.programId,
          auth.account,
        );
        return (
          (program as anchor.Program).methods
            // @ts-ignore: Anchor IDL types are dynamic at this layer
            .commitBatchEvent(
              Array.from(encodeLabel(label)),
              Array.from(root),
              count,
              leafVersion,
              ctx.proof,
              ctx.authorityReadOnlyMeta,
              auth.decoded,
            )
            .accounts({ owner: payer.publicKey } as never)
            .remainingAccounts(ctx.remainingAccountMetas)
            .instruction()
        );
      };
      const root = sha256(new TextEncoder().encode(`${label}-malformed`));
      await expectFailure([await raw(root, 0, 1)], 6010); // EmptyBatch
      await expectFailure([await raw(root, 5, 2)], 6012); // UnsupportedLeafVersion
      await expectFailure([await raw(new Uint8Array(32), 5, 1)], 6013); // ZeroBatchRoot
    },
  );

  it(
    "init_root_ring + commit_batch_ring record a live root; a retried seq is refused",
    { timeout: 240_000 },
    async () => {
      const { ix: initIx, ringAddress } = await buildInitRootRingIx(
        program,
        rpc,
        { owner: payer.publicKey, label },
      );
      const initSig = await send([initIx]);
      console.log("init_root_ring tx:", initSig, "CU:", await cu(initSig));

      const root = sha256(new TextEncoder().encode(`${label}-ring-1`));
      const { ix, seq } = await buildCommitBatchRingIx(program, rpc, {
        owner: payer.publicKey,
        label,
        root,
        count: 3,
      });
      expect(seq).toBe(1n);
      const sig = await send([ix]);
      console.log("commit_batch_ring tx:", sig, "CU:", await cu(sig));

      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      ))!;
      const fetched = (await fetchRootRing(
        provider.connection,
        auth.authorityAddress,
      ))!;
      expect(fetched.address.toBase58()).toBe(ringAddress.toBase58());
      expect(fetched.ring.nextSeq).toBe(2n);
      const entry = rootRingEntry(fetched.data, 1n)!;
      expect(bytesToHex(entry.root)).toBe(bytesToHex(root));
      expect(entry.count).toBe(3);
      const { commits } = await findBatchCommits(
        program,
        provider.connection,
        sig,
      );
      expect(commits[0].ringSeq).toBe(1n);

      const retry = await buildCommitBatchRingIx(program, rpc, {
        owner: payer.publicKey,
        label,
        root,
        count: 3,
        expectedSeq: 1n,
      });
      await expectFailure([retry.ix], 6015); // RingSeqMismatch
    },
  );

  it(
    "attest_possession accepts only the authority's key, once",
    { timeout: 240_000 },
    async () => {
      const { ixs, attestationAddress } = await buildAttestPossessionIxs(
        program,
        rpc,
        { owner: payer.publicKey, label, vrfSecretKey: vrfSk },
      );
      const [, attestIx] = ixs;
      await expectFailure([attestIx], 6017); // MissingEd25519Instruction

      const other = generateKeyPair();
      const message = possessionMessage(payer.publicKey, label);
      const wrongKey = Ed25519Program.createInstructionWithPublicKey({
        publicKey: other.pk,
        message,
        signature: await signPossessionMessage(other.sk, message),
      });
      await expectFailure([wrongKey, attestIx], 6021); // PossessionKeyMismatch

      const sig = await send(ixs);
      console.log("attest_possession tx:", sig, "CU:", await cu(sig));
      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        label,
      ))!;
      const recorded = (await fetchPossession(
        provider.connection,
        auth.authorityAddress,
      ))!;
      expect(recorded.address.toBase58()).toBe(attestationAddress.toBase58());
      expect(bytesToHex(recorded.pk)).toBe(bytesToHex(vrfPk));

      await expectFailure(ixs, "already in use");
    },
  );

  it("revoke_authority no longer exists", { timeout: 60_000 }, async () => {
    const ix = new TransactionInstruction({
      programId: program.programId,
      keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
      data: Buffer.from(
        sha256(new TextEncoder().encode("global:revoke_authority")).slice(0, 8),
      ),
    });
    await expectFailure([ix], 101); // Anchor InstructionFallbackNotFound
  });

  (PINNED ? it : it.skip)(
    "commits made before the upgrade still verify",
    { timeout: 900_000 },
    async () => {
      const fs = await import("fs");
      const pins = JSON.parse(fs.readFileSync(PINNED!, "utf8")) as Pin[];
      expect(pins.length).toBeGreaterThan(0);
      for (const p of pins) {
        const owner = new PublicKey(p.owner);
        const alpha = hexToBytes(p.alpha.replace(/^0x/, ""));
        const proof = hexToBytes(p.proof.replace(/^0x/, ""));
        const auth = await fetchAuthority(program, rpc, owner, p.label);
        expect(auth, `${p.memo}: authority`).not.toBeNull();
        const base = {
          authority: auth!.onChainAuthority,
          expectedOwner: owner,
          expectedLabel: encodeLabel(p.label),
          alpha,
          proof,
          memo: p.memo,
        };
        let result;
        if (p.mode === "event") {
          if (!p.signature)
            throw new Error(`${p.memo}: event pin needs a signature`);
          const { events } = await findProofCommitEvents(
            program,
            provider.connection,
            owner,
            p.label,
            p.memo,
            { signature: p.signature },
          );
          const picked = pickCanonicalCommit(
            events.map((e) => e.onChainCommit),
            proof,
          );
          expect(picked.canonical, `${p.memo}: event`).not.toBeNull();
          result = verifyAuthorityCommitEndToEnd({
            ...base,
            onChainCommit: picked.canonical!,
          });
        } else if (p.mode === "beta") {
          const commit = await fetchProofCommitWithBeta(
            program,
            rpc,
            auth!.authorityAddress,
            p.memo,
          );
          expect(commit, `${p.memo}: commit`).not.toBeNull();
          result = verifyAuthorityCommitEndToEnd({
            ...base,
            onChainCommit: commit!.onChainCommit,
            onChainBeta: commit!.beta,
          });
        } else {
          const commit = await fetchProofCommit(
            program,
            rpc,
            auth!.authorityAddress,
            p.memo,
          );
          expect(commit, `${p.memo}: commit`).not.toBeNull();
          result = verifyAuthorityCommitEndToEnd({
            ...base,
            onChainCommit: commit!.onChainCommit,
          });
        }
        expect(result.valid, `${p.memo}: ${result.reasons.join(",")}`).toBe(
          true,
        );
      }
      console.log(`re-verified ${pins.length} pinned commits`);
    },
  );

  (AGED_LABEL ? it : it.skip)(
    "CU of the batch instructions for an aged authority",
    { timeout: 240_000 },
    async () => {
      const auth = (await fetchAuthority(
        program,
        rpc,
        payer.publicKey,
        AGED_LABEL!,
      ))!;
      expect(auth, "aged authority").not.toBeNull();
      const ctx = await buildReadOnlyAuthorityContext(
        rpc,
        program.programId,
        auth.account,
      );
      console.log(
        "aged authority proves by index:",
        ctx.authorityReadOnlyMeta.treeInfo.proveByIndex,
      );
      const root = sha256(new TextEncoder().encode(`${label}-aged`));
      const ix = await buildCommitBatchEventIx(program, rpc, {
        owner: payer.publicKey,
        label: AGED_LABEL!,
        root,
        count: 1,
      });
      const sig = await send([ix]);
      console.log("aged commit_batch_event tx:", sig, "CU:", await cu(sig));

      if (!(await fetchRootRing(provider.connection, auth.authorityAddress))) {
        const { ix: initIx } = await buildInitRootRingIx(program, rpc, {
          owner: payer.publicKey,
          label: AGED_LABEL!,
        });
        const initSig = await send([initIx]);
        console.log(
          "aged init_root_ring tx:",
          initSig,
          "CU:",
          await cu(initSig),
        );
      }
      const { ix: ringIx } = await buildCommitBatchRingIx(program, rpc, {
        owner: payer.publicKey,
        label: AGED_LABEL!,
        root,
        count: 1,
      });
      const ringSig = await send([ringIx]);
      console.log(
        "aged commit_batch_ring tx:",
        ringSig,
        "CU:",
        await cu(ringSig),
      );
    },
  );
});
