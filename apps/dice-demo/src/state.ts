import * as fs from "fs";
import * as os from "os";
import * as path from "path";

/**
 * Persistent demo state stored at ~/.cc-vrf-demo/state.json. Holds:
 *   - the demo VRF keypair (32-byte hex seed + derived 32-byte hex pk)
 *   - the demo authority label (string)
 *   - records of previously committed memos for the `verify` and `simulate`
 *     commands to look up after the fact
 */
export interface DemoState {
  vrfSk?: string;
  vrfPk?: string;
  label: string;
  programIdBase58?: string;
  ownerPubkeyBase58?: string;
  rolls: {
    memo: string;
    alpha: string;
    proof: string;
    beta: string;
    rollValue: number;
    commitAddressBase58: string;
    committedAtIso: string;
    /**
     * Which on-chain variant was used:
     *   - "pda": commit_proof (compressed PDA, off-chain verification)
     *   - "pda-beta": commit_proof_with_beta (PDA + on-chain beta for cross-program reads)
     *   - "event": commit_proof_event (event-only, no PDA)
     *   - "batch": one leaf of a commit_batch_event Merkle root
     *   - "ring": one leaf of a commit_batch_ring root (also kept in the root ring)
     * Defaults to "pda" for legacy rolls that pre-date this field.
     */
    mode?: "pda" | "pda-beta" | "event" | "batch" | "ring";
    /** Tx signature for event, batch and ring rolls (no deterministic address to look up). */
    txSignature?: string;
    /** Batch and ring rolls: the leaf's index and its RFC 9162 path (hex, leaf level first). */
    batchIndex?: number;
    batchPath?: string[];
    /** Ring rolls: the ring sequence the root was committed at. */
    ringSeq?: string;
  }[];
}

const DEFAULT_LABEL = "dice-demo";

export function stateDir(): string {
  return path.join(os.homedir(), ".cc-vrf-demo");
}

export function statePath(): string {
  return path.join(stateDir(), "state.json");
}

export function loadState(): DemoState {
  try {
    const raw = fs.readFileSync(statePath(), "utf8");
    const parsed = JSON.parse(raw) as DemoState;
    if (!parsed.label) parsed.label = DEFAULT_LABEL;
    if (!Array.isArray(parsed.rolls)) parsed.rolls = [];
    return parsed;
  } catch {
    return { label: DEFAULT_LABEL, rolls: [] };
  }
}

export function saveState(state: DemoState): void {
  fs.mkdirSync(stateDir(), { recursive: true });
  fs.writeFileSync(statePath(), JSON.stringify(state, null, 2));
}
