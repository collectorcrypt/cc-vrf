import { REFERENCES } from "../data/constants";

export function References() {
  return (
    <section className="container-wide flex flex-col gap-6" id="references">
      <header className="flex flex-col gap-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          References
        </span>
        <h2 className="section-title">Don&rsquo;t take our word for it.</h2>
        <p className="max-w-3xl text-ink-300">
          cc-vrf doesn&rsquo;t invent any crypto &mdash; it implements published
          standards on top of audited libraries. Here&rsquo;s the primary
          source material if you want to verify the math yourself.
        </p>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
        {REFERENCES.map((group) => (
          <div key={group.heading} className="card flex flex-col gap-4">
            <h3 className="subsection-title text-sm">{group.heading}</h3>
            <ul className="flex flex-col gap-4">
              {group.links.map((link) => (
                <li key={link.href} className="flex flex-col gap-1">
                  <a
                    className="font-medium text-accent-400 hover:underline"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {link.title}
                  </a>
                  <span className="text-sm text-ink-400">{link.note}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
