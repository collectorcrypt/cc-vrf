import { CodeBlock } from "../components/CodeBlock";
import { GITHUB_URL } from "../data/constants";

export function EventsPage() {
  return (
    <main className="flex flex-col gap-16 pb-24 pt-12 sm:pt-20">
      <section className="container-wide flex flex-col gap-6">
        <a
          href="#/"
          className="text-xs font-semibold uppercase tracking-wider text-accent-500 hover:text-accent-400"
        >
          &larr; Back to overview
        </a>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
          Event mode
          <span className="text-ink-400"> &mdash; </span>
          <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
            commit_proof_event
          </span>
        </h1>
        <p className="max-w-3xl text-lg text-ink-300">
          Skip the compressed PDA. Each VRF call emits a{" "}
          <code className="font-mono text-ink-100">VrfProofCommitted</code> log
          event instead of writing a per-call commit PDA. It still proves the
          frozen authority read-only, so the commit path uses the same
          Photon-capable RPC setup as the other modes.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Per-call cost (devnet)"
            value="~$0.0009"
            sub="single tx, measured 2026-05-18"
          />
          <Stat label="Per 100k calls" value="~$90" sub="extrapolated" />
          <Stat label="vs registry mode" value="3.00x cheaper" sub="per call" />
        </div>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">The trade-off, in one line</h2>
        <div className="card flex flex-col gap-4">
          <p className="text-ink-100">
            <span className="text-accent-400 font-semibold">
              Registry mode:
            </span>{" "}
            the chain enforces &ldquo;one commit per memo.&rdquo; A careless
            verifier is still safe.
          </p>
          <p className="text-ink-100">
            <span className="text-accent-400 font-semibold">Event mode:</span>{" "}
            the chain accepts multiple events per memo. A careful verifier (one
            that runs ECVRF math) is still safe; a careless verifier that just
            picks &ldquo;the latest event&rdquo; can be misled.
          </p>
          <p className="text-sm text-ink-400">
            The real VRF proof is always recoverable from the event list, so
            there&rsquo;s no cryptographic fraud risk. The only exposure is a
            verifier that picks an event without checking the math.{" "}
            <code className="font-mono text-ink-100">
              verifyAuthorityCommitEndToEnd
            </code>{" "}
            and{" "}
            <code className="font-mono text-ink-100">pickCanonicalCommit</code>{" "}
            in the SDK do that check for you.
          </p>
        </div>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">
          What happens when an operator emits multiple events for the same memo?
        </h2>
        <p className="max-w-3xl text-ink-300">
          A malicious or buggy operator could emit two{" "}
          <code className="font-mono text-ink-100">VrfProofCommitted</code>{" "}
          events with the same{" "}
          <code className="font-mono text-ink-100">memo_hash</code> but
          different <code className="font-mono text-ink-100">proof_hash</code>{" "}
          values. The chain accepts both. Here&rsquo;s what each verifier
          strategy would conclude:
        </p>

        <div className="overflow-x-auto rounded-xl border border-ink-800">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/60 text-xs uppercase tracking-wider text-ink-400">
              <tr>
                <th className="px-4 py-3 text-left">Scenario</th>
                <th className="px-4 py-3 text-left">
                  Naive verifier
                  <br />
                  (picks latest event)
                </th>
                <th className="px-4 py-3 text-left">
                  Careful verifier
                  <br />
                  (runs full verification)
                </th>
              </tr>
            </thead>
            <tbody className="text-ink-200">
              <Row
                scenario="Operator emits 1 real event"
                naive={
                  <span className="text-emerald-400">accepts real proof</span>
                }
                careful={
                  <span className="text-emerald-400">accepts real proof</span>
                }
              />
              <Row
                scenario="Operator emits real event, then garbage event later"
                naive={<span className="text-red-400">accepts garbage</span>}
                careful={
                  <span className="text-emerald-400">
                    rejects garbage (ECVRF fails), accepts real proof
                  </span>
                }
              />
              <Row
                scenario="Operator emits garbage event first, then real event"
                naive={
                  <span className="text-amber-400">
                    accepts real (lucky &mdash; latest happens to be real)
                  </span>
                }
                careful={
                  <span className="text-emerald-400">accepts real proof</span>
                }
              />
              <Row
                scenario="Operator emits two distinct garbage events, no real one"
                naive={<span className="text-red-400">accepts garbage</span>}
                careful={
                  <span className="text-emerald-400">
                    rejects both (no ECVRF-valid candidate) &mdash; detects the
                    attack
                  </span>
                }
              />
              <Row
                scenario="Operator pre-commits many memos, picks favorable later"
                naive={
                  <span className="text-red-400">
                    same risk as registry mode &mdash; memo selection is a
                    protocol-level concern
                  </span>
                }
                careful={
                  <span className="text-red-400">
                    same risk as registry mode &mdash; mitigate by having the{" "}
                    <em>user</em> choose the memo
                  </span>
                }
              />
            </tbody>
          </table>
        </div>

        <div className="card border-accent-500/20 bg-accent-500/5">
          <h3 className="subsection-title mb-2 text-ink-50">
            The math guarantee
          </h3>
          <p className="text-sm text-ink-300">
            RFC 9381 ECVRF is{" "}
            <span className="text-ink-50 font-semibold">deterministic</span>:
            given a public key and an input, there is{" "}
            <span className="text-ink-50 font-semibold">
              exactly one valid 80-byte proof
            </span>
            . An attacker who emits a junk event for memo{" "}
            <code className="font-mono">X</code> can&rsquo;t produce a second{" "}
            <em>valid</em> proof for memo <code className="font-mono">X</code>.
            The real proof is somewhere in the event list &mdash; unless the
            operator never emitted it, which is the same liveness risk as
            registry mode.
          </p>
          <p className="mt-3 text-sm text-ink-300">
            <span className="text-ink-50 font-semibold">
              <code className="font-mono">pickCanonicalCommit</code>
            </span>{" "}
            from <code className="font-mono">@collectorcrypt/vrf-client</code>{" "}
            does this check for you.
          </p>
        </div>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">Code path</h2>
        <p className="max-w-3xl text-ink-300">
          The commit side proves the frozen authority read-only, then emits a
          log instead of creating a commit PDA:
        </p>
        <CodeBlock
          language="ts"
          code={`import {
  buildCommitProofEventIx,
  fetchProofCommitEvents,
  pickCanonicalCommit,
  verifyAuthorityCommitEndToEnd,
} from "@collectorcrypt/vrf-client";

// 1. Commit (operator side)
const ix = await buildCommitProofEventIx(program, rpc, {
  owner: payer.publicKey,
  label,
  memo,
  alpha,
  proof,
});
await provider.sendAndConfirm(new Transaction().add(ix));

// 2. Scan events (plain Solana RPC works for logs)
const events = await fetchProofCommitEvents(
  program,
  connection,
  ownerPubkey,
  label,
  memo,
);

// pickCanonicalCommit handles the "multiple events for one memo" case
// by selecting the unique event whose proof_hash matches a verifying proof.
const { canonical, duplicateMemoEvents } = pickCanonicalCommit(
  events.map((e) => e.onChainCommit),
  proof,
);
if (duplicateMemoEvents) console.warn("multiple events for this memo — using ECVRF math to pick");

const result = verifyAuthorityCommitEndToEnd({
  authority,
  expectedOwner: ownerPubkey,
  expectedLabel: labelBytes,
  expectedAuthorityAddress: authorityAddr,
  alpha,
  proof,
  memo,
  onChainCommit: canonical!,
});
// result.valid === true  ⟺  exactly one event matches and the math passes`}
        />
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">When to choose event mode</h2>
        <ul className="space-y-3 text-ink-300">
          <Bullet>
            <strong className="text-ink-50">You own the verifier code.</strong>{" "}
            If integrators use{" "}
            <code className="font-mono">verifyAuthorityCommitEndToEnd</code> +{" "}
            <code className="font-mono">pickCanonicalCommit</code> from the SDK,
            security is equivalent to registry mode at a fraction of the cost.
          </Bullet>
          <Bullet>
            <strong className="text-ink-50">Cost per call dominates.</strong>{" "}
            Gacha, loot drops, internal randomness, high-throughput games where
            a 3x reduction adds up.
          </Bullet>
          <Bullet>
            <strong className="text-ink-50">Log-first verification.</strong>{" "}
            Event scanning uses ordinary Solana transaction logs. Creating the
            event still needs a validity proof for the frozen authority.
          </Bullet>
          <Bullet>
            <strong className="text-ink-50">
              Off-chain indexing is already part of your stack.
            </strong>{" "}
            If you already tail Solana logs, this mode needs no extra
            infrastructure.
          </Bullet>
        </ul>
      </section>

      <footer className="container-wide pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-800 pt-8 text-sm text-ink-400">
          <a className="hover:text-ink-200" href="#/">
            &larr; Overview
          </a>
          <a className="hover:text-ink-200" href="#/registry">
            Compare with registry mode &rarr;
          </a>
          <a className="hover:text-ink-200" href={GITHUB_URL}>
            GitHub
          </a>
        </div>
      </footer>
    </main>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-ink-800 bg-ink-900/30 p-4">
      <span className="text-xs uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <span className="text-xl font-semibold text-ink-50">{value}</span>
      <span className="text-xs text-ink-400">{sub}</span>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-500" />
      <span>{children}</span>
    </li>
  );
}

function Row({
  scenario,
  naive,
  careful,
}: {
  scenario: string;
  naive: React.ReactNode;
  careful: React.ReactNode;
}) {
  return (
    <tr className="border-t border-ink-800">
      <td className="px-4 py-3 align-top text-ink-100">{scenario}</td>
      <td className="px-4 py-3 align-top text-sm">{naive}</td>
      <td className="px-4 py-3 align-top text-sm">{careful}</td>
    </tr>
  );
}
