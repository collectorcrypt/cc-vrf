import { useState } from "react";
import { PublicKey } from "@solana/web3.js";
import { bytesToHex, fetchAuthority } from "@collector-crypt/vrf-client";
import {
  defaultRpcForCluster,
  explorerAddressUrlFor,
  type Cluster,
} from "../data/constants";
import { buildReadOnlyProgram } from "../wallet/ReadonlyProgram";

type AuthorityRow = {
  authorityAddress: string;
  owner: string;
  pkHex: string;
  suite: number;
  frozen: boolean;
  revoked: boolean;
  label: string;
  labelHex: string;
};

export function LookupPage() {
  const [cluster, setCluster] = useState<Cluster>("mainnet");
  const [rpcUrl, setRpcUrl] = useState<string>(defaultRpcForCluster("mainnet"));
  const [owner, setOwner] = useState("");
  const [label, setLabel] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AuthorityRow | null>(null);
  const [notFound, setNotFound] = useState(false);

  function setClusterAndRpc(next: Cluster) {
    setCluster(next);
    setRpcUrl(defaultRpcForCluster(next));
  }

  async function lookup(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setNotFound(false);
    setLoading(true);
    try {
      let ownerPk: PublicKey;
      try {
        ownerPk = new PublicKey(owner.trim());
      } catch {
        throw new Error(
          "invalid owner pubkey (must be a base58 Solana address)",
        );
      }
      if (!label.trim()) throw new Error("label is required");

      const { program, rpc } = buildReadOnlyProgram(rpcUrl);
      const auth = await fetchAuthority(program, rpc, ownerPk, label);
      if (!auth) {
        setNotFound(true);
        return;
      }
      const labelBytes = Uint8Array.from(auth.decoded.label);
      // Strip trailing zero padding when rendering the label as a UTF-8 string.
      let end = labelBytes.length;
      while (end > 0 && labelBytes[end - 1] === 0) end--;
      const labelStr = new TextDecoder().decode(labelBytes.slice(0, end));
      setResult({
        authorityAddress: auth.authorityAddress.toBase58(),
        owner: auth.decoded.owner.toBase58(),
        pkHex: bytesToHex(Uint8Array.from(auth.decoded.pk)),
        suite: auth.decoded.suite,
        frozen: auth.decoded.frozen,
        revoked: auth.decoded.revoked,
        label: labelStr,
        labelHex: bytesToHex(labelBytes),
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
          Operator lookup
        </h1>
        <p className="max-w-3xl text-lg text-ink-300">
          Look up any VRF authority by its{" "}
          <code className="font-mono text-ink-100">(owner, label)</code> pair.
          Confirm the operator&rsquo;s public key, suite, and lifecycle flags
          before you trust their proofs.
        </p>
      </section>

      <section className="container-wide flex flex-col gap-4">
        <form onSubmit={lookup} className="card flex flex-col gap-4">
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
              placeholder="https://your-photon-rpc/..."
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">
              Owner pubkey
            </span>
            <input
              type="text"
              value={owner}
              onChange={(e) => setOwner(e.target.value)}
              className="rounded-md border border-ink-800 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
              placeholder="e.g. daxsSgG4iPvhxWr2jrY76HKtRSjWjQLFveKHdmZKJFc"
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
              placeholder="e.g. my-app"
              required
            />
          </label>

          <button
            type="submit"
            className="btn-primary self-start"
            disabled={loading}
          >
            {loading ? "looking up…" : "look up authority"}
          </button>

          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}
          {notFound && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
              No authority found for that (owner, label) on{" "}
              <span className="font-mono">{cluster}</span>. Either the operator
              hasn&rsquo;t initialized yet, or the inputs don&rsquo;t match.
            </div>
          )}
        </form>

        {result && (
          <div className="card flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-xl font-semibold text-ink-50">Authority</h2>
              <span
                className={
                  result.frozen
                    ? "rounded-full bg-emerald-500/15 px-3 py-0.5 text-xs font-mono text-emerald-300"
                    : "rounded-full bg-amber-500/15 px-3 py-0.5 text-xs font-mono text-amber-300"
                }
              >
                {result.frozen ? "frozen" : "unfrozen"}
              </span>
              {result.revoked && (
                <span className="rounded-full bg-red-500/15 px-3 py-0.5 text-xs font-mono text-red-300">
                  revoked
                </span>
              )}
              <span className="rounded-full bg-ink-800 px-3 py-0.5 text-xs font-mono text-ink-300">
                suite 0x{result.suite.toString(16).padStart(2, "0")}{" "}
                (Ed25519-SHA512-TAI)
              </span>
            </div>
            <dl className="grid gap-3 text-sm sm:grid-cols-[140px_1fr]">
              <Field label="Authority address">
                <a
                  href={explorerAddressUrlFor(result.authorityAddress, cluster)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-accent-300 hover:underline"
                >
                  {result.authorityAddress}
                </a>
              </Field>
              <Field label="Owner">
                <a
                  href={explorerAddressUrlFor(result.owner, cluster)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all font-mono text-accent-300 hover:underline"
                >
                  {result.owner}
                </a>
              </Field>
              <Field label="Label">
                <div className="break-all">
                  <span className="font-mono text-ink-100">{result.label}</span>
                  <span className="ml-3 font-mono text-xs text-ink-500">
                    0x{result.labelHex}
                  </span>
                </div>
              </Field>
              <Field label="Public key">
                <span className="break-all font-mono text-xs text-ink-200">
                  {result.pkHex}
                </span>
              </Field>
              <Field label="Suite">
                <span className="font-mono text-ink-200">
                  0x{result.suite.toString(16).padStart(2, "0")} &mdash;
                  ECVRF-EDWARDS25519-SHA512-TAI
                </span>
              </Field>
              <Field label="Frozen">
                <span
                  className={
                    result.frozen ? "text-emerald-300" : "text-amber-300"
                  }
                >
                  {String(result.frozen)}
                </span>{" "}
                <span className="text-xs text-ink-500">
                  {result.frozen
                    ? "(pk and suite are permanent — safe to trust)"
                    : "(pk can still rotate — wait for freeze before trusting commits)"}
                </span>
              </Field>
              <Field label="Revoked">
                <span
                  className={result.revoked ? "text-red-300" : "text-ink-200"}
                >
                  {String(result.revoked)}
                </span>{" "}
                <span className="text-xs text-ink-500">
                  {result.revoked
                    ? "(operator marked this authority retired — historical proofs still verify)"
                    : "(active)"}
                </span>
              </Field>
            </dl>
            <div className="border-t border-ink-800 pt-3 text-xs text-ink-400">
              Next: paste a memo + proof on the{" "}
              <a href="#/verify" className="text-accent-300 hover:underline">
                verifier page
              </a>{" "}
              to confirm a specific roll was actually emitted by this authority.
            </div>
          </div>
        )}
      </section>

      <section className="container-wide flex flex-col gap-3 text-sm text-ink-400">
        <p>
          <strong className="text-ink-200">Why this matters:</strong> the
          authority record is the trust anchor. Once it&rsquo;s frozen, the
          operator can&rsquo;t silently rotate to a different secret key &mdash;
          every subsequent proof must verify against the same{" "}
          <code className="font-mono text-ink-200">pk</code> you see here.
        </p>
      </section>
    </main>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-xs font-semibold uppercase tracking-wider text-ink-400">
        {label}
      </dt>
      <dd className="text-ink-100">{children}</dd>
    </>
  );
}
