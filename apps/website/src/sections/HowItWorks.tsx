export function HowItWorks() {
  return (
    <section className="container-wide flex flex-col gap-8" id="how-it-works">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          How it works
        </span>
        <h2 className="section-title">
          Lock the public key, commit the proof hash, verify off-chain.
        </h2>
        <p className="max-w-3xl text-ink-300">
          The on-chain program registers and freezes each operator&rsquo;s VRF
          public key, then records SHA-256 commitments for VRF calls. Registry
          modes enforce one commit per memo; event mode proves the frozen
          authority and leaves duplicate-memo handling to the verifier. ECVRF
          runs entirely off-chain; the program verifies no randomness, only
          commitments.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Step
          n={1}
          title="init_authority"
          body="Operator generates an Ed25519 VRF keypair. The program writes (owner, pk, suite, label) to a compressed PDA. Cost: ~$0.00001."
        />
        <Step
          n={2}
          title="freeze_authority"
          body="One-way flip that marks the authority ready. All commit instructions require frozen=true and revoked=false."
        />
        <Step
          n={3}
          title="commit_proof"
          body="For each VRF call: hash the memo (e.g. request id, slot), run ECVRF off-chain, post sha256(proof) + sha256(alpha) + sha256(memo) on-chain. The commit's PDA address depends on memo_hash, so the same memo can't be committed twice."
        />
        <Step
          n={4}
          title="verifyAuthorityCommitEndToEnd"
          body="Fetch the authority and commit, fetch the operator's published proof, run RFC 9381 verify. The SDK checks authority lifecycle, suite, ECVRF validity, and each committed hash in one call."
        />
      </div>

      <div className="card">
        <div className="grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="subsection-title mb-2">Trust model</h3>
            <p className="text-sm text-ink-300">
              You trust the operator who froze the pk to produce honest VRF
              proofs. The on-chain commitments make proof substitution
              detectable; withholding is a liveness failure consumers can still
              flag.
            </p>
          </div>
          <div>
            <h3 className="subsection-title mb-2">What lives on-chain</h3>
            <ul className="space-y-1 text-sm text-ink-300">
              <li>
                <code className="font-mono">VrfAuthority</code> &mdash;{" "}
                <span className="text-ink-100">owner</span>,{" "}
                <span className="text-ink-100">pk</span>,{" "}
                <span className="text-ink-100">suite</span>,{" "}
                <span className="text-ink-100">label</span>,{" "}
                <span className="text-ink-100">frozen</span>,{" "}
                <span className="text-ink-100">revoked</span>
              </li>
              <li>
                <code className="font-mono">VrfProofCommit</code> &mdash;{" "}
                <span className="text-ink-100">authority</span>,{" "}
                <span className="text-ink-100">memo_hash</span>,{" "}
                <span className="text-ink-100">proof_hash</span>,{" "}
                <span className="text-ink-100">alpha_hash</span>,{" "}
                <span className="text-ink-100">committed_slot</span>
              </li>
            </ul>
            <p className="mt-2 text-xs text-ink-400">
              Both are Light Protocol compressed PDAs, ~100x cheaper than a
              normal Solana PDA.
            </p>
          </div>
        </div>
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
