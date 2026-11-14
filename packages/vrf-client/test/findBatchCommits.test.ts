import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AnchorProvider, BN, BorshCoder, utils } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  CC_VRF_PROGRAM_ID,
  encodeLabel,
  findBatchCommits,
  findProofCommitEvents,
  getProgram,
} from "../src";

const program = getProgram(
  new AnchorProvider(new Connection("http://127.0.0.1:8899"), {
    publicKey: Keypair.generate().publicKey,
    signTransaction: async (t) => t,
    signAllTransactions: async (t) => t,
  }),
);
const coder = new BorshCoder(program.idl);
const owner = Keypair.generate().publicKey;
const outer = Keypair.generate().publicKey;
const label = encodeLabel("gacha");
const root = new Uint8Array(32).fill(9);

function ixData(name: string, extra: Record<string, unknown>): Buffer {
  return coder.instruction.encode(name, {
    label: Array.from(label),
    root: Array.from(root),
    count: 7,
    leafVersion: 1,
    proof: { 0: null },
    authorityAccountMeta: {
      treeInfo: {
        rootIndex: 0,
        proveByIndex: true,
        merkleTreePubkeyIndex: 0,
        queuePubkeyIndex: 1,
        leafIndex: 0,
      },
      address: Array.from(new Uint8Array(32)),
    },
    currentAuthority: {
      owner,
      pk: Array.from(new Uint8Array(32)),
      suite: 3,
      frozen: true,
      revoked: false,
      label: Array.from(label),
      createdSlot: new BN(1),
    },
    ...extra,
  });
}

/** A successful tx whose only cc-vrf instruction is an inner (CPI) one and whose logs were dropped. */
function fakeTx(
  name: string,
  extra: Record<string, unknown>,
  err: unknown = null,
) {
  const keys = [outer, owner, CC_VRF_PROGRAM_ID, PublicKey.default];
  return {
    slot: 4242,
    meta: {
      err,
      logMessages: [],
      loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: [
        {
          index: 0,
          instructions: [
            {
              programIdIndex: 2,
              accounts: [1, 3],
              data: utils.bytes.bs58.encode(ixData(name, extra)),
            },
          ],
        },
      ],
    },
    transaction: {
      message: {
        getAccountKeys: () => ({ get: (i: number) => keys[i] }),
        compiledInstructions: [
          { programIdIndex: 3, accountKeyIndexes: [0], data: new Uint8Array() },
        ],
      },
    },
  };
}

const conn = (tx: unknown) =>
  ({ getTransaction: async () => tx }) as unknown as Connection;

describe("findBatchCommits", () => {
  it("falls back to an inner commit_batch_event instruction when the log is missing", async () => {
    const { commits, unfetched } = await findBatchCommits(
      program,
      conn(fakeTx("commitBatchEvent", {})),
      "sig",
    );
    expect(unfetched).toBe(false);
    expect(commits).toHaveLength(1);
    const c = commits[0];
    expect(c.owner.equals(owner)).toBe(true);
    expect([
      c.count,
      c.leafVersion,
      c.ringSeq,
      c.committedSlot,
      c.slot,
    ]).toEqual([7, 1, null, 4242n, 4242]);
    expect(c.root).toEqual(root);
    expect(c.label).toEqual(label);
  });

  it("reads the ring sequence from commit_batch_ring", async () => {
    const { commits } = await findBatchCommits(
      program,
      conn(fakeTx("commitBatchRing", { expectedSeq: new BN(77) })),
      "sig",
    );
    expect(commits[0].ringSeq).toBe(77n);
  });

  it("returns nothing for a failed tx, and flags an unfetchable one", async () => {
    expect(
      (
        await findBatchCommits(
          program,
          conn(fakeTx("commitBatchEvent", {}, { InstructionError: [0, "x"] })),
          "s",
        )
      ).commits,
    ).toEqual([]);
    expect(await findBatchCommits(program, conn(null), "s")).toEqual({
      commits: [],
      unfetched: true,
    });
  });
});

describe("findBatchCommits from the event log", () => {
  // VrfBatchCommitted bytes: discriminator, owner, label, root, count u32, leaf_version u8, ring_seq Option<u64>, slot u64.
  function eventLine(ringSeq: bigint | null): string {
    const parts: number[] = [
      ...Buffer.from("0b0cd05eb97ab7a2", "hex"),
      ...owner.toBytes(),
      ...label,
      ...root,
    ];
    const u = (n: bigint, bytes: number) =>
      Array.from({ length: bytes }, (_, i) =>
        Number((n >> BigInt(8 * i)) & 0xffn),
      );
    parts.push(...u(7n, 4), 1);
    parts.push(...(ringSeq === null ? [0] : [1, ...u(ringSeq, 8)]));
    parts.push(...u(123456n, 8));
    return Buffer.from(parts).toString("base64");
  }
  const id = CC_VRF_PROGRAM_ID.toBase58();
  const logTx = (line: string) => ({
    slot: 4243,
    meta: {
      err: null,
      logMessages: [
        `Program ${id} invoke [1]`,
        `Program data: ${line}`,
        `Program ${id} success`,
      ],
      loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: [],
    },
    transaction: {
      message: {
        getAccountKeys: () => ({ get: () => undefined }),
        compiledInstructions: [],
      },
    },
  });

  it("decodes commit_batch_event and commit_batch_ring events", async () => {
    const { commits } = await findBatchCommits(
      program,
      conn(logTx(eventLine(null))),
      "sig",
    );
    expect(commits).toHaveLength(1);
    const c = commits[0];
    expect(c.owner.equals(owner)).toBe(true);
    expect([
      c.count,
      c.leafVersion,
      c.ringSeq,
      c.committedSlot,
      c.slot,
    ]).toEqual([7, 1, null, 123456n, 4243]);
    expect(c.root).toEqual(root);
    const ring = await findBatchCommits(
      program,
      conn(logTx(eventLine(2n ** 40n + 5n))),
      "sig",
    );
    expect(ring.commits[0].ringSeq).toBe(2n ** 40n + 5n);
  });
});

describe("findProofCommitEvents (shared decoder)", () => {
  // The real mainnet commit_proof_event log line pinned by the program's wire tests.
  const fx = JSON.parse(
    readFileSync(
      join(
        __dirname,
        "../../../programs/cc-vrf/tests/fixtures/mainnet/commit-event.json",
      ),
      "utf8",
    ),
  );
  const gacha = new PublicKey("GachaNgyXTU3zFogQ8Z5jR2BLXs8215X2AtEH18VxJq3");
  const id = CC_VRF_PROGRAM_ID.toBase58();
  const logTx = (lines: string[], err: unknown = null) => ({
    slot: 99,
    meta: {
      err,
      logMessages: lines,
      loadedAddresses: { writable: [], readonly: [] },
      innerInstructions: [],
    },
    transaction: {
      message: {
        getAccountKeys: () => ({ get: () => undefined }),
        compiledInstructions: [],
      },
    },
  });

  it("decodes the mainnet event line under the program's own frame", async () => {
    const tx = logTx([
      `Program ${id} invoke [1]`,
      `Program data: ${fx.programData[0]}`,
      `Program ${id} success`,
    ]);
    const r = await findProofCommitEvents(
      program,
      conn(tx),
      gacha,
      "gacha",
      fx.memo,
      { signature: fx.signature },
    );
    expect(r.events).toHaveLength(1);
    expect(r.events[0].owner.equals(gacha)).toBe(true);
  });

  it("ignores the same bytes printed by another program, and a failed tx", async () => {
    const other = "AttackerProgram1111111111111111111111111111";
    const spoof = logTx([
      `Program ${other} invoke [1]`,
      `Program data: ${fx.programData[0]}`,
      `Program ${other} success`,
    ]);
    expect(
      (
        await findProofCommitEvents(
          program,
          conn(spoof),
          gacha,
          "gacha",
          fx.memo,
          { signature: "s" },
        )
      ).events,
    ).toEqual([]);
    const failed = logTx(
      [
        `Program ${id} invoke [1]`,
        `Program data: ${fx.programData[0]}`,
        `Program ${id} success`,
      ],
      { InstructionError: [0, "x"] },
    );
    expect(
      (
        await findProofCommitEvents(
          program,
          conn(failed),
          gacha,
          "gacha",
          fx.memo,
          { signature: "s" },
        )
      ).events,
    ).toEqual([]);
  });
});
