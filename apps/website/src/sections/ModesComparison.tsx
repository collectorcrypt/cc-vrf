export function ModesComparison() {
  return (
    <section className="container-wide flex flex-col gap-6" id="modes">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Three commit modes
        </span>
        <h2 className="section-title">Three ways to commit the same proof.</h2>
        <p className="max-w-3xl text-ink-300">
          All three modes run the same RFC 9381 ECVRF math against the same
          frozen authority. They differ in how each commit is stored on chain.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        <ModeCard
          name="Registry"
          instruction="commit_proof"
          cost="~$0.0027"
          per100k="~$270"
          storage="Compressed PDA"
          replay="Chain-enforced"
          best="Lotteries, audit trails, off-chain verifiers"
          href="#/registry"
        />
        <ModeCard
          name="Registry + Beta"
          instruction="commit_proof_with_beta"
          cost="~$0.0027"
          per100k="~$270"
          storage="Compressed PDA + 64-byte beta on-chain"
          replay="Chain-enforced"
          best="On-chain games consumed by another program"
          href="#/registry"
        />
        <ModeCard
          name="Event"
          instruction="commit_proof_event"
          cost="~$0.0009"
          per100k="~$90"
          storage="Solana log event"
          replay={
            <span className="text-amber-400">
              Verifier-side via pickCanonicalCommit
            </span>
          }
          best="High-throughput, gacha, internal randomness"
          highlight
          href="#/events"
        />
      </div>

      <p className="text-xs text-ink-500">
        All modes require a frozen, unrevoked{" "}
        <code className="font-mono text-ink-300">VrfAuthority</code> and a
        Photon-capable RPC. Costs measured 2026-05-18, SOL ≈ $180. Event mode is
        3.00× cheaper than registry.
      </p>
    </section>
  );
}

function ModeCard({
  name,
  instruction,
  cost,
  per100k,
  storage,
  replay,
  best,
  href,
  highlight = false,
}: {
  name: string;
  instruction: string;
  cost: string;
  per100k: string;
  storage: string;
  replay: React.ReactNode;
  best: string;
  href: string;
  highlight?: boolean;
}) {
  return (
    <a
      href={href}
      className={
        "card group flex flex-col gap-3 transition hover:border-accent-500/50 " +
        (highlight ? "border-accent-500/40 bg-accent-500/5" : "")
      }
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-lg font-semibold text-ink-50">{name}</h3>
        <span className="font-mono text-2xl text-ink-50">{cost}</span>
      </div>
      <code className="font-mono text-xs text-accent-400">{instruction}</code>
      <dl className="grid gap-1 text-xs">
        <Row label="Per 100k">
          <span className="font-mono text-ink-200">{per100k}</span>
        </Row>
        <Row label="Storage">{storage}</Row>
        <Row label="Replay">{replay}</Row>
        <Row label="Best for">{best}</Row>
      </dl>
      <span className="mt-1 text-xs font-mono text-accent-400 group-hover:underline">
        details &rarr;
      </span>
    </a>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[80px_1fr] gap-2">
      <dt className="font-semibold uppercase tracking-wider text-ink-500">
        {label}
      </dt>
      <dd className="text-ink-200">{children}</dd>
    </div>
  );
}
