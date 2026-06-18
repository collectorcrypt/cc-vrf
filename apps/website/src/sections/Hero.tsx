import { GITHUB_URL } from "../data/constants";

export function Hero() {
  return (
    <section className="container-wide">
      <div className="flex flex-col gap-6">
        <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl lg:text-6xl">
          Collector Crypt
          <span className="text-ink-400"> &mdash; </span>
          <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
            Verifiable Random Function.
          </span>
        </h1>
        <p className="max-w-2xl text-lg text-ink-300">
          Permissionless on-chain randomness for Solana. RFC 9381 ECVRF, live on
          devnet and mainnet, every roll publicly verifiable. From{" "}
          <span className="font-mono text-ink-100">$0.0009</span> per call.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <a className="btn-primary" href="#get-started">
            Get started
            <span aria-hidden>&rarr;</span>
          </a>
          <a className="btn-ghost" href="#/lookup">
            Look up operator
          </a>
          <a className="btn-ghost" href="#/verify">
            Verify a roll
          </a>
          <a className="btn-ghost" href={GITHUB_URL}>
            GitHub
          </a>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm text-ink-300 sm:grid-cols-4">
          <Stat label="Event mode" value="~$0.0009" sub="per call" />
          <Stat label="Registry mode" value="~$0.0027" sub="per call" />
          <Stat
            label="Setup"
            value="Permissionless"
            sub="no token, no oracle"
          />
          <Stat label="Spec" value="RFC 9381" sub="byte-exact tested" />
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
