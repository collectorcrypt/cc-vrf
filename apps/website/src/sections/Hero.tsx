import { GITHUB_URL } from "../data/constants";

export function Hero() {
  return (
    <section className="container-wide">
      <div className="flex flex-col gap-6">
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl lg:text-6xl">
          Collector Crypt
          <span className="text-ink-400"> &mdash; </span>
          <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
            VRF.
          </span>
        </h1>
        <p className="max-w-2xl text-lg text-ink-300">
          We&rsquo;ve processed over{" "}
          <span className="font-semibold text-ink-100">
            20 million on-chain transactions
          </span>
          . Even at{" "}
          <span className="font-semibold text-ink-100">four cents</span> per
          VRF call, on-chain randomness was unaffordable at any real scale.{" "}
          <code className="font-mono text-ink-100">cc-vrf</code> brings it down
          to{" "}
          <span className="font-semibold text-ink-100">~$0.0002 per call</span>{" "}
          &mdash; as cheap as on-chain VRF gets &mdash; via RFC 9381 ECVRF and
          Light Protocol compressed PDAs. On-chain VRF for the next generation
          of web3 apps and games.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a className="btn-primary" href="#get-started">
            Get started
            <span aria-hidden>&rarr;</span>
          </a>
          <a className="btn-ghost" href={GITHUB_URL}>
            View on GitHub
          </a>
          <a className="btn-ghost" href="#cost">
            See the cost chart
          </a>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm text-ink-300 sm:grid-cols-4">
          <Stat label="Per-call cost" value="~$0.0002" sub="batched" />
          <Stat
            label="vs Switchboard"
            value="~1,000x cheaper"
            sub="per call"
          />
          <Stat label="ECVRF compliance" value="RFC 9381" sub="byte-exact" />
          <Stat label="ECVRF tests" value="47 passing" sub="incl. reference" />
        </div>
      </div>
    </section>
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
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <span className="text-xl font-semibold text-ink-50">{value}</span>
      <span className="text-xs text-ink-400">{sub}</span>
    </div>
  );
}
