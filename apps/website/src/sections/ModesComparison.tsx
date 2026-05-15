export function ModesComparison() {
  return (
    <section className="container-wide flex flex-col gap-8" id="modes">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Three commit variants
        </span>
        <h2 className="section-title">Pick the right cost / trust / consumption tradeoff</h2>
        <p className="max-w-3xl text-ink-300">
          cc-vrf ships three ways to record each VRF call on chain. All three
          share the same RFC 9381 ECVRF math and the same{" "}
          <code className="font-mono text-ink-100">VrfAuthority</code> registry
          for locking public keys. They differ in where the per-call commitment
          lives and whether the random output is directly readable from other
          Solana programs.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-ink-800">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 text-xs uppercase tracking-wider text-ink-400">
            <tr>
              <th className="px-4 py-3 text-left"></th>
              <th className="px-4 py-3 text-left">Registry</th>
              <th className="px-4 py-3 text-left">Registry + Beta</th>
              <th className="px-4 py-3 text-left">Event</th>
            </tr>
          </thead>
          <tbody className="text-ink-200">
            <Row
              label="Instruction"
              registry={<code className="font-mono text-ink-100">commit_proof</code>}
              registryBeta={<code className="font-mono text-ink-100">commit_proof_with_beta</code>}
              event={<code className="font-mono text-ink-100">commit_proof_event</code>}
            />
            <Row
              label="On-chain storage"
              registry="Compressed PDA per call"
              registryBeta="Compressed PDA + 64-byte beta"
              event="Solana log event (emit!)"
            />
            <Row
              label="Measured cost (devnet)"
              registry={<span className="font-mono text-ink-100">~$0.0024 / call</span>}
              registryBeta={<span className="font-mono text-ink-100">~$0.0024 / call</span>}
              event={<span className="font-mono text-ink-100">~$0.0008 / call</span>}
            />
            <Row
              label="Per 100k calls"
              registry={<span className="font-mono text-ink-100">~$240</span>}
              registryBeta={<span className="font-mono text-ink-100">~$240</span>}
              event={<span className="font-mono text-ink-100">~$80</span>}
            />
            <Row
              label="RPC requirement"
              registry="Photon-capable RPC"
              registryBeta="Photon-capable RPC"
              event={
                <span className="text-emerald-400">
                  Any Solana RPC &mdash; no Photon needed
                </span>
              }
            />
            <Row
              label="Replay protection"
              registry={<span className="text-emerald-400">Chain-enforced</span>}
              registryBeta={<span className="text-emerald-400">Chain-enforced</span>}
              event={
                <span className="text-amber-400">
                  Verifier-side via pickCanonicalCommit
                </span>
              }
            />
            <Row
              label="Other Solana programs can read the random value"
              registry={<span className="text-amber-400">Only the hash — must fetch proof off-chain</span>}
              registryBeta={
                <span className="text-emerald-400">
                  Yes &mdash; 64-byte beta directly on chain
                </span>
              }
              event={<span className="text-amber-400">Only via same-tx CPI from the operator</span>}
            />
            <Row
              label="Best for"
              registry="Public lotteries, audit trails, off-chain verifiers"
              registryBeta="On-chain games, lootboxes consumed by another program"
              event="Gacha, internal randomness, throughput, no Photon ops"
            />
            <Row
              label="Read more"
              registry={
                <a className="text-accent-400 hover:underline" href="#/registry">
                  Registry page &rarr;
                </a>
              }
              registryBeta={
                <a className="text-accent-400 hover:underline" href="#/registry">
                  Registry page (beta section) &rarr;
                </a>
              }
              event={
                <a className="text-accent-400 hover:underline" href="#/events">
                  Event page &rarr;
                </a>
              }
            />
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card border-accent-500/20 bg-accent-500/5">
          <h3 className="subsection-title mb-2 text-ink-50">
            On &ldquo;verifier complexity&rdquo;
          </h3>
          <p className="text-sm text-ink-300">
            Event mode&rsquo;s tradeoff isn&rsquo;t about fraud &mdash; the
            deterministic VRF proof is always recoverable from the event list.
            It&rsquo;s about a careless verifier potentially being{" "}
            <span className="text-ink-50">unable to prove</span> which event
            is canonical without running the ECVRF math. The SDK&rsquo;s{" "}
            <code className="font-mono text-ink-100">verifyEndToEnd</code> +{" "}
            <code className="font-mono text-ink-100">pickCanonicalCommit</code>{" "}
            handle this for you. With them, event mode is equivalent in safety
            to registry mode.
          </p>
        </div>
        <div className="card border-accent-500/20 bg-accent-500/5">
          <h3 className="subsection-title mb-2 text-ink-50">
            Beta storage is free
          </h3>
          <p className="text-sm text-ink-300">
            The +beta variant costs the same per call as plain registry mode in
            our devnet benchmark &mdash; the extra 64 bytes per leaf
            doesn&rsquo;t change the Light Protocol slot cost. If a future
            on-chain program might consume your randomness, default to the
            beta variant; you&rsquo;re not paying extra to keep the option
            open.
          </p>
        </div>
      </div>
    </section>
  );
}

function Row({
  label,
  registry,
  registryBeta,
  event,
}: {
  label: string;
  registry: React.ReactNode;
  registryBeta: React.ReactNode;
  event: React.ReactNode;
}) {
  return (
    <tr className="border-t border-ink-800">
      <td className="px-4 py-3 align-top font-medium text-ink-100">{label}</td>
      <td className="px-4 py-3 align-top">{registry}</td>
      <td className="px-4 py-3 align-top">{registryBeta}</td>
      <td className="px-4 py-3 align-top">{event}</td>
    </tr>
  );
}
