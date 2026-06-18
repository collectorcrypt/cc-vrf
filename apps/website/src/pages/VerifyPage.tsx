import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import {
  fetchAuthority,
  fetchProofCommit,
  fetchProofCommitEvents,
  fetchProofCommitWithBeta,
  hexToBytes,
  bytesToHex,
  pickCanonicalCommit,
  verifyAuthorityCommitEndToEnd,
  type VerifyAuthorityCommitEndToEndResult,
} from "@collector-crypt/vrf-client";
import {
  defaultRpcForCluster,
  explorerAddressUrlFor,
  type Cluster,
} from "../data/constants";
import { buildReadOnlyProgram } from "../wallet/ReadonlyProgram";

type Mode = "registry" | "registry-beta" | "event";

type VerifyOutcome = {
  result: VerifyAuthorityCommitEndToEndResult;
  authorityAddress: string;
  pkHex: string;
  betaHex: string | null;
  mode: Mode;
  duplicateMemoEvents?: boolean;
  candidateCount?: number;
};

export function VerifyPage() {
  const [cluster, setCluster] = useState<Cluster>("mainnet");
  const [rpcUrl, setRpcUrl] = useState<string>(defaultRpcForCluster("mainnet"));
  const [mode, setMode] = useState<Mode>("registry");
  const [owner, setOwner] = useState("");
  const [label, setLabel] = useState("");
  const [memo, setMemo] = useState("");
  const [proofHex, setProofHex] = useState("");
  const [alphaHex, setAlphaHex] = useState("");
  const [autoAlpha, setAutoAlpha] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<VerifyOutcome | null>(null);

  function setClusterAndRpc(next: Cluster) {
    setCluster(next);
    setRpcUrl(defaultRpcForCluster(next));
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setOutcome(null);
    setLoading(true);
    try {
      let ownerPk: PublicKey;
      try {
        ownerPk = new PublicKey(owner.trim());
      } catch {
        throw new Error("invalid owner pubkey");
      }
      if (!label.trim()) throw new Error("label is required");
      if (!memo) throw new Error("memo is required");

      let proof: Uint8Array;
      try {
        proof = hexToBytes(proofHex.trim());
      } catch {
        throw new Error("proof must be a hex string");
      }
      if (proof.length !== 80) {
        throw new Error(`proof must be 80 bytes (got ${proof.length})`);
      }

      const memoBytes = new TextEncoder().encode(memo);
      const alpha = autoAlpha
        ? sha256(memoBytes)
        : (() => {
            try {
              return hexToBytes(alphaHex.trim());
            } catch {
              throw new Error("alpha must be a hex string");
            }
          })();

      const { program, rpc, connection } = buildReadOnlyProgram(rpcUrl);
      const auth = await fetchAuthority(program, rpc, ownerPk, label);
      if (!auth) {
        throw new Error(
          `authority not found on ${cluster} for owner=${ownerPk.toBase58()} label="${label}"`,
        );
      }

      let onChainCommit;
      let onChainBeta: Uint8Array | undefined;
      let duplicateMemoEvents: boolean | undefined;
      let candidateCount: number | undefined;

      if (mode === "registry") {
        const c = await fetchProofCommit(
          program,
          rpc,
          auth.authorityAddress,
          memo,
        );
        if (!c) throw new Error("no PDA commit found for this memo");
        onChainCommit = c.onChainCommit;
      } else if (mode === "registry-beta") {
        const c = await fetchProofCommitWithBeta(
          program,
          rpc,
          auth.authorityAddress,
          memo,
        );
        if (!c) throw new Error("no PDA+beta commit found for this memo");
        onChainCommit = c.onChainCommit;
        onChainBeta = c.beta;
      } else {
        const events = await fetchProofCommitEvents(
          program,
          connection,
          ownerPk,
          label,
          memo,
        );
        candidateCount = events.length;
        if (events.length === 0)
          throw new Error("no commit_proof_event logs found for this memo");
        const picked = pickCanonicalCommit(
          events.map((e) => e.onChainCommit),
          proof,
        );
        duplicateMemoEvents = picked.duplicateMemoEvents;
        if (!picked.canonical) {
          throw new Error(
            `no event matched the provided proof (scanned ${events.length})`,
          );
        }
        onChainCommit = picked.canonical;
      }

      const result = verifyAuthorityCommitEndToEnd({
        authority: auth.onChainAuthority,
        expectedOwner: ownerPk,
        alpha,
        proof,
        memo,
        onChainCommit,
        onChainBeta,
      });

      setOutcome({
        result,
        authorityAddress: auth.authorityAddress.toBase58(),
        pkHex: bytesToHex(Uint8Array.from(auth.decoded.pk)),
        betaHex: result.beta ? bytesToHex(result.beta) : null,
        mode,
        duplicateMemoEvents,
        candidateCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex flex-col gap-12 pb-24 pt-12 sm:pt-20">
      <section className="container-wide flex flex-col gap-6">
        <a
          href="#/"
          className="text-xs font-semibold uppercase tracking-wider text-accent-500 hover:text-accent-400"
        >
          &larr; Back to overview
        </a>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
          Verify a roll
        </h1>
        <p className="max-w-3xl text-lg text-ink-300">
          Paste an operator&rsquo;s published proof and we&rsquo;ll fetch the
          on-chain commit, re-run the ECVRF math, and check every invariant.
          Green across the board means the random value provably came from the
          frozen public key you can see on the{" "}
          <a href="#/lookup" className="text-accent-300 hover:underline">
            lookup page
          </a>
          .
        </p>
      </section>

      <section className="container-wide flex flex-col gap-4">
        <form onSubmit={verify} className="card flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Cluster
            </span>
            <div className="flex rounded-md border border-ink-800 bg-ink-900/40 p-1 text-xs font-mono">
              {(["mainnet", "devnet"] as Cluster[]).map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setClusterAndRpc(c)}
                  className={
                    cluster === c
                      ? "rounded bg-accent-500 px-3 py-1 text-ink-950"
                      : "rounded px-3 py-1 text-ink-300 hover:text-ink-100"
                  }
                >
                  {c}
                </button>
              ))}
            </div>

            <span className="ml-4 text-xs font-semibold uppercase tracking-wider text-ink-400">
              Mode
            </span>
            <div className="flex rounded-md border border-ink-800 bg-ink-900/40 p-1 text-xs font-mono">
              {(
                [
                  ["registry", "registry"],
                  ["registry-beta", "registry+beta"],
                  ["event", "event"],
                ] as [Mode, string][]
              ).map(([m, lbl]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={
                    mode === m
                      ? "rounded bg-accent-500 px-3 py-1 text-ink-950"
                      : "rounded px-3 py-1 text-ink-300 hover:text-ink-100"
                  }
                >
                  {lbl}
                </button>
              ))}
            </div>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              RPC URL (Photon-capable)
            </span>
            <input
              type="text"
              value={rpcUrl}
              onChange={(e) => setRpcUrl(e.target.value)}
              className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
            />
          </label>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                Owner pubkey
              </span>
              <input
                type="text"
                value={owner}
                onChange={(e) => setOwner(e.target.value)}
                className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
                required
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                Label
              </span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
                required
              />
            </label>
          </div>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Memo
            </span>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
              placeholder="e.g. roll-12345"
              required
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Proof (80 bytes, hex)
            </span>
            <textarea
              value={proofHex}
              onChange={(e) => setProofHex(e.target.value)}
              rows={3}
              className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-xs text-ink-100 focus:border-accent-500 focus:outline-none"
              placeholder="160 hex chars (no 0x prefix or with — either is fine)"
              required
            />
          </label>

          <div className="flex flex-col gap-2">
            <label className="flex items-center gap-2 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={autoAlpha}
                onChange={(e) => setAutoAlpha(e.target.checked)}
              />
              alpha = sha256(memo) (standard convention)
            </label>
            {!autoAlpha && (
              <label className="flex flex-col gap-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
                  Alpha (hex)
                </span>
                <input
                  type="text"
                  value={alphaHex}
                  onChange={(e) => setAlphaHex(e.target.value)}
                  className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-xs text-ink-100 focus:border-accent-500 focus:outline-none"
                  required={!autoAlpha}
                />
              </label>
            )}
          </div>

          <button
            type="submit"
            className="btn-primary self-start"
            disabled={loading}
          >
            {loading ? "verifying…" : "verify"}
          </button>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}
        </form>

        {outcome && <Outcome outcome={outcome} cluster={cluster} />}
      </section>
    </main>
  );
}

function Outcome({
  outcome,
  cluster,
}: {
  outcome: VerifyOutcome;
  cluster: Cluster;
}) {
  const r = outcome.result;
  const checks: { label: string; ok: boolean | null; note?: string }[] = [
    { label: "Suite supported (0x03 TAI)", ok: r.suiteSupported },
    { label: "ECVRF math valid", ok: r.ecvrfValid },
    { label: "sha256(proof) == on-chain proof_hash", ok: r.proofHashMatches },
    { label: "sha256(alpha) == on-chain alpha_hash", ok: r.alphaHashMatches },
    { label: "sha256(memo)  == on-chain memo_hash", ok: r.memoHashMatches },
    { label: "Authority frozen", ok: r.authorityFrozen },
    { label: "Authority not revoked", ok: r.authorityNotRevoked },
    { label: "Authority owner matches", ok: r.authorityOwnerMatches },
    {
      label: "Commit bound to derived authority address",
      ok: r.commitAuthorityMatches,
    },
  ];
  if (outcome.mode === "registry-beta") {
    checks.push({
      label: "On-chain beta == vrfProofToHash(proof)",
      ok: r.betaMatches ?? null,
    });
  }
  return (
    <div
      className={
        r.valid
          ? "card border-emerald-500/40 bg-emerald-500/5"
          : "card border-red-500/40 bg-red-500/5"
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-2xl font-semibold text-ink-50">
          {r.valid ? "VALID" : "INVALID"}
        </h2>
        <span
          className={
            r.valid
              ? "rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-mono text-emerald-300"
              : "rounded-full bg-red-500/15 px-3 py-0.5 text-xs font-mono text-red-300"
          }
        >
          {outcome.mode} mode &middot; {cluster}
        </span>
        {outcome.duplicateMemoEvents && (
          <span className="rounded-full bg-amber-500/15 px-3 py-0.5 text-xs font-mono text-amber-300">
            {outcome.candidateCount} events for this memo &mdash; canonical
            picked via ECVRF math
          </span>
        )}
      </div>

      <ul className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
        {checks.map((c) => (
          <li key={c.label} className="flex items-center gap-2">
            <Pill ok={c.ok} />
            <span className="text-ink-200">{c.label}</span>
          </li>
        ))}
      </ul>

      <dl className="mt-6 grid gap-2 border-t border-ink-800 pt-4 text-xs sm:grid-cols-[140px_1fr]">
        <dt className="font-semibold uppercase tracking-wider text-ink-400">
          Authority address
        </dt>
        <dd>
          <a
            href={explorerAddressUrlFor(outcome.authorityAddress, cluster)}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all font-mono text-accent-300 hover:underline"
          >
            {outcome.authorityAddress}
          </a>
        </dd>
        <dt className="font-semibold uppercase tracking-wider text-ink-400">
          Authority pk
        </dt>
        <dd>
          <span className="break-all font-mono text-ink-200">
            {outcome.pkHex}
          </span>
        </dd>
        {outcome.betaHex && (
          <>
            <dt className="font-semibold uppercase tracking-wider text-ink-400">
              Beta (random value)
            </dt>
            <dd>
              <span className="break-all font-mono text-ink-200">
                {outcome.betaHex}
              </span>
            </dd>
          </>
        )}
      </dl>

      {!r.valid && r.reasons.length > 0 && (
        <div className="mt-4 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
          <div className="mb-1 font-semibold uppercase tracking-wider">
            Failure reasons
          </div>
          <ul className="font-mono">
            {r.reasons.map((reason, i) => (
              <li key={i}>&middot; {reason}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Pill({ ok }: { ok: boolean | null }) {
  if (ok === true)
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-300">
        ✓
      </span>
    );
  if (ok === false)
    return (
      <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-red-500/20 text-red-300">
        ✕
      </span>
    );
  return (
    <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-ink-800 text-ink-500">
      &mdash;
    </span>
  );
}
