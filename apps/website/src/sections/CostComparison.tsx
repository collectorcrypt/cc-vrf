import { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CHART_PROVIDERS,
  PRICING_AS_OF,
  PROVIDERS,
  REFERENCE_PRICES,
} from "../data/providers";

const CALL_PRESETS = [
  { label: "1k", value: 1_000 },
  { label: "10k", value: 10_000 },
  { label: "100k", value: 100_000 },
  { label: "1M", value: 1_000_000 },
  { label: "10M", value: 10_000_000 },
];

export function CostComparison() {
  const [callsPerMonth, setCallsPerMonth] = useState(100_000);
  const [logScale, setLogScale] = useState(true);

  const chartData = useMemo(() => {
    return CHART_PROVIDERS.map((p) => ({
      name: p.shortName,
      monthly: (p.costPerCallUsd as number) * callsPerMonth,
      perCall: p.costPerCallUsd as number,
      isCcVrf: !!p.isCcVrf,
      chain: p.chain,
    }));
  }, [callsPerMonth]);

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
          {REFERENCE_PRICES.eth.toLocaleString()}, ETH gas ~1–2 gwei. Slide to
          your expected monthly call volume.
        </p>
      </header>

      <div className="card flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-baseline gap-3">
              <span className="text-xs uppercase tracking-wider text-ink-400">
                monthly calls
              </span>
              <span className="font-mono text-xl font-semibold text-ink-50">
                {callsPerMonth.toLocaleString()}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setLogScale((v) => !v)}
              className="rounded-md border border-ink-700 bg-ink-900 px-3 py-1 font-mono text-xs text-ink-200 hover:border-ink-500"
            >
              {logScale ? "log scale" : "linear scale"}
            </button>
          </div>
          <input
            type="range"
            min={3}
            max={8}
            step={0.05}
            value={Math.log10(callsPerMonth)}
            onChange={(e) =>
              setCallsPerMonth(Math.round(10 ** Number(e.target.value)))
            }
            className="w-full accent-accent-500"
          />
          <div className="flex flex-wrap gap-2">
            {CALL_PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setCallsPerMonth(p.value)}
                className={
                  "rounded-md border px-2 py-1 font-mono text-xs " +
                  (callsPerMonth === p.value
                    ? "border-accent-500 bg-accent-500/10 text-accent-300"
                    : "border-ink-700 bg-ink-900 text-ink-300 hover:border-ink-500")
                }
              >
                {p.label}/mo
              </button>
            ))}
          </div>
        </div>

        <div className="h-[440px] w-full">
          <ResponsiveContainer>
            <BarChart
              data={chartData}
              layout="vertical"
              margin={{ top: 8, right: 80, bottom: 8, left: 80 }}
            >
              <CartesianGrid stroke="#23272e" horizontal={false} />
              <XAxis
                type="number"
                scale={logScale ? "log" : "linear"}
                domain={logScale ? [0.1, "dataMax"] : [0, "dataMax"]}
                allowDataOverflow
                tickFormatter={(v: number) => formatUsd(v)}
                stroke="#7c8493"
                fontSize={11}
              />
              <YAxis
                type="category"
                dataKey="name"
                stroke="#aab0bd"
                fontSize={12}
                width={140}
              />
              <Tooltip
                cursor={{ fill: "rgba(56, 189, 248, 0.05)" }}
                contentStyle={{
                  backgroundColor: "#0c0e13",
                  border: "1px solid #23272e",
                  borderRadius: 8,
                  color: "#eceef2",
                }}
                formatter={(_value, _name, entry) => {
                  const d = entry?.payload as {
                    monthly: number;
                    perCall: number;
                    chain: string;
                  };
                  return [
                    `${formatUsd(d.monthly)} / month (${formatUsd(d.perCall, 5)} per call)`,
                    `chain: ${d.chain}`,
                  ];
                }}
              />
              <Bar dataKey="monthly" radius={[0, 6, 6, 0]}>
                {chartData.map((entry, i) => (
                  <Cell
                    key={i}
                    fill={entry.isCcVrf ? "#38bdf8" : "#444a58"}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <p className="text-xs text-ink-400">
          Bars in <span className="text-accent-400">accent blue</span> are
          cc-vrf variants. Pyth Entropy is omitted from the Solana comparison
          &mdash; it&rsquo;s EVM-only as of {PRICING_AS_OF}.
        </p>
      </div>

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
                    <div className="mt-0.5 text-xs text-ink-400">
                      {p.notes}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 font-mono text-xs text-ink-300">
                  {p.chain}
                </td>
                <td className="px-4 py-3 text-right font-mono text-ink-100">
                  {p.costPerCallUsd == null
                    ? "N/A"
                    : formatUsd(p.costPerCallUsd, 5)}
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

function formatUsd(value: number, maxFractionDigits = 2): string {
  if (value === 0) return "$0";
  if (value < 0.001) {
    return "$" + value.toExponential(2);
  }
  if (value < 1) {
    return (
      "$" +
      value.toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: maxFractionDigits,
      })
    );
  }
  return (
    "$" +
    value.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    })
  );
}
