import { describe, expect, it } from "vitest";
import { ownProgramDataLines } from "../src";

// Event logs only count when the cc-vrf program wrote them: any program can print the same bytes.
const CCVRF = "ccvrfu3fSpbnPLiUqdWAt85Zn9nq96ekwGTbHqGtdgQ";
const LIGHT = "SySTEM1eSU2p4BGQfQpimFEWWSC1XDFeun3Nqzz3rT7";
const OTHER = "AttackerProgram1111111111111111111111111111";
const BUDGET = "ComputeBudget111111111111111111111111111111";

describe("ownProgramDataLines", () => {
  it("keeps a data line written by the program, after its CPI returns", () => {
    const logs = [
      `Program ${BUDGET} invoke [1]`,
      `Program ${BUDGET} success`,
      `Program ${CCVRF} invoke [1]`,
      "Program log: Instruction: CommitProofEvent",
      `Program ${LIGHT} invoke [2]`,
      "Program data: bGlnaHQ=",
      `Program ${LIGHT} consumed 102528 of 232505 compute units`,
      `Program ${LIGHT} success`,
      "Program data: Y2N2cmY=",
      `Program ${CCVRF} consumed 121076 of 249850 compute units`,
      `Program ${CCVRF} success`,
    ];
    expect(ownProgramDataLines(logs, CCVRF)).toEqual(["Y2N2cmY="]);
  });

  it("drops the same bytes printed by another program", () => {
    const logs = [
      `Program ${OTHER} invoke [1]`,
      "Program data: Y2N2cmY=",
      `Program ${OTHER} success`,
    ];
    expect(ownProgramDataLines(logs, CCVRF)).toEqual([]);
  });

  it("drops another program's data printed after a real cc-vrf call in the same tx", () => {
    const logs = [
      `Program ${CCVRF} invoke [1]`,
      "Program data: cmVhbA==",
      `Program ${CCVRF} success`,
      `Program ${OTHER} invoke [1]`,
      "Program data: ZmFrZQ==",
      `Program ${OTHER} success`,
    ];
    expect(ownProgramDataLines(logs, CCVRF)).toEqual(["cmVhbA=="]);
  });

  it("ignores program log lines shaped like invoke / success lines", () => {
    const logs = [
      `Program ${CCVRF} invoke [1]`,
      `Program ${CCVRF} success`,
      `Program ${OTHER} invoke [1]`,
      "Program log: success",
      `Program log: ${CCVRF} invoke [2]`,
      "Program log: invoke [1]",
      "Program data: ZmFrZQ==",
      `Program ${OTHER} success`,
    ];
    expect(ownProgramDataLines(logs, CCVRF)).toEqual([]);
  });

  it("returns nothing when the logs are empty or truncated", () => {
    expect(ownProgramDataLines([], CCVRF)).toEqual([]);
    expect(
      ownProgramDataLines(
        [`Program ${CCVRF} invoke [1]`, "Log truncated"],
        CCVRF,
      ),
    ).toEqual([]);
  });
});
