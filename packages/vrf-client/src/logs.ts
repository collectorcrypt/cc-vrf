import { BorshCoder, Program, utils } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  VersionedTransactionResponse,
} from "@solana/web3.js";

const BASE58_ID = "[1-9A-HJ-NP-Za-km-z]{32,44}";
const INVOKE_RE = new RegExp(`^Program (${BASE58_ID}) invoke \\[\\d+\\]$`);
const EXIT_RE = new RegExp(`^Program (${BASE58_ID}) (success|failed)`);
const DATA_RE = /^Program data: (\S+)$/;

/**
 * The `Program data:` payloads written while `programId` was the executing
 * program, attributed by the runtime's invoke / success / failed lines. A
 * program's own output is prefixed `Program log:` or `Program data:`, so it
 * cannot fake those lines; any program can print event bytes, though, so a
 * verifier must ignore data lines written under another program.
 */
export function ownProgramDataLines(
  logMessages: string[],
  programId: string,
): string[] {
  const stack: string[] = [];
  const out: string[] = [];
  for (const line of logMessages) {
    const invoke = INVOKE_RE.exec(line);
    if (invoke) {
      stack.push(invoke[1]);
      continue;
    }
    if (EXIT_RE.test(line)) {
      stack.pop();
      continue;
    }
    const data = DATA_RE.exec(line);
    if (data && stack[stack.length - 1] === programId) out.push(data[1]);
  }
  return out;
}

export interface DecodedEvent {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
}

export interface DecodedInstruction {
  name: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data: any;
  /** Account 0 of the instruction: the owner signer (the program checked it, the tx succeeded). */
  owner: PublicKey;
}

/**
 * Everything cc-vrf wrote in one successful transaction: its own events (by log attribution) and its own
 * instructions, top-level and inner (CPI), decoded with the IDL. A failed transaction yields nothing.
 * Events come from `Program data:` lines directly: Anchor's EventParser also tries `Program log: Instruction:` lines
 * and aborts the whole parse on them.
 */
export function decodeCcVrfTransaction(
  program: Program,
  tx: VersionedTransactionResponse,
): { events: DecodedEvent[]; instructions: DecodedInstruction[] } {
  if (!tx.meta || tx.meta.err) return { events: [], instructions: [] };
  const coder = new BorshCoder(program.idl);
  const events: DecodedEvent[] = [];
  for (const b64 of ownProgramDataLines(
    tx.meta.logMessages ?? [],
    program.programId.toBase58(),
  )) {
    try {
      const ev = coder.events.decode(b64);
      if (ev) events.push(ev as DecodedEvent);
    } catch {
      /* not one of our events */
    }
  }

  const instructions: DecodedInstruction[] = [];
  let keys;
  try {
    keys = tx.transaction.message.getAccountKeys({
      accountKeysFromLookups: tx.meta.loadedAddresses,
    });
  } catch {
    return { events, instructions };
  }
  const take = (
    programIdIndex: number,
    accounts: number[],
    data: Uint8Array,
  ) => {
    if (!keys.get(programIdIndex)?.equals(program.programId)) return;
    let decoded;
    try {
      decoded = coder.instruction.decode(Buffer.from(data));
    } catch {
      return;
    }
    const owner = keys.get(accounts[0]);
    if (decoded && owner)
      instructions.push({ ...decoded, owner } as DecodedInstruction);
  };
  for (const ix of tx.transaction.message.compiledInstructions) {
    take(ix.programIdIndex, ix.accountKeyIndexes, ix.data);
  }
  for (const group of tx.meta.innerInstructions ?? []) {
    for (const ix of group.instructions) {
      take(ix.programIdIndex, ix.accounts, utils.bytes.bs58.decode(ix.data));
    }
  }
  return { events, instructions };
}

/** Event / instruction names as Anchor may spell them (IDL snake_case or coder camelCase). */
export function nameIs(name: string, snake: string): boolean {
  const camel = snake.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
  const pascal = camel.charAt(0).toUpperCase() + camel.slice(1);
  return name === snake || name === camel || name === pascal;
}

/** getTransaction that treats an RPC failure (retention gap, throttling) as a miss instead of throwing. */
export async function tryGetTransaction(
  connection: Connection,
  signature: string,
): Promise<VersionedTransactionResponse | null> {
  try {
    return await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
  } catch {
    return null;
  }
}
