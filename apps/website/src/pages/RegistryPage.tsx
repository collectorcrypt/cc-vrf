import { CodeBlock } from "../components/CodeBlock";
import { GITHUB_URL } from "../data/constants";

export function RegistryPage() {
  return (
    <main className="flex flex-col gap-16 pb-24 pt-12 sm:pt-20">
      <section className="container-wide flex flex-col gap-6">
        <a
          href="#/"
          className="text-xs font-semibold uppercase tracking-wider text-accent-500 hover:text-accent-400"
        >
          &larr; Back to overview
        </a>
        <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-ink-50 sm:text-5xl">
          Registry mode
          <span className="text-ink-400"> &mdash; </span>
          <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
            commit_proof
          </span>
        </h1>
        <p className="max-w-3xl text-lg text-ink-300">
          Each VRF call writes a Light Protocol compressed PDA at a
          deterministic address derived from{" "}
          <code className="font-mono text-ink-100">
            (authority, sha256(memo))
          </code>
          . The chain itself enforces one commitment per memo &mdash; even a
          careless verifier can&rsquo;t be tricked into reading the wrong
          record.
        </p>
        <p className="max-w-3xl text-base text-ink-400">
          This page also covers the{" "}
          <code className="font-mono text-ink-200">commit_proof_with_beta</code>{" "}
          sub-variant &mdash; same PDA mode, but also persists the 64-byte ECVRF
          beta on chain so other Solana programs can consume the random value
          directly. Same cost as plain registry mode, just more bytes per leaf.
        </p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat
            label="Per-call cost (devnet)"
            value="~$0.0027"
            sub="measured 2026-05-18"
          />
          <Stat label="Per 100k calls" value="~$270" sub="extrapolated" />
          <Stat
            label="RPC requirement"
            value="Photon"
            sub="Helius dev plan or equiv."
          />
        </div>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">When to choose registry mode</h2>
        <ul className="space-y-3 text-ink-300">
          <Bullet>
            <strong className="text-ink-50">
              Public verifiers integrate against your VRF.
            </strong>{" "}
            Anyone who knows{" "}
            <code className="font-mono text-ink-100">(authority, memo)</code>{" "}
            can fetch the canonical commit in one call. Naive verifier code is
            still safe.
          </Bullet>
          <Bullet>
            <strong className="text-ink-50">High-stakes randomness.</strong>{" "}
            Lotteries, public draws, governance &mdash; cases where &ldquo;just
            trust the operator + cryptography&rdquo; isn&rsquo;t enough, and you
            want the chain itself to enforce uniqueness.
          </Bullet>
          <Bullet>
            <strong className="text-ink-50">
              Audit traceability matters more than per-call cost.
            </strong>{" "}
            Each commit has a permanent compressed-PDA address you can cite in a
            dispute. The Merkle proof of inclusion is constructible by any
            indexer that knows the address tree.
          </Bullet>
        </ul>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">What lives on chain</h2>
        <div className="card grid gap-6 sm:grid-cols-2">
          <div>
            <h3 className="subsection-title mb-2 font-mono">VrfAuthority</h3>
            <ul className="space-y-1 text-sm text-ink-300">
              <li>
                <code className="font-mono">owner</code>: signer pubkey
              </li>
              <li>
                <code className="font-mono">pk</code>: 32-byte VRF public key
              </li>
              <li>
                <code className="font-mono">suite</code>: 0x03 (TAI)
              </li>
              <li>
                <code className="font-mono">label</code>: 32-byte identifier
              </li>
              <li>
                <code className="font-mono">frozen</code>,{" "}
                <code className="font-mono">revoked</code>: lifecycle flags
              </li>
            </ul>
          </div>
          <div>
            <h3 className="subsection-title mb-2 font-mono">VrfProofCommit</h3>
            <ul className="space-y-1 text-sm text-ink-300">
              <li>
                <code className="font-mono">authority</code>: parent
                authority&rsquo;s address
              </li>
              <li>
                <code className="font-mono">memo_hash</code>: SHA-256 of the
                request memo
              </li>
              <li>
                <code className="font-mono">proof_hash</code>: SHA-256 of the
                80-byte ECVRF proof
              </li>
              <li>
                <code className="font-mono">alpha_hash</code>: SHA-256 of the
                VRF input
              </li>
              <li>
                <code className="font-mono">committed_slot</code>: tx slot
              </li>
            </ul>
          </div>
        </div>
        <p className="text-sm text-ink-400">
          Both are Light Protocol compressed PDAs &mdash; the chain stores only
          the Merkle root; the actual leaf data lives in the Photon indexer.
        </p>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">
          Cross-program consumption: the{" "}
          <code className="font-mono text-ink-100">+ beta</code> variant
        </h2>
        <p className="max-w-3xl text-ink-300">
          By default,{" "}
          <code className="font-mono text-ink-100">commit_proof</code> stores
          only hashes on chain &mdash; the 80-byte ECVRF proof and the 64-byte
          beta output live off-chain. That&rsquo;s fine when a human or web
          service verifies the result, but if{" "}
          <span className="text-ink-50">another Solana program</span> wants to
          read the random number directly, it has no way to do that from the
          hash alone.
        </p>
        <p className="max-w-3xl text-ink-300">
          The{" "}
          <code className="font-mono text-ink-100">commit_proof_with_beta</code>{" "}
          variant stores the full 64-byte beta in the compressed PDA alongside
          the hashes. Any other program can then read the random value via a
          Light SDK CPI &mdash; no off-chain fetch needed.
        </p>

        <div className="overflow-x-auto rounded-xl border border-ink-800">
          <table className="w-full text-sm">
            <thead className="bg-ink-900/60 text-xs uppercase tracking-wider text-ink-400">
              <tr>
                <th className="px-4 py-3 text-left"></th>
                <th className="px-4 py-3 text-left">commit_proof</th>
                <th className="px-4 py-3 text-left">commit_proof_with_beta</th>
              </tr>
            </thead>
            <tbody className="text-ink-200">
              <tr className="border-t border-ink-800">
                <td className="px-4 py-3 align-top font-medium text-ink-100">
                  Stored on chain
                </td>
                <td className="px-4 py-3 align-top">
                  memo_hash, proof_hash, alpha_hash
                </td>
                <td className="px-4 py-3 align-top">
                  memo_hash, proof_hash, alpha_hash, beta (64 bytes)
                </td>
              </tr>
              <tr className="border-t border-ink-800">
                <td className="px-4 py-3 align-top font-medium text-ink-100">
                  Cost per call (measured)
                </td>
                <td className="px-4 py-3 align-top font-mono">~$0.0027</td>
                <td className="px-4 py-3 align-top font-mono">
                  ~$0.0027 (same!)
                </td>
              </tr>
              <tr className="border-t border-ink-800">
                <td className="px-4 py-3 align-top font-medium text-ink-100">
                  Other Solana programs can read beta?
                </td>
                <td className="px-4 py-3 align-top text-amber-400">
                  No &mdash; only the hashes
                </td>
                <td className="px-4 py-3 align-top text-emerald-400">
                  Yes &mdash; via Light SDK CPI
                </td>
              </tr>
              <tr className="border-t border-ink-800">
                <td className="px-4 py-3 align-top font-medium text-ink-100">
                  Off-chain audit trail
                </td>
                <td className="px-4 py-3 align-top">
                  Same &mdash; verifyAuthorityCommitEndToEnd works identically
                </td>
                <td className="px-4 py-3 align-top">
                  Same &mdash; verifyAuthorityCommitEndToEnd works identically,
                  plus you can also check stored beta matches
                  vrfProofToHash(proof)
                </td>
              </tr>
              <tr className="border-t border-ink-800">
                <td className="px-4 py-3 align-top font-medium text-ink-100">
                  Seed prefix
                </td>
                <td className="px-4 py-3 align-top font-mono">vrf_proof</td>
                <td className="px-4 py-3 align-top font-mono">vrf_proof</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div className="card border-accent-500/20 bg-accent-500/5">
          <p className="text-sm text-ink-300">
            <span className="font-semibold text-ink-50">Trust note:</span>{" "}
            storing beta on chain doesn&rsquo;t add on-chain cryptographic
            verification &mdash; an on-chain consumer still trusts that the
            operator (whose pk is frozen in{" "}
            <code className="font-mono text-ink-100">VrfAuthority</code>) wrote
            the correct beta. Public auditors can later detect any mismatch
            between the stored beta and{" "}
            <code className="font-mono text-ink-100">
              vrfProofToHash(proof)
            </code>{" "}
            by fetching the proof off-chain and re-running the math. Trustless
            on-chain ECVRF verification would require running RFC 9381 in BPF
            (~200k+ CU per call) or an Ed25519-curve precompile Solana
            doesn&rsquo;t have yet.
          </p>
        </div>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">Code path</h2>
        <p className="max-w-3xl text-ink-300">
          One unified validity proof binds the existing authority (read-only)
          and the new commit PDA. The SDK builds the entire transaction:
        </p>
        <CodeBlock
          language="ts"
          code={`import {
  buildCommitProofIx,
  fetchProofCommit,
  verifyAuthorityCommitEndToEnd,
} from "@collectorcrypt/vrf-client";

// 1. Commit (operator side)
const { ix } = await buildCommitProofIx(program, rpc, {
  owner: payer.publicKey,
  label,
  memo,
  alpha,
  proof,
});
await provider.sendAndConfirm(new Transaction().add(ix));

// 2. Verify (anyone, anywhere)
const commit = await fetchProofCommit(program, rpc, authorityAddr, memo);
const result = verifyAuthorityCommitEndToEnd({
  authority,
  expectedOwner: owner,
  expectedLabel: labelBytes,
  expectedAuthorityAddress: authorityAddr,
  alpha,
  proof,
  memo,
  onChainCommit: commit!.onChainCommit,
});
// result.valid === true  ⟺  ECVRF math + proof hash + alpha hash + memo hash all match`}
        />

        <p className="mt-6 max-w-3xl text-ink-300">
          And the with-beta variant for cross-program consumers:
        </p>

        <CodeBlock
          language="ts"
          code={`import {
  buildCommitProofWithBetaIx,
  fetchProofCommitWithBeta,
  vrfProofToHash,
} from "@collectorcrypt/vrf-client";

const beta = vrfProofToHash(proof); // 64-byte ECVRF output

const { ix } = await buildCommitProofWithBetaIx(program, rpc, {
  owner: payer.publicKey,
  label,
  memo,
  alpha,
  proof,
  beta,
});
await provider.sendAndConfirm(new Transaction().add(ix));

// Read back the beta directly (any consumer program can also do this via Light CPI)
const stored = await fetchProofCommitWithBeta(program, rpc, authorityAddr, memo);
console.log("on-chain beta:", stored!.beta); // 64 bytes, ready for use as randomness`}
        />
      </section>

      <footer className="container-wide pt-8">
        <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ink-800 pt-8 text-sm text-ink-400">
          <a className="hover:text-ink-200" href="#/">
            &larr; Overview
          </a>
          <a className="hover:text-ink-200" href="#/events">
            Compare with event mode &rarr;
          </a>
          <a className="hover:text-ink-200" href={GITHUB_URL}>
            GitHub
          </a>
        </div>
      </footer>
    </main>
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
    <div className="flex flex-col gap-1 rounded-lg border border-ink-800 bg-ink-900/30 p-4">
      <span className="text-xs uppercase tracking-wider text-ink-400">
        {label}
      </span>
      <span className="text-xl font-semibold text-ink-50">{value}</span>
      <span className="text-xs text-ink-400">{sub}</span>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span className="mt-1.5 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full bg-accent-500" />
      <span>{children}</span>
    </li>
  );
}
