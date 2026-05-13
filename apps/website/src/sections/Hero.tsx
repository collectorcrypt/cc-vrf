import { GITHUB_URL } from "../data/constants";

export function Hero() {
  return (
    <section className="container-wide">
      <div className="flex flex-col gap-6">
        <span className="pill">
          <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
          permissionless on-chain VRF for Solana
        </span>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl lg:text-6xl">
          Verifiable randomness on Solana
          <br />
          for{" "}
          <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
            ~$0.0002 per call.
          </span>
        </h1>
        <p className="max-w-2xl text-lg text-ink-300">
          <code className="font-mono text-ink-100">cc-vrf</code> is a standalone
          on-chain VRF system. Operators run RFC 9381 ECVRF off-chain; the
          program locks each operator&rsquo;s public key and stores
          <code className="font-mono text-ink-100"> sha256(proof)</code> per
          call as a Light Protocol compressed PDA. Every roll is publicly
          verifiable. No oracles, no subscription, no rotation risk.
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
