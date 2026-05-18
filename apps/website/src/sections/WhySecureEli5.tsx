export function WhySecureEli5() {
  return (
    <section className="container-wide flex flex-col gap-8" id="why-secure">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Plain English
        </span>
        <h2 className="section-title">Why is this secure? ELI5.</h2>
        <p className="max-w-3xl text-ink-300">
          Imagine a weighted die that always lands the same way for any given
          throw. The operator owns the die, but <em>you</em> choose the throw
          &mdash; and anyone can check the result is the only number that die
          could have rolled.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Step
          n={1}
          title="You pick the throw"
          body="You (or your dApp) decide the input — a request ID, a slot number, a bingo round. The operator never picks it, so they can't fish for a result they like."
        />
        <Step
          n={2}
          title="The operator owns the die"
          body="The operator holds one secret key. It's the only thing they bring to the table. They locked its public half on-chain up front, so they can't swap dice mid-game."
        />
        <Step
          n={3}
          title="The die is rigged — in a good way"
          body="For any input + secret pair there is exactly one valid roll, and anyone can check the math. The operator can't make the die land differently next time; they can only refuse to throw."
        />
      </div>

      <div className="card">
        <h3 className="subsection-title mb-2">
          Why this beats &ldquo;trust me, it&rsquo;s random&rdquo;
        </h3>
        <p className="text-sm text-ink-300">
          The operator can&rsquo;t choose the output, can&rsquo;t fake it after
          the fact (the proof is committed on-chain the moment the die is
          thrown), and can&rsquo;t deny the roll later. Anyone &mdash; not just
          you &mdash; can verify the random value was the only legal answer for
          that input.
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
