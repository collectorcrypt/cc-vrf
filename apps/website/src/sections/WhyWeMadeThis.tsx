export function WhyWeMadeThis() {
  return (
    <section className="container-wide flex flex-col gap-8" id="why">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Why we made this
        </span>
        <h2 className="section-title">
          We&rsquo;re{" "}
          <span className="text-accent-400">Collector Crypt</span>. We&rsquo;ve
          processed over{" "}
          <span className="text-ink-50">20 million VRF transactions on-chain</span>.
        </h2>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="card flex flex-col gap-2">
          <h3 className="subsection-title">Who we are</h3>
          <p className="text-sm text-ink-300">
            Collector Crypt runs the largest physical-collectibles marketplace
            on Solana. Tens of thousands of cards, sales, auctions, and
            settlements move through our contracts every week.
          </p>
        </div>

        <div className="card flex flex-col gap-2">
          <h3 className="subsection-title">The problem</h3>
          <p className="text-sm text-ink-300">
            At our scale, even <span className="text-ink-100">four cents</span>{" "}
            per VRF call meant hundreds of thousands of dollars in randomness
            fees alone. Switchboard, ORAO, Chainlink &mdash; all priced for a
            world where you call VRF a few times a day, not on every pack
            opening or auction settle.
          </p>
        </div>

        <div className="card flex flex-col gap-2">
          <h3 className="subsection-title">So we built it</h3>
          <p className="text-sm text-ink-300">
            <code className="font-mono text-ink-100">cc-vrf</code> drops the
            per-call cost to{" "}
            <span className="text-ink-100">~$0.0002</span> via Light Protocol
            compressed PDAs &mdash; about a thousand times cheaper than
            Switchboard. This is as cheap as on-chain VRF gets. We&rsquo;re
            shipping it open so the next generation of web3 apps and games
            doesn&rsquo;t have to make the same trade-off we did.
          </p>
        </div>
      </div>
    </section>
  );
}
