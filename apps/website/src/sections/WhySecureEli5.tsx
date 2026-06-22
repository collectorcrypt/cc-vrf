export function WhySecureEli5() {
  return (
    <section className="container-wide flex flex-col gap-8" id="why-secure">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Plain English
        </span>
        <h2 className="section-title">Why is this secure?</h2>
        <p className="max-w-3xl text-ink-300">
          You name the input. The output for that input was already fixed by the
          operator&rsquo;s secret key, so they can&rsquo;t pick a favorable
          result. They return the value plus a proof anyone can check.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Step
          n={1}
          title="You choose the input"
          body="You (or your dApp) name the input: a request ID, a slot number, a bingo round. The operator never chooses it, so they can't bias the result."
        />
        <Step
          n={2}
          title="The key is locked first"
          body="The operator's VRF public key is committed on-chain in advance. They can't switch keys after seeing your input."
        />
        <Step
          n={3}
          title="The proof is checkable"
          body="When they return the value, they also return a proof. Anyone can run it and confirm the value is the one valid output for that input."
        />
      </div>

      <div className="card">
        <h3 className="subsection-title mb-2">
          Why you don&rsquo;t have to trust the operator
        </h3>
        <p className="text-sm text-ink-300">
          They can&rsquo;t choose the input, can&rsquo;t change the output after
          you&rsquo;ve committed it, and can&rsquo;t withhold the proof &mdash;
          it&rsquo;s written on-chain when the value is generated. Anyone can
          verify it, not just you.
        </p>
      </div>
    </section>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: string }) {
  return (
    <div className="card flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-500/10 font-mono text-sm font-semibold text-accent-400">
          {n}
        </span>
        <h3 className="font-mono text-base font-semibold text-ink-50">
          {title}
        </h3>
      </div>
      <p className="text-sm text-ink-300">{body}</p>
    </div>
  );
}
