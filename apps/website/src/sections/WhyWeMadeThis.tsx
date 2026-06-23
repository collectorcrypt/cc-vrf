export function WhyWeMadeThis() {
  return (
    <section className="container-wide flex flex-col gap-8" id="why">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Why we made this
        </span>
        <h2 className="section-title">
          We&rsquo;re <span className="text-accent-400">Collector Crypt</span>.
          We&rsquo;ve processed {" "}
          <span className="text-ink-50">
            millions of VRF transactions on-chain
          </span>
          .
        </h2>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card flex flex-col gap-2">
          <h3 className="subsection-title">Who we are</h3>
          <p className="text-sm text-ink-300">
            Collector Crypt runs the largest physical-collectibles marketplace
            on Solana. Tens of thousands of transactions move through our
            contracts every week.
          </p>
        </div>

        <div className="card flex flex-col gap-2">
          <h3 className="subsection-title">The problem</h3>
          <p className="text-sm text-ink-300">
            At our scale, even <span className="text-ink-100">four cents</span>{" "}
            per VRF call meant hundreds of thousands of dollars a year.
          </p>
        </div>

        <div className="card flex flex-col gap-2">
          <h3 className="subsection-title">So we built it</h3>
          <p className="text-sm text-ink-300">
            <code className="font-mono text-ink-100">cc-vrf</code> drops the
            per-call cost to <span className="text-ink-100">~$0.0009</span> in
            event mode and <span className="text-ink-100">~$0.0027</span> in
            registry mode, using Light Protocol compressed PDAs and log-only
            event commits. That&rsquo;s about as cheap as verifiable on-chain
            randomness gets, and we open-sourced it so other Solana apps and
            games don&rsquo;t have to pay for it.
          </p>
        </div>
      </div>
    </section>
  );
}
