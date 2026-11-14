import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPrivateKey, sign as nodeSign } from "node:crypto";
import * as fs from "node:fs";
import {
  ComputeBudgetProgram,
  Connection,
  Ed25519Program,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  Transaction,
  TransactionInstruction,
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
  buildBatch,
  buildCommitBatchEventIx,
  buildCommitProofEventIx,
  buildCommitProofIx,
  buildCommitProofWithBetaIx,
  buildFreezeAuthorityIx,
  buildInitAuthorityIx,
  buildReadOnlyAuthorityContext,
  deriveRootRingAddress,
  derivePossessionAddress,
  encodeLabel,
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
  verifyAuthorityCommitEndToEnd,
  verifyBatchCommitEndToEnd,
  type BatchCommit,
} from "@collectorcrypt/vrf-client";

/**
 * Adversarial devnet suite for the cc-vrf v2 upgrade: every new instruction's success and rejection paths, the kept
 * instructions, ring wrap and races, Ed25519 spoofs, and the SDK verifiers against real transactions. Rejections are
 * sent with skipPreflight so each lands on chain with its error and a signature. Skipped by default:
 *
 *   CC_VRF_DEVNET_V2=1 CC_VRF_RPC_URL=<Photon-capable devnet RPC> CC_VRF_SMOKE_PAYER=<keypair.json> \
 *   CC_VRF_REPORT=<out.json> [CC_VRF_SMOKE_PINNED=<pins.json>] [CC_VRF_AGED_LABEL=<label>] \
 *   npx vitest run test/devnet-v2.test.ts
 */
const RUN = process.env.CC_VRF_DEVNET_V2 === "1";
const describeMaybe = RUN ? describe : describe.skip;
const AGED_LABEL = process.env.CC_VRF_AGED_LABEL;
const PINNED = process.env.CC_VRF_SMOKE_PINNED;
const NOOP_ID = new PublicKey("noopb9bkMVfRPU8AsbpTUg8AQkHtKwMYZiFUjNRtMmV");
const IDL_ACCOUNT = new PublicKey(
  "Fu5qyb3QdMLWaX2SMw69HdCHfKrotZz1wDeEQVeTj2bB",
);

// Program error codes (programs/cc-vrf/src/errors.rs) and the Anchor / Light / system codes we expect.
const E = {
  AlreadyFrozen: 6001,
  AuthorityNotFrozen: 6002,
  NotOwner: 6004,
  AuthorityLabelMismatch: 6005,
  AuthorityAddressMismatch: 6006,
  EmptyBatch: 6010,
  BatchTooLarge: 6011,
  UnsupportedLeafVersion: 6012,
  ZeroBatchRoot: 6013,
  RingAuthorityMismatch: 6014,
  RingSeqMismatch: 6015,
  MissingEd25519Instruction: 6017,
  MultipleEd25519Instructions: 6018,
  MalformedEd25519Instruction: 6019,
  Ed25519IndirectReference: 6020,
  PossessionKeyMismatch: 6021,
  PossessionMessageMismatch: 6022,
  InstructionFallbackNotFound: 101,
  AccountDiscriminatorMismatch: 3002,
  AccountOwnedByWrongProgram: 3007,
  LightAddressExists: 14201,
  SystemAccountInUse: 0,
} as const;

interface Rec {
  section: string;
  label: string;
  expected: string;
  result: string;
  signature?: string;
  cu?: number;
  note?: string;
}

interface Sent {
  sig: string;
  landed: boolean;
  err: unknown;
  cu?: number;
  logs: string[];
}

type Fetched = NonNullable<Awaited<ReturnType<typeof fetchAuthority>>>;

const PKCS8_ED25519 = Buffer.from("302e020100300506032b657004220420", "hex");
function edSign(seed: Uint8Array, msg: Uint8Array): Uint8Array {
  const key = createPrivateKey({
    key: Buffer.concat([PKCS8_ED25519, Buffer.from(seed)]),
    format: "der",
    type: "pkcs8",
  });
  return new Uint8Array(nodeSign(null, Buffer.from(msg), key));
}

function codeOf(err: unknown): number | string | null {
  if (!err) return null;
  const ie = (err as { InstructionError?: [number, unknown] }).InstructionError;
  if (ie) {
    const e = ie[1];
    if (e && typeof e === "object" && "Custom" in e)
      return (e as { Custom: number }).Custom;
    return typeof e === "string" ? e : JSON.stringify(e);
  }
  return typeof err === "string" ? err : JSON.stringify(err);
}

describeMaybe("cc-vrf v2 adversarial devnet suite", () => {
  let payer: Keypair;
  let stranger: Keypair;
  let connection: Connection;
  let provider: anchor.AnchorProvider;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let program: anchor.Program<any>;
  let rpc: ReturnType<typeof createRpc>;
  const tag = `dv2${Date.now().toString(36)}`;
  const labelA = `${tag}-a`;
  const labelB = `${tag}-b`;
  const labelU = `${tag}-u`;
  const vrfA = generateKeyPair();
  const vrfB = generateKeyPair();
  const vrfU = generateKeyPair();
  let authA: Fetched;
  let authB: Fetched;
  let authU: Fetched;
  const report: Rec[] = [];
  let failedBatchSig = "";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const methods = () => (program as anchor.Program).methods as any;

  function rec(r: Rec) {
    report.push(r);
    console.log(
      `[${r.section}] ${r.label}: ${r.result}` +
        (r.signature ? ` sig=${r.signature}` : "") +
        (r.cu !== undefined ? ` cu=${r.cu}` : "") +
        (r.note ? ` (${r.note})` : ""),
    );
  }

  async function getTx(sig: string) {
    for (let i = 0; i < 20; i++) {
      const t = await connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      if (t) return t;
      await new Promise((r) => setTimeout(r, 1_000));
    }
    return null;
  }

  async function land(
    ixs: TransactionInstruction[],
    opts: { signers?: Keypair[]; cu?: number } = {},
  ): Promise<Sent> {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({
      feePayer: payer.publicKey,
      blockhash,
      lastValidBlockHeight,
    }).add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: opts.cu ?? 400_000 }),
      ...ixs,
    );
    const signers = [payer, ...(opts.signers ?? [])].filter(
      (k, i, all) =>
        all.findIndex((x) => x.publicKey.equals(k.publicKey)) === i,
    );
    tx.sign(...signers);
    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 5,
    });
    await connection
      .confirmTransaction(
        { signature: sig, blockhash, lastValidBlockHeight },
        "confirmed",
      )
      .catch(() => undefined);
    const t = await getTx(sig);
    return {
      sig,
      landed: !!t,
      err: t?.meta?.err ?? null,
      cu: t?.meta?.computeUnitsConsumed ?? undefined,
      logs: t?.meta?.logMessages ?? [],
    };
  }

  async function ok(
    section: string,
    label: string,
    ixs: TransactionInstruction[],
    opts: { signers?: Keypair[]; cu?: number; note?: string } = {},
  ): Promise<Sent> {
    const r = await land(ixs, opts);
    rec({
      section,
      label,
      expected: "success",
      result: r.err
        ? `error ${codeOf(r.err)}`
        : r.landed
          ? "success"
          : "not landed",
      signature: r.sig,
      cu: r.cu,
      note: opts.note,
    });
    expect(r.landed, `${label}: not landed`).toBe(true);
    expect(
      r.err,
      `${label}: ${JSON.stringify(r.err)}\n${r.logs.slice(-8).join("\n")}`,
    ).toBeNull();
    return r;
  }

  async function fails(
    section: string,
    label: string,
    ixs: TransactionInstruction[],
    want: number | string,
    opts: { signers?: Keypair[]; cu?: number; note?: string } = {},
  ): Promise<Sent> {
    const r = await land(ixs, opts);
    const got = codeOf(r.err);
    rec({
      section,
      label,
      expected: `error ${want}`,
      result: r.landed ? (r.err ? `error ${got}` : "success") : "not landed",
      signature: r.sig,
      cu: r.cu,
      note: opts.note,
    });
    expect(r.landed, `${label}: not landed`).toBe(true);
    expect(got, `${label}\n${r.logs.slice(-8).join("\n")}`).toBe(want);
    return r;
  }

  function offchain(
    section: string,
    label: string,
    expected: boolean,
    got: boolean,
    note?: string,
  ) {
    rec({
      section,
      label,
      expected: String(expected),
      result: String(got),
      note,
    });
    expect(got, label).toBe(expected);
  }

  async function auth(owner: PublicKey, label: string): Promise<Fetched> {
    const a = await fetchAuthority(program, rpc, owner, label);
    if (!a) throw new Error(`authority ${label} not found`);
    return a;
  }

  async function ctxFor(a: Fetched) {
    return buildReadOnlyAuthorityContext(rpc, program.programId, a.account);
  }

  async function batchEventIx(
    owner: PublicKey,
    a: Fetched,
    label: string | Uint8Array,
    root: Uint8Array,
    count: number,
    lv = 1,
    mutate?: (meta: { address: number[] }, decoded: { pk: number[] }) => void,
  ) {
    const ctx = await ctxFor(a);
    const meta = {
      ...ctx.authorityReadOnlyMeta,
      address: Array.from(
        ctx.authorityReadOnlyMeta.address as ArrayLike<number>,
      ),
    };
    const decoded = {
      ...a.decoded,
      pk: Array.from(a.decoded.pk as ArrayLike<number>),
    };
    mutate?.(meta, decoded);
    const lbl = typeof label === "string" ? encodeLabel(label) : label;
    return methods()
      .commitBatchEvent(
        Array.from(lbl),
        Array.from(root),
        count,
        lv,
        ctx.proof,
        meta,
        decoded,
      )
      .accounts({ owner })
      .remainingAccounts(ctx.remainingAccountMetas)
      .instruction() as Promise<TransactionInstruction>;
  }

  async function ringCommitIx(
    owner: PublicKey,
    a: Fetched,
    label: string,
    ring: PublicKey,
    root: Uint8Array,
    count: number,
    seq: bigint,
    lv = 1,
  ) {
    const ctx = await ctxFor(a);
    return methods()
      .commitBatchRing(
        Array.from(encodeLabel(label)),
        Array.from(root),
        count,
        lv,
        new anchor.BN(seq.toString()),
        ctx.proof,
        ctx.authorityReadOnlyMeta,
        a.decoded,
      )
      .accounts({ owner, rootRing: ring })
      .remainingAccounts(ctx.remainingAccountMetas)
      .instruction() as Promise<TransactionInstruction>;
  }

  async function initRingIx(
    owner: PublicKey,
    a: Fetched,
    label: string,
    ring: PublicKey,
  ) {
    const ctx = await ctxFor(a);
    return methods()
      .initRootRing(
        Array.from(encodeLabel(label)),
        ctx.proof,
        ctx.authorityReadOnlyMeta,
        a.decoded,
      )
      .accounts({
        owner,
        rootRing: ring,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(ctx.remainingAccountMetas)
      .instruction() as Promise<TransactionInstruction>;
  }

  async function attestIx(owner: PublicKey, a: Fetched, label: string) {
    const ctx = await ctxFor(a);
    return methods()
      .attestPossession(
        Array.from(encodeLabel(label)),
        ctx.proof,
        ctx.authorityReadOnlyMeta,
        a.decoded,
      )
      .accounts({
        owner,
        attestation: derivePossessionAddress(
          a.authorityAddress,
          program.programId,
        ),
        instructions: SYSVAR_INSTRUCTIONS_PUBKEY,
        systemProgram: SystemProgram.programId,
      })
      .remainingAccounts(ctx.remainingAccountMetas)
      .instruction() as Promise<TransactionInstruction>;
  }

  async function eventCommitIx(
    owner: PublicKey,
    a: Fetched,
    label: string,
    memo: string,
  ) {
    const ctx = await ctxFor(a);
    const h = (s: string) => Array.from(sha256(new TextEncoder().encode(s)));
    return methods()
      .commitProofEvent(
        ctx.proof,
        ctx.authorityReadOnlyMeta,
        a.decoded,
        Array.from(encodeLabel(label)),
        h(memo),
        h(`${memo}-proof`),
        h(`${memo}-alpha`),
      )
      .accounts({ owner })
      .remainingAccounts(ctx.remainingAccountMetas)
      .instruction() as Promise<TransactionInstruction>;
  }

  function ed25519Ix(pk: Uint8Array, msg: Uint8Array, sig: Uint8Array) {
    return Ed25519Program.createInstructionWithPublicKey({
      publicKey: pk,
      message: msg,
      signature: sig,
    });
  }

  /** One precompile instruction carrying two (valid) signatures. */
  function ed25519TwoSigsIx(
    a: { pk: Uint8Array; sk: Uint8Array },
    b: { pk: Uint8Array; sk: Uint8Array },
    msg: Uint8Array,
  ) {
    const header = 2 + 2 * 14;
    const entry = (base: number) => [
      base + 32,
      0xffff,
      base,
      0xffff,
      base + 96,
      msg.length,
      0xffff,
    ];
    const baseA = header;
    const baseB = header + 96 + msg.length;
    const out: number[] = [2, 0];
    for (const v of [...entry(baseA), ...entry(baseB)])
      out.push(v & 0xff, v >> 8);
    for (const k of [a, b]) out.push(...k.pk, ...edSign(k.sk, msg), ...msg);
    return new TransactionInstruction({
      programId: Ed25519Program.programId,
      keys: [],
      data: Buffer.from(out),
    });
  }

  /** [noop carrying pk ‖ sig ‖ msg, precompile pointing at instruction `dataIx`]: valid for the precompile. */
  function ed25519IndirectIxs(
    k: { pk: Uint8Array; sk: Uint8Array },
    msg: Uint8Array,
    dataIx: number,
  ) {
    const carried = Buffer.concat([
      Buffer.from(k.pk),
      Buffer.from(edSign(k.sk, msg)),
      Buffer.from(msg),
    ]);
    const out: number[] = [1, 0];
    for (const v of [32, dataIx, 0, dataIx, 96, msg.length, dataIx])
      out.push(v & 0xff, v >> 8);
    return [
      new TransactionInstruction({
        programId: NOOP_ID,
        keys: [],
        data: carried,
      }),
      new TransactionInstruction({
        programId: Ed25519Program.programId,
        keys: [],
        data: Buffer.from(out),
      }),
    ];
  }

  function rolls(prefix: string, n: number, sk: Uint8Array) {
    return Array.from({ length: n }, (_, i) => {
      const memo = `${tag}-${prefix}-${i}`;
      const alpha = sha256(new TextEncoder().encode(memo));
      const { proof } = proveVRF(sk, alpha);
      return { memo, alpha, proof, beta: vrfProofToHash(proof) };
    });
  }

  beforeAll(async () => {
    payer = Keypair.fromSecretKey(
      Uint8Array.from(
        JSON.parse(fs.readFileSync(process.env.CC_VRF_SMOKE_PAYER!, "utf8")),
      ),
    );
    const url = process.env.CC_VRF_RPC_URL!;
    rpc = createRpc(url, process.env.CC_VRF_PHOTON_URL || url);
    connection = new Connection(url, "confirmed");
    provider = new anchor.AnchorProvider(connection, new anchor.Wallet(payer), {
      commitment: "confirmed",
    });
    program = getProgram(provider);
    stranger = Keypair.generate();
    await ok("setup", "fund stranger 0.05 SOL", [
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: stranger.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }),
    ]);
    for (const [label, kp, freeze] of [
      [labelA, vrfA, true],
      [labelB, vrfB, true],
      [labelU, vrfU, false],
    ] as const) {
      const { ix } = await buildInitAuthorityIx(program, rpc, {
        owner: payer.publicKey,
        pk: kp.pk,
        suite: SUITE_EDWARDS25519_SHA512_TAI,
        label,
      });
      await ok("setup", `init_authority ${label}`, [ix]);
      if (freeze) {
        const fix = await buildFreezeAuthorityIx(program, rpc, {
          owner: payer.publicKey,
          label,
        });
        await ok("setup", `freeze_authority ${label}`, [fix]);
      }
    }
    authA = await auth(payer.publicKey, labelA);
    authB = await auth(payer.publicKey, labelB);
    authU = await auth(payer.publicKey, labelU);
  }, 600_000);

  afterAll(() => {
    const out = process.env.CC_VRF_REPORT;
    if (out)
      fs.writeFileSync(
        out,
        JSON.stringify(
          { tag, payer: payer?.publicKey.toBase58(), report },
          null,
          2,
        ),
      );
  });

  it("kept instructions behave as in RC1", { timeout: 600_000 }, async () => {
    const S = "kept";
    const r = rolls("kept", 3, vrfA.sk);
    const plain = {
      owner: payer.publicKey,
      label: labelA,
      memo: r[0].memo,
      alpha: r[0].alpha,
      proof: r[0].proof,
    };
    // Once a memo's commit exists the indexer refuses a non-inclusion proof for its address, so a duplicate can only
    // reach the chain as a retry built before the original landed: build all three now, send the original first.
    const { ix: c1 } = await buildCommitProofIx(program, rpc, plain);
    const { ix: dup } = await buildCommitProofIx(program, rpc, plain);
    const { ix: dupBeta } = await buildCommitProofWithBetaIx(program, rpc, {
      ...plain,
      beta: r[0].beta,
    });
    await ok(S, "commit_proof", [c1]);
    const { ix: c2 } = await buildCommitProofWithBetaIx(program, rpc, {
      owner: payer.publicKey,
      label: labelA,
      memo: r[1].memo,
      alpha: r[1].alpha,
      proof: r[1].proof,
      beta: r[1].beta,
    });
    await ok(S, "commit_proof_with_beta", [c2]);
    const c3 = await buildCommitProofEventIx(program, rpc, {
      owner: payer.publicKey,
      label: labelA,
      memo: r[2].memo,
      alpha: r[2].alpha,
      proof: r[2].proof,
    });
    const ev = await ok(S, "commit_proof_event", [c3]);

    const a = authA.onChainAuthority;
    const reg = (await fetchProofCommit(
      program,
      rpc,
      authA.authorityAddress,
      r[0].memo,
    ))!;
    offchain(
      S,
      "verify commit_proof (SDK 0.2.0)",
      true,
      verifyAuthorityCommitEndToEnd({
        authority: a,
        alpha: r[0].alpha,
        proof: r[0].proof,
        memo: r[0].memo,
        onChainCommit: reg.onChainCommit,
      }).valid,
    );
    const wb = (await fetchProofCommitWithBeta(
      program,
      rpc,
      authA.authorityAddress,
      r[1].memo,
    ))!;
    offchain(
      S,
      "verify commit_proof_with_beta incl. on-chain beta",
      true,
      verifyAuthorityCommitEndToEnd({
        authority: a,
        alpha: r[1].alpha,
        proof: r[1].proof,
        memo: r[1].memo,
        onChainCommit: wb.onChainCommit,
        onChainBeta: wb.beta,
      }).valid,
    );
    const { events } = await findProofCommitEvents(
      program,
      connection,
      payer.publicKey,
      labelA,
      r[2].memo,
      {
        signature: ev.sig,
      },
    );
    const picked = pickCanonicalCommit(
      events.map((e) => e.onChainCommit),
      r[2].proof,
    );
    offchain(
      S,
      "verify commit_proof_event by signature",
      true,
      !!picked.canonical &&
        verifyAuthorityCommitEndToEnd({
          authority: a,
          alpha: r[2].alpha,
          proof: r[2].proof,
          memo: r[2].memo,
          onChainCommit: picked.canonical,
        }).valid,
    );
    offchain(
      S,
      "a proof for another memo does not verify",
      false,
      verifyAuthorityCommitEndToEnd({
        authority: a,
        alpha: r[0].alpha,
        proof: r[1].proof,
        memo: r[0].memo,
        onChainCommit: reg.onChainCommit,
      }).valid,
    );

    await fails(
      S,
      "commit_proof retried after the original landed (stale proof)",
      [dup],
      E.LightAddressExists,
    );
    await fails(
      S,
      "commit_proof_with_beta on a memo that already has a plain commit",
      [dupBeta],
      E.LightAddressExists,
    );
    const refreeze = await buildFreezeAuthorityIx(program, rpc, {
      owner: payer.publicKey,
      label: labelA,
    });
    await fails(S, "freeze_authority twice", [refreeze], E.AlreadyFrozen);
    await fails(
      S,
      "commit_proof_event, unfrozen authority",
      [await eventCommitIx(payer.publicKey, authU, labelU, `${tag}-u1`)],
      E.AuthorityNotFrozen,
    );
    await fails(
      S,
      "commit_proof_event signed by a stranger",
      [await eventCommitIx(stranger.publicKey, authA, labelA, `${tag}-s1`)],
      E.NotOwner,
      { signers: [stranger] },
    );
    await fails(
      S,
      "commit_proof_event with another label",
      [await eventCommitIx(payer.publicKey, authA, `${tag}-zz`, `${tag}-l1`)],
      E.AuthorityLabelMismatch,
    );
  });

  it("revoke_authority is gone", { timeout: 120_000 }, async () => {
    const data = Buffer.from(
      sha256(new TextEncoder().encode("global:revoke_authority")).slice(0, 8),
    );
    await fails(
      "revoke",
      "RC1 revoke_authority discriminator",
      [
        new TransactionInstruction({
          programId: program.programId,
          keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }],
          data,
        }),
      ],
      E.InstructionFallbackNotFound,
    );
  });

  it(
    "commit_batch_event: real batches, edges and every rejection",
    { timeout: 900_000 },
    async () => {
      const S = "batch";
      const a = authA.onChainAuthority;
      const five = rolls("b5", 5, vrfA.sk);
      const b5 = buildBatch(five.map((x) => batchLeafV1(x)));
      const s5 = await ok(S, "5-leaf batch", [
        await buildCommitBatchEventIx(program, rpc, {
          owner: payer.publicKey,
          label: labelA,
          root: b5.root,
          count: 5,
        }),
      ]);
      const { commits, unfetched } = await findBatchCommits(
        program,
        connection,
        s5.sig,
      );
      expect(unfetched).toBe(false);
      expect(commits).toHaveLength(1);
      const c5 = commits[0];
      const v = (
        i: number,
        o: Partial<{
          memo: string;
          alpha: Uint8Array;
          proof: Uint8Array;
          index: number;
          path: Uint8Array[];
          batch: BatchCommit;
        }> = {},
      ) =>
        verifyBatchCommitEndToEnd({
          authority: a,
          batch: o.batch ?? c5,
          memo: o.memo ?? five[i].memo,
          alpha: o.alpha ?? five[i].alpha,
          proof: o.proof ?? five[i].proof,
          index: o.index ?? i,
          path: o.path ?? b5.path(i),
          expectedOwner: payer.publicKey,
          expectedLabel: encodeLabel(labelA),
        }).valid;
      offchain(
        S,
        "all 5 leaves verify",
        true,
        [0, 1, 2, 3, 4].every((i) => v(i)),
      );
      offchain(S, "wrong memo", false, v(2, { memo: `${five[2].memo}x` }));
      offchain(S, "wrong alpha", false, v(2, { alpha: five[3].alpha }));
      offchain(
        S,
        "another leaf's valid proof",
        false,
        v(2, { proof: five[3].proof }),
      );
      offchain(S, "right leaf, wrong index", false, v(2, { index: 3 }));
      offchain(
        S,
        "right leaf, sibling's path",
        false,
        v(2, { path: b5.path(3) }),
      );
      offchain(
        S,
        "count claimed 6 instead of 5",
        false,
        v(4, { batch: { ...c5, count: 6 } }),
      );
      offchain(
        S,
        "leaf version 2 claimed",
        false,
        v(1, { batch: { ...c5, leafVersion: 2 } }),
      );
      offchain(
        S,
        "batch attributed to another owner",
        false,
        v(1, { batch: { ...c5, owner: stranger.publicKey } }),
      );

      const nine = rolls("b9", 9, vrfA.sk);
      const b9 = buildBatch(nine.map((x) => batchLeafV1(x)));
      const s9 = await ok(S, "9-leaf batch (count malleability check)", [
        await buildCommitBatchEventIx(program, rpc, {
          owner: payer.publicKey,
          label: labelA,
          root: b9.root,
          count: 9,
        }),
      ]);
      const c9 = (await findBatchCommits(program, connection, s9.sig))
        .commits[0];
      const v9 = (count: number) =>
        verifyBatchCommitEndToEnd({
          authority: a,
          batch: { ...c9, count },
          memo: nine[5].memo,
          alpha: nine[5].alpha,
          proof: nine[5].proof,
          index: 5,
          path: b9.path(5),
        }).valid;
      offchain(S, "index 5 with the committed count 9", true, v9(9));
      offchain(
        S,
        "index 5 with a caller-claimed count 16 (same tree shape)",
        true,
        v9(16),
        "RFC 9162 property: why verifiers must take count from the commit",
      );
      offchain(
        S,
        "index 5 with a caller-claimed count 17 (other shape)",
        false,
        v9(17),
      );

      const one = rolls("b1", 1, vrfA.sk);
      const b1 = buildBatch([batchLeafV1(one[0])]);
      const s1 = await ok(S, "1-leaf batch (empty path)", [
        await buildCommitBatchEventIx(program, rpc, {
          owner: payer.publicKey,
          label: labelA,
          root: b1.root,
          count: 1,
        }),
      ]);
      const c1 = (await findBatchCommits(program, connection, s1.sig))
        .commits[0];
      offchain(
        S,
        "1-leaf batch verifies with an empty path",
        true,
        verifyBatchCommitEndToEnd({
          authority: a,
          batch: c1,
          memo: one[0].memo,
          alpha: one[0].alpha,
          proof: one[0].proof,
          index: 0,
          path: [],
        }).valid,
      );

      const big = rolls("b4096", 4096, vrfA.sk);
      const b4096 = buildBatch(big.map((x) => batchLeafV1(x)));
      const s4096 = await ok(S, "4096-leaf batch", [
        await buildCommitBatchEventIx(program, rpc, {
          owner: payer.publicKey,
          label: labelA,
          root: b4096.root,
          count: 4096,
        }),
      ]);
      const c4096 = (await findBatchCommits(program, connection, s4096.sig))
        .commits[0];
      const sample = [0, 1, 1023, 2047, 2048, 3001, 4094, 4095];
      offchain(
        S,
        `4096-leaf batch: indices ${sample.join(",")} verify (12-node paths)`,
        true,
        sample.every(
          (i) =>
            b4096.path(i).length === 12 &&
            verifyBatchCommitEndToEnd({
              authority: a,
              batch: c4096,
              memo: big[i].memo,
              alpha: big[i].alpha,
              proof: big[i].proof,
              index: i,
              path: b4096.path(i),
            }).valid,
        ),
      );

      const root = sha256(new TextEncoder().encode(`${tag}-root`));
      await ok(S, "count 2^20 accepted", [
        await batchEventIx(payer.publicKey, authA, labelA, root, 1 << 20),
      ]);
      const twice = await ok(S, "two commits in one transaction", [
        await batchEventIx(payer.publicKey, authA, labelA, root, 2),
        await batchEventIx(payer.publicKey, authA, labelA, sha256(root), 3),
      ]);
      offchain(
        S,
        "findBatchCommits returns both commits of that transaction",
        true,
        (await findBatchCommits(program, connection, twice.sig)).commits
          .length === 2,
      );
      await ok(S, "the same root committed again (allowed, no uniqueness)", [
        await batchEventIx(payer.publicKey, authA, labelA, root, 2),
      ]);

      failedBatchSig = (
        await fails(
          S,
          "count 0",
          [await batchEventIx(payer.publicKey, authA, labelA, root, 0)],
          E.EmptyBatch,
        )
      ).sig;
      await fails(
        S,
        "count 2^20 + 1",
        [
          await batchEventIx(
            payer.publicKey,
            authA,
            labelA,
            root,
            (1 << 20) + 1,
          ),
        ],
        E.BatchTooLarge,
      );
      await fails(
        S,
        "leaf_version 0",
        [await batchEventIx(payer.publicKey, authA, labelA, root, 3, 0)],
        E.UnsupportedLeafVersion,
      );
      await fails(
        S,
        "leaf_version 2",
        [await batchEventIx(payer.publicKey, authA, labelA, root, 3, 2)],
        E.UnsupportedLeafVersion,
      );
      await fails(
        S,
        "zero root",
        [
          await batchEventIx(
            payer.publicKey,
            authA,
            labelA,
            new Uint8Array(32),
            3,
          ),
        ],
        E.ZeroBatchRoot,
      );
      await fails(
        S,
        "unfrozen authority",
        [await batchEventIx(payer.publicKey, authU, labelU, root, 3)],
        E.AuthorityNotFrozen,
      );
      await fails(
        S,
        "signed by a stranger",
        [await batchEventIx(stranger.publicKey, authA, labelA, root, 3)],
        E.NotOwner,
        {
          signers: [stranger],
        },
      );
      await fails(
        S,
        "label that is not the authority's",
        [await batchEventIx(payer.publicKey, authA, `${tag}-zz`, root, 3)],
        E.AuthorityLabelMismatch,
      );
      await fails(
        S,
        "authority address meta tampered",
        [
          await batchEventIx(
            payer.publicKey,
            authA,
            labelA,
            root,
            3,
            1,
            (m) => {
              m.address[0] ^= 1;
            },
          ),
        ],
        E.AuthorityAddressMismatch,
      );

      const forged = await land([
        await batchEventIx(
          payer.publicKey,
          authA,
          labelA,
          root,
          3,
          1,
          (_m, d) => {
            d.pk[0] ^= 1;
          },
        ),
      ]);
      const forgedCode = codeOf(forged.err);
      rec({
        section: S,
        label: "forged current_authority (pk byte flipped)",
        expected: "Light system program rejects",
        result: `error ${forgedCode}`,
        signature: forged.sig,
        cu: forged.cu,
        note:
          forged.logs.find((l) =>
            l.includes("SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7 failed"),
          ) ?? "",
      });
      expect(forged.err).not.toBeNull();
      expect(
        typeof forgedCode === "number" &&
          forgedCode >= 6000 &&
          forgedCode <= 6022,
      ).toBe(false);

      const none = await findBatchCommits(program, connection, failedBatchSig);
      offchain(
        S,
        "findBatchCommits on a failed transaction returns nothing",
        true,
        none.commits.length === 0 && !none.unfetched,
      );
    },
  );

  it(
    "root ring: init, 129 commits wrap, races, foreign and planted accounts",
    { timeout: 1_800_000 },
    async () => {
      const S = "ring";
      const ringA = deriveRootRingAddress(
        authA.authorityAddress,
        program.programId,
      );
      const ringB = deriveRootRingAddress(
        authB.authorityAddress,
        program.programId,
      );
      const ringU = deriveRootRingAddress(
        authU.authorityAddress,
        program.programId,
      );
      await fails(
        S,
        "init_root_ring, unfrozen authority",
        [await initRingIx(payer.publicKey, authU, labelU, ringU)],
        E.AuthorityNotFrozen,
      );
      await fails(
        S,
        "init_root_ring signed by a stranger",
        [await initRingIx(stranger.publicKey, authA, labelA, ringA)],
        E.NotOwner,
        { signers: [stranger] },
      );
      await ok(S, "init_root_ring", [
        await initRingIx(payer.publicKey, authA, labelA, ringA),
      ]);
      await fails(
        S,
        "init_root_ring again",
        [await initRingIx(payer.publicKey, authA, labelA, ringA)],
        E.SystemAccountInUse,
      );
      await ok(S, "init_root_ring (second authority)", [
        await initRingIx(payer.publicKey, authB, labelB, ringB),
      ]);

      const root = (seq: bigint) =>
        sha256(new TextEncoder().encode(`${tag}-ring-${seq}`));
      const sigs: Record<string, string> = {};
      for (let seq = 1n; seq <= 129n; seq++) {
        const r = await land([
          await ringCommitIx(
            payer.publicKey,
            authA,
            labelA,
            ringA,
            root(seq),
            Number(seq),
            seq,
          ),
        ]);
        expect(r.err, `seq ${seq}: ${JSON.stringify(r.err)}`).toBeNull();
        sigs[seq.toString()] = r.sig;
        if ([1n, 2n, 64n, 128n, 129n].includes(seq)) {
          rec({
            section: S,
            label: `commit_batch_ring seq ${seq}`,
            expected: "success",
            result: "success",
            signature: r.sig,
            cu: r.cu,
          });
        }
      }
      rec({
        section: S,
        label: "commit_batch_ring seq 1..129",
        expected: "all succeed",
        result: "all succeeded",
        note: "129 transactions",
      });
      const fetched = (await fetchRootRing(
        connection,
        authA.authorityAddress,
        program.programId,
      ))!;
      offchain(S, "next_seq is 130", true, fetched.ring.nextSeq === 130n);
      offchain(
        S,
        "seq 1 evicted by seq 129",
        true,
        rootRingEntry(fetched.data, 1n) === null,
      );
      let live = 0;
      for (let s = 2n; s <= 129n; s++) {
        const e = rootRingEntry(fetched.data, s);
        if (
          e &&
          bytesToHex(e.root) === bytesToHex(root(s)) &&
          e.count === Number(s)
        )
          live++;
      }
      offchain(
        S,
        "seqs 2..129 live with their own root and count",
        true,
        live === 128,
      );
      offchain(
        S,
        "seq 130 (not yet committed) is not live",
        true,
        rootRingEntry(fetched.data, 130n) === null,
      );
      for (const s of ["1", "64", "129"]) {
        const c = (await findBatchCommits(program, connection, sigs[s]))
          .commits[0];
        offchain(
          S,
          `event of seq ${s} carries ring_seq ${s}`,
          true,
          c.ringSeq === BigInt(s),
        );
      }

      await fails(
        S,
        "retry of seq 129",
        [
          await ringCommitIx(
            payer.publicKey,
            authA,
            labelA,
            ringA,
            root(129n),
            129,
            129n,
          ),
        ],
        E.RingSeqMismatch,
      );
      await fails(
        S,
        "skip ahead to seq 131",
        [
          await ringCommitIx(
            payer.publicKey,
            authA,
            labelA,
            ringA,
            root(131n),
            1,
            131n,
          ),
        ],
        E.RingSeqMismatch,
      );
      await fails(
        S,
        "commit into another authority's ring",
        [
          await ringCommitIx(
            payer.publicKey,
            authA,
            labelA,
            ringB,
            root(1n),
            1,
            1n,
          ),
        ],
        E.RingAuthorityMismatch,
      );
      await fails(
        S,
        "ring commit signed by a stranger",
        [
          await ringCommitIx(
            stranger.publicKey,
            authA,
            labelA,
            ringA,
            root(130n),
            1,
            130n,
          ),
        ],
        E.NotOwner,
        { signers: [stranger] },
      );
      await fails(
        S,
        "ring commit, count 0",
        [
          await ringCommitIx(
            payer.publicKey,
            authA,
            labelA,
            ringA,
            root(130n),
            0,
            130n,
          ),
        ],
        E.EmptyBatch,
      );
      await fails(
        S,
        "the IDL account (owned by cc-vrf) passed as the ring",
        [
          await ringCommitIx(
            payer.publicKey,
            authA,
            labelA,
            IDL_ACCOUNT,
            root(130n),
            1,
            130n,
          ),
        ],
        E.AccountDiscriminatorMismatch,
      );
      await fails(
        S,
        "a system-owned account passed as the ring",
        [
          await ringCommitIx(
            payer.publicKey,
            authA,
            labelA,
            payer.publicKey,
            root(130n),
            1,
            130n,
          ),
        ],
        E.AccountOwnedByWrongProgram,
      );

      // Race: two transactions claim seq 130 at once; exactly one may land.
      const [x, y] = await Promise.all([
        ringCommitIx(
          payer.publicKey,
          authA,
          labelA,
          ringA,
          root(1300n),
          1,
          130n,
        ),
        ringCommitIx(
          payer.publicKey,
          authA,
          labelA,
          ringA,
          root(1301n),
          1,
          130n,
        ),
      ]);
      const [rx, ry] = await Promise.all([land([x]), land([y])]);
      const outcomes = [codeOf(rx.err), codeOf(ry.err)];
      rec({
        section: S,
        label: "race: two commits claim seq 130",
        expected: "one success, one 6015",
        result: outcomes
          .map((o) => (o === null ? "success" : `error ${o}`))
          .join(" + "),
        signature: `${rx.sig}, ${ry.sig}`,
      });
      expect(outcomes.filter((o) => o === null)).toHaveLength(1);
      expect(outcomes.filter((o) => o === E.RingSeqMismatch)).toHaveLength(1);
      const after = (await fetchRootRing(
        connection,
        authA.authorityAddress,
        program.programId,
      ))!;
      offchain(
        S,
        "after the race next_seq is 131 and seq 130 holds the winner's root",
        true,
        after.ring.nextSeq === 131n &&
          [bytesToHex(root(1300n)), bytesToHex(root(1301n))].includes(
            bytesToHex(rootRingEntry(after.data, 130n)!.root),
          ),
      );
    },
  );

  it(
    "attest_possession: every spoof, then once",
    { timeout: 900_000 },
    async () => {
      const S = "attest";
      const msgA = possessionMessage(
        payer.publicKey,
        labelA,
        program.programId,
      );
      const A = { pk: vrfA.pk, sk: vrfA.sk };
      const other = generateKeyPair();
      const attest = await attestIx(payer.publicKey, authA, labelA);

      await fails(
        S,
        "no Ed25519 instruction",
        [attest],
        E.MissingEd25519Instruction,
      );
      await fails(
        S,
        "two Ed25519 instructions",
        [
          ed25519Ix(A.pk, msgA, edSign(A.sk, msgA)),
          ed25519Ix(A.pk, msgA, edSign(A.sk, msgA)),
          attest,
        ],
        E.MultipleEd25519Instructions,
      );
      await fails(
        S,
        "one Ed25519 instruction with two signatures",
        [ed25519TwoSigsIx(A, other, msgA), attest],
        E.MalformedEd25519Instruction,
      );
      // Instruction 0 is the compute budget limit; the carrier is instruction 1.
      await fails(
        S,
        "offsets point into another instruction",
        [...ed25519IndirectIxs(A, msgA, 1), attest],
        E.Ed25519IndirectReference,
      );
      await fails(
        S,
        "signed by a key that is not the authority's",
        [ed25519Ix(other.pk, msgA, edSign(other.sk, msgA)), attest],
        E.PossessionKeyMismatch,
      );
      for (const [at, field] of [
        [0, "domain"],
        [18, "program id"],
        [50, "owner"],
        [82, "label"],
        [113, "label end"],
      ] as const) {
        const m = Uint8Array.from(msgA);
        m[at] ^= 1;
        await fails(
          S,
          `message with the ${field} tampered`,
          [ed25519Ix(A.pk, m, edSign(A.sk, m)), attest],
          E.PossessionMessageMismatch,
        );
      }
      for (const [m, what] of [
        [msgA.slice(0, 32), "a 32-byte message"],
        [msgA.slice(0, 113), "113 bytes"],
        [Uint8Array.from([...msgA, 0]), "115 bytes"],
      ] as const) {
        await fails(
          S,
          `message of ${what}`,
          [ed25519Ix(A.pk, m, edSign(A.sk, m)), attest],
          E.PossessionMessageMismatch,
        );
      }
      const badSig = edSign(A.sk, msgA);
      badSig[5] ^= 1;
      const bad = await land([ed25519Ix(A.pk, msgA, badSig), attest]);
      rec({
        section: S,
        label: "bad signature (one byte flipped)",
        expected: "precompile rejects; cc-vrf never runs",
        result: bad.landed ? `error ${codeOf(bad.err)}` : "not landed",
        signature: bad.sig,
        cu: bad.cu,
        note: bad.logs.some((l) => l.includes(program.programId.toBase58()))
          ? "cc-vrf ran"
          : "cc-vrf did not run",
      });
      expect(bad.err === null && bad.landed).toBe(false);
      expect(
        bad.logs.some((l) => l.includes(program.programId.toBase58())),
      ).toBe(false);

      const msgU = possessionMessage(
        payer.publicKey,
        labelU,
        program.programId,
      );
      await fails(
        S,
        "unfrozen authority (valid signature)",
        [
          ed25519Ix(vrfU.pk, msgU, edSign(vrfU.sk, msgU)),
          await attestIx(payer.publicKey, authU, labelU),
        ],
        E.AuthorityNotFrozen,
      );
      const msgS = possessionMessage(
        stranger.publicKey,
        labelA,
        program.programId,
      );
      await fails(
        S,
        "a stranger presents a valid VRF signature for itself",
        [
          ed25519Ix(A.pk, msgS, edSign(A.sk, msgS)),
          await attestIx(stranger.publicKey, authA, labelA),
        ],
        E.NotOwner,
        { signers: [stranger] },
      );

      offchain(
        S,
        "nothing recorded before the honest attest",
        true,
        (await fetchPossession(
          connection,
          authA.authorityAddress,
          program.programId,
        )) === null,
      );
      // Fresh validity proof: a forester may have moved the authority into the tree since `attest` was built.
      await ok(S, "attest_possession", [
        ed25519Ix(A.pk, msgA, edSign(A.sk, msgA)),
        await attestIx(payer.publicKey, authA, labelA),
      ]);
      const p = (await fetchPossession(
        connection,
        authA.authorityAddress,
        program.programId,
      ))!;
      offchain(
        S,
        "recorded pk is the authority's VRF key",
        true,
        bytesToHex(p.pk) === bytesToHex(vrfA.pk),
      );
      await fails(
        S,
        "attest again",
        [
          ed25519Ix(A.pk, msgA, edSign(A.sk, msgA)),
          await attestIx(payer.publicKey, authA, labelA),
        ],
        E.SystemAccountInUse,
      );
    },
  );

  (AGED_LABEL ? it : it.skip)(
    "aged authority (ZK path): CU and the compute limit it needs",
    { timeout: 600_000 },
    async () => {
      const S = "aged";
      const aged = await auth(payer.publicKey, AGED_LABEL!);
      const ctx = await ctxFor(aged);
      rec({
        section: S,
        label: "proof path",
        expected: "ZK (proveByIndex false)",
        result: ctx.authorityReadOnlyMeta.treeInfo.proveByIndex
          ? "by index"
          : "ZK",
      });
      const root = sha256(new TextEncoder().encode(`${tag}-aged`));
      await fails(
        S,
        "commit_batch_event with a 100k CU limit",
        [await batchEventIx(payer.publicKey, aged, AGED_LABEL!, root, 1)],
        "ComputationalBudgetExceeded",
        { cu: 100_000 },
      );
      await ok(
        S,
        "commit_batch_event with a 130k CU limit",
        [await batchEventIx(payer.publicKey, aged, AGED_LABEL!, root, 1)],
        { cu: 130_000 },
      );
    },
  );

  (PINNED ? it : it.skip)(
    "commits made before the upgrade still verify",
    { timeout: 600_000 },
    async () => {
      const pins = JSON.parse(fs.readFileSync(PINNED!, "utf8")) as {
        mode: string;
        owner: string;
        label: string;
        memo: string;
        alpha: string;
        proof: string;
        signature?: string;
      }[];
      for (const p of pins) {
        const owner = new PublicKey(p.owner);
        const pa = await auth(owner, p.label);
        const base = {
          authority: pa.onChainAuthority,
          alpha: hexToBytes(p.alpha),
          proof: hexToBytes(p.proof),
          memo: p.memo,
          expectedOwner: owner,
        };
        let valid = false;
        if (p.mode === "event") {
          const { events } = await findProofCommitEvents(
            program,
            connection,
            owner,
            p.label,
            p.memo,
            { signature: p.signature },
          );
          const c = pickCanonicalCommit(
            events.map((e) => e.onChainCommit),
            base.proof,
          ).canonical;
          valid =
            !!c &&
            verifyAuthorityCommitEndToEnd({ ...base, onChainCommit: c }).valid;
        } else if (p.mode === "beta") {
          const c = await fetchProofCommitWithBeta(
            program,
            rpc,
            pa.authorityAddress,
            p.memo,
          );
          valid =
            !!c &&
            verifyAuthorityCommitEndToEnd({
              ...base,
              onChainCommit: c.onChainCommit,
              onChainBeta: c.beta,
            }).valid;
        } else {
          const c = await fetchProofCommit(
            program,
            rpc,
            pa.authorityAddress,
            p.memo,
          );
          valid =
            !!c &&
            verifyAuthorityCommitEndToEnd({
              ...base,
              onChainCommit: c.onChainCommit,
            }).valid;
        }
        offchain(
          "pins",
          `${p.mode} ${p.memo}`,
          true,
          valid,
          p.signature ? `committed in ${p.signature}` : "2026-05-14",
        );
      }
    },
  );
});
