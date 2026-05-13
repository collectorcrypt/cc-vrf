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
          Permissionless on-chain randomness for Solana. RFC 9381 ECVRF,{" "}
          <span className="font-semibold text-ink-100">~$0.0002 per call</span>,
          and every roll is verifiable by anyone.
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
          <a className="btn-ghost" href="#why">
            Why we made this
          </a>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-x-6 gap-y-4 text-sm text-ink-300 sm:grid-cols-3">
          <Stat label="Per-call cost" value="~$0.0002" sub="batched" />
          <Stat label="ECVRF compliance" value="RFC 9381" sub="byte-exact" />
          <Stat label="Setup" value="Permissionless" sub="no token, no oracle" />
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
