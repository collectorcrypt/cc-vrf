import { useMemo, useState } from "react";
import {
  bytesToHex,
  generateKeyPair,
  proveVRF,
  verifyVRF,
  vrfProofToHash,
} from "@collectorcrypt/ecvrf";
import { sha256 } from "@noble/hashes/sha2.js";
import { CodeBlock } from "../components/CodeBlock";

type Roll = {
  pkHex: string;
  alphaHex: string;
  proofHex: string;
  betaHex: string;
  ecvrfValid: boolean;
  rollValue: number;
  memo: string;
};

const SAMPLE_CODE = `import {
  generateKeyPair,
  proveVRF,
  verifyVRF,
  vrfProofToHash,
} from "@collectorcrypt/ecvrf";
import { sha256 } from "@noble/hashes/sha2.js";

const { sk, pk } = generateKeyPair();
const memo = \`game-\${Date.now()}\`;
const alpha = sha256(new TextEncoder().encode(memo));

// 1. Prove (operator side, with the secret key).
const { proof } = proveVRF(sk, alpha);

// 2. Verify (anyone, just the public key).
const valid = verifyVRF(pk, alpha, proof);
const beta = vrfProofToHash(proof);

// 3. Deterministically map beta to your roll/game outcome.
const roll = Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1;`;

export function ClientDemo() {
  const initialKeypair = useMemo(() => generateKeyPair(), []);
  const [sk, setSk] = useState<Uint8Array>(initialKeypair.sk);
  const [pk, setPk] = useState<Uint8Array>(initialKeypair.pk);
  const [memo, setMemo] = useState<string>(
    `demo-${new Date().toISOString().slice(0, 19)}`,
  );
  const [latest, setLatest] = useState<Roll | null>(null);
  const [history, setHistory] = useState<Roll[]>([]);
  const [running, setRunning] = useState(false);

  function regenerateKeypair() {
    const kp = generateKeyPair();
    setSk(kp.sk);
    setPk(kp.pk);
    setLatest(null);
    setHistory([]);
  }

  function doRoll() {
    setRunning(true);
    try {
      const alpha = sha256(new TextEncoder().encode(memo));
      const { proof } = proveVRF(sk, alpha);
      const beta = vrfProofToHash(proof);
      const ecvrfValid = verifyVRF(pk, alpha, proof);
      const rollValue =
        Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1;
      const next: Roll = {
        pkHex: bytesToHex(pk),
        alphaHex: bytesToHex(alpha),
        proofHex: bytesToHex(proof),
        betaHex: bytesToHex(beta),
        ecvrfValid,
        rollValue,
        memo,
      };
      setLatest(next);
      setHistory((prev) => [next, ...prev].slice(0, 5));
      setMemo(
        `demo-${new Date().toISOString().slice(0, 19)}-${Math.random()
          .toString(36)
          .slice(2, 6)}`,
      );
    } finally {
      setRunning(false);
    }
  }

  return (
    <section className="container-wide flex flex-col gap-8" id="client-demo">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Demo 1 &middot; pure client-side
        </span>
        <h2 className="section-title">
          Verifiable randomness, generated in your browser.
        </h2>
        <p className="max-w-3xl text-ink-300">
          This demo runs <code className="font-mono">@collectorcrypt/ecvrf</code>{" "}
          directly in your browser &mdash; no wallet, no chain, no server. Each
          click generates an RFC 9381 proof from the in-memory keypair, runs
          the verifier on it, and shows the resulting beta. Identical math to
          what an operator would publish; the only thing missing is the
          on-chain commit.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="subsection-title">Controls</h3>
            <button className="btn-ghost" onClick={regenerateKeypair}>
              new keypair
            </button>
          </div>
          <label className="flex flex-col gap-1 text-sm text-ink-300">
            memo (anything; hashes to alpha)
            <input
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
            />
          </label>
          <button
            className="btn-primary self-start"
            onClick={doRoll}
            disabled={running || memo.length === 0}
          >
            Roll &amp; verify
          </button>
          <dl className="kv">
            <dt>pk</dt>
            <dd>{bytesToHex(pk)}</dd>
            <dt>sk (demo-only)</dt>
            <dd className="text-ink-400">
              {bytesToHex(sk).slice(0, 16)}&hellip; (never leaves the browser)
            </dd>
          </dl>
        </div>

        <div className="card flex flex-col gap-4">
          <h3 className="subsection-title">Latest result</h3>
          {!latest && (
            <p className="text-sm text-ink-400">
              Click <span className="font-mono">Roll &amp; verify</span> to
              generate one.
            </p>
          )}
          {latest && (
            <>
              <div className="flex items-center gap-3">
                <span className="text-5xl font-semibold text-accent-400">
                  {latest.rollValue}
                </span>
                <span className="text-sm text-ink-400">/ 100</span>
                <span
                  className={
                    "pill ml-auto " +
                    (latest.ecvrfValid
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-red-500/40 text-red-300")
                  }
                >
                  {latest.ecvrfValid ? "ecvrf-valid" : "ecvrf-INVALID"}
                </span>
              </div>
              <dl className="kv">
                <dt>memo</dt>
                <dd>{latest.memo}</dd>
                <dt>alpha</dt>
                <dd>{shorten(latest.alphaHex)}</dd>
                <dt>proof (80 B)</dt>
                <dd>{shorten(latest.proofHex)}</dd>
                <dt>beta (64 B)</dt>
                <dd>{shorten(latest.betaHex)}</dd>
              </dl>
            </>
          )}
        </div>
      </div>

      {history.length > 1 && (
        <div className="card flex flex-col gap-2">
          <h3 className="subsection-title text-sm">Last {history.length} rolls</h3>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {history.map((r, i) => (
              <div
                key={i}
                className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 text-center"
              >
                <div className="text-2xl font-semibold text-accent-400">
                  {r.rollValue}
                </div>
                <div className="font-mono text-[10px] text-ink-400">
                  {r.memo.slice(-8)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        <h3 className="subsection-title text-sm">The whole code</h3>
        <CodeBlock code={SAMPLE_CODE} />
      </div>
    </section>
  );
}

function shorten(hex: string): string {
  if (hex.length <= 32) return hex;
  return `${hex.slice(0, 16)}…${hex.slice(-16)}`;
}
