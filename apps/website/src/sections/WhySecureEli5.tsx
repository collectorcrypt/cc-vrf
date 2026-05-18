export function WhySecureEli5() {
  return (
    <section className="container-wide flex flex-col gap-8" id="why-secure">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Plain English
        </span>
        <h2 className="section-title">Why is this secure? ELI5.</h2>
        <p className="max-w-3xl text-ink-300">
          Pick a card, any card. The operator holds a deck where every slot
          already has a card in it &mdash; fixed by a secret only they know.
          <em> You</em> pick which slot. They hand you the card that was always
          there, plus the fanned-out proof anyone can check.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Step
          n={1}
          title="You pick the card"
          body="You (or your dApp) name the input — a request ID, a slot number, a bingo round. That's your pick. The operator never gets to choose, so they can't slide themselves a favorable card."
        />
        <Step
          n={2}
          title="The deck is already set"
          body="The operator's secret key fixes which card lives in every slot. They locked the deck's identity on-chain up front, so they can't quietly swap in a different deck once they see your pick."
        />
        <Step
          n={3}
          title="The fan is the proof"
          body="When they hand you the card, they also show the proof — the math equivalent of fanning the deck out so you can see nothing was palmed, swapped, or invented after the fact."
        />
      </div>

      <div className="card">
        <h3 className="subsection-title mb-2">
          Why this beats &ldquo;trust me, it&rsquo;s random&rdquo;
        </h3>
        <p className="text-sm text-ink-300">
          The operator can&rsquo;t choose your card, can&rsquo;t swap it after
          you&rsquo;ve picked, and can&rsquo;t pretend the proof never existed
          &mdash; it&rsquo;s committed on-chain the moment the card is drawn.
          Anyone &mdash; not just you &mdash; can hold up the fan and confirm
          the card you got was the only card that could ever have lived in that
          slot.
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
