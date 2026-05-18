import { PRICING_AS_OF, PROVIDERS, REFERENCE_PRICES } from "../data/providers";

export function CostComparison() {
  return (
    <section className="container-wide flex flex-col gap-8" id="cost">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Cost comparison
        </span>
        <h2 className="section-title">How does cc-vrf stack up?</h2>
        <p className="max-w-3xl text-ink-300">
          Per-call USD cost for major on-chain VRF providers, gathered{" "}
          <span className="font-mono text-ink-100">{PRICING_AS_OF}</span> at
          reference prices SOL ≈ ${REFERENCE_PRICES.sol}, ETH ≈ $
          {REFERENCE_PRICES.eth.toLocaleString()}, ETH gas ~1–2 gwei. cc-vrf
          rows measured by running{" "}
          <code className="font-mono text-ink-100">cc-vrf-demo cost 100</code>{" "}
          against devnet with a Helius dev RPC.
        </p>
      </header>

      <div className="overflow-x-auto rounded-xl border border-ink-800">
        <table className="w-full text-sm">
          <thead className="bg-ink-900/60 text-xs uppercase tracking-wider text-ink-400">
            <tr>
              <th className="px-4 py-3 text-left">Provider</th>
              <th className="px-4 py-3 text-left">Chain</th>
              <th className="px-4 py-3 text-right">$/call</th>
              <th className="px-4 py-3 text-right">$/100k calls</th>
              <th className="px-4 py-3 text-left">Where the cost comes from</th>
            </tr>
          </thead>
          <tbody>
            {PROVIDERS.map((p) => (
              <tr
                key={p.name}
                className={
                  "border-t border-ink-800 " +
                  (p.isCcVrf ? "bg-accent-500/5" : "")
                }
              >
                <td className="px-4 py-3">
                  <div className="font-medium text-ink-100">{p.name}</div>
                  {p.notes && (
                    <div className="mt-0.5 text-xs text-ink-400">{p.notes}</div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-300">
                  {p.chain}
                </td>
                <td className="px-4 py-3 text-right font-mono text-ink-100">
                  {p.costPerCallUsd == null
                    ? "N/A"
                    : formatUsd(p.costPerCallUsd)}
                </td>
                <td className="px-4 py-3 text-right font-mono text-ink-100">
                  {p.costPerCallUsd == null
                    ? "—"
                    : formatUsd(p.costPerCallUsd * 100_000)}
                </td>
                <td className="px-4 py-3 text-xs text-ink-300">
                  {p.breakdown}{" "}
                  <a
                    href={p.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-400 hover:underline"
                  >
                    source
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function formatUsd(value: number): string {
  if (value === 0) return "$0";
  // Always decimal — never scientific. Sub-cent values keep enough precision
  // to show $0.0002, $0.00001 etc. without trailing-zero noise.
  if (value < 0.01) {
    const trimmed = parseFloat(value.toFixed(6)).toString();
    return "$" + trimmed;
  }
  if (value < 1) {
    return (
      "$" +
      value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 4,
      })
    );
  }
  if (value < 1000) {
    return (
      "$" +
      value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
  }
  return (
    "$" +
    value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })
  );
}
