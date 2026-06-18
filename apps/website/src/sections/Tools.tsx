export function Tools() {
  return (
    <section className="container-wide flex flex-col gap-6" id="tools">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          For consumers
        </span>
        <h2 className="section-title">Trust, but verify.</h2>
        <p className="max-w-3xl text-ink-300">
          Two no-code tools for anyone integrating against a cc-vrf operator.
          Both work against devnet and mainnet, with whatever Photon-capable RPC
          you bring.
        </p>
      </header>

      <div className="grid gap-4 sm:grid-cols-2">
        <a
          href="#/lookup"
          className="card group flex flex-col gap-3 transition hover:border-accent-500/50"
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">&#x1F50D;</span>
            <h3 className="text-lg font-semibold text-ink-50 group-hover:text-accent-300">
              Operator lookup
            </h3>
          </div>
          <p className="text-sm text-ink-300">
            Paste an operator&rsquo;s owner pubkey + label. See the registered
            public key, suite, freeze status, and revoke flag. Confirms what
            you&rsquo;re trusting before you accept any of their proofs.
          </p>
          <span className="mt-1 text-xs font-mono text-accent-400 group-hover:underline">
            open lookup &rarr;
          </span>
        </a>

        <a
          href="#/verify"
          className="card group flex flex-col gap-3 transition hover:border-accent-500/50"
        >
          <div className="flex items-center gap-2">
            <span className="text-2xl">&#x2705;</span>
            <h3 className="text-lg font-semibold text-ink-50 group-hover:text-accent-300">
              Verify a roll
            </h3>
          </div>
          <p className="text-sm text-ink-300">
            Paste the operator&rsquo;s published proof for a specific memo. We
            fetch the on-chain commit, re-run ECVRF, and check every invariant.
            Green across the board means the random value provably came from the
            locked public key.
          </p>
          <span className="mt-1 text-xs font-mono text-accent-400 group-hover:underline">
            open verifier &rarr;
          </span>
        </a>
      </div>
    </section>
  );
}
