import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { loadState, saveState, statePath } from "../src/state";

/**
 * Pure-state-file tests for the demo CLI. End-to-end on-chain tests live in
 * smoke-test.ts (gated on a live RPC + payer; see README).
 */
describe("dice-demo state file", () => {
  const backupPath = path.join(os.tmpdir(), "cc-vrf-demo-test-backup.json");
  let hadExistingState = false;

  beforeAll(() => {
    if (fs.existsSync(statePath())) {
      fs.copyFileSync(statePath(), backupPath);
      fs.unlinkSync(statePath());
      hadExistingState = true;
    }
  });

  afterAll(() => {
    if (hadExistingState) {
      fs.mkdirSync(path.dirname(statePath()), { recursive: true });
      fs.copyFileSync(backupPath, statePath());
      fs.unlinkSync(backupPath);
    } else if (fs.existsSync(statePath())) {
      fs.unlinkSync(statePath());
    }
  });

  it("returns a default state when no file exists", () => {
    const s = loadState();
    expect(s.label).toBe("dice-demo");
    expect(s.rolls).toEqual([]);
    expect(s.vrfSk).toBeUndefined();
  });

  it("round-trips through save/load", () => {
    saveState({
      label: "test-label",
      vrfSk: "abcd",
      vrfPk: "1234",
      rolls: [
        {
          memo: "test-memo",
          alpha: "aa",
          proof: "bb",
          beta: "cc",
          rollValue: 42,
          commitAddressBase58: "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS",
          committedAtIso: new Date().toISOString(),
        },
      ],
    });
    const back = loadState();
    expect(back.label).toBe("test-label");
    expect(back.vrfSk).toBe("abcd");
    expect(back.rolls).toHaveLength(1);
    expect(back.rolls[0].rollValue).toBe(42);
  });
});
