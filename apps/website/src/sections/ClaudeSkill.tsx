import { CodeBlock } from "../components/CodeBlock";

const INSTALL_PROMPT = `Add cc-vrf to my project. Skill: https://vrf.collectorcrypt.com/skill.md`;

const NPX_INSTALL = `npx skills add https://vrf.collectorcrypt.com/skill.md`;

export function ClaudeSkill() {
  return (
    <section className="container-wide flex flex-col gap-8" id="claude-skill">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Use with Claude
        </span>
        <h2 className="section-title">Add cc-vrf with Claude.</h2>
        <p className="max-w-3xl text-ink-300">
          We publish a Claude{" "}
          <a className="text-accent-400 hover:underline" href="/skill.md">
            skill
          </a>{" "}
          that tells the agent how to integrate cc-vrf into a Solana project:
          install commands, operator setup, per-call proof and commit, verifier
          code, and common pitfalls.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="card flex flex-col gap-3">
          <h3 className="subsection-title">Paste into Claude</h3>
          <p className="text-sm text-ink-300">
            Open Claude (or Claude Code), and ask:
          </p>
          <CodeBlock code={INSTALL_PROMPT} language="text" />
          <p className="text-xs text-ink-400">
            Claude fetches the skill and writes the integration into your
            codebase. Review the diff before committing, especially the
            operator secret-key env vars.
          </p>
        </div>

        <div className="card flex flex-col gap-3">
          <h3 className="subsection-title">Or install as a registered skill</h3>
          <p className="text-sm text-ink-300">
            If you use the{" "}
            <code className="font-mono text-ink-100">skills</code> CLI to manage
            your Claude Code skills, register cc-vrf as a skill:
          </p>
          <CodeBlock code={NPX_INSTALL} language="bash" />
          <p className="text-xs text-ink-400">
            Then ask Claude to{" "}
            <span className="font-mono text-ink-200">use the cc-vrf skill</span>.
          </p>
        </div>
      </div>

      <div className="card flex flex-col gap-2">
        <h3 className="subsection-title">What the skill teaches</h3>
        <ul className="grid grid-cols-1 gap-x-8 gap-y-1 text-sm text-ink-300 sm:grid-cols-2">
          <li>
            &middot; When cc-vrf is the right tool (and when it isn&rsquo;t)
          </li>
          <li>&middot; Architecture: 2 compressed PDAs, 4 instructions</li>
          <li>&middot; npm + RPC setup (Helius / Triton requirement)</li>
          <li>&middot; Operator: init_authority + optional freeze</li>
          <li>&middot; Per-call: proveVRF + buildCommitProofIx</li>
          <li>&middot; Verifier: fetch authority + commit + full verify</li>
          <li>&middot; Server-side operator pattern (Vercel/KMS/Enclave)</li>
          <li>&middot; Trust model + common pitfalls + cost table</li>
        </ul>
      </div>
    </section>
  );
}
