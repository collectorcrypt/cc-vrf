import { CodeBlock } from "../components/CodeBlock";
import {
  CC_VRF_PROGRAM_ID,
  GITHUB_URL,
  NPM_ECVRF_URL,
  NPM_VRF_CLIENT_URL,
} from "../data/constants";

const INSTALL = `pnpm add @collectorcrypt/vrf-client @lightprotocol/stateless.js @coral-xyz/anchor @solana/web3.js`;

const QUICKSTART = `import {
  generateKeyPair, proveVRF, vrfProofToHash, bytesToHex,
} from "@collectorcrypt/vrf-client";

// 1. Operator: keep this secret. Same key forever (or rotate via revoke).
const { sk, pk } = generateKeyPair();

// 2. Per VRF call: alpha is whatever you want bound to this draw.
import { sha256 } from "@noble/hashes/sha2.js";
const alpha = sha256(new TextEncoder().encode(\`req-\${requestId}\`));
const { proof } = proveVRF(sk, alpha);
const beta = vrfProofToHash(proof); // 64 bytes of uniformly random output

// 3. Commit on-chain via buildCommitProofIx. Done.`;

export function GetStarted() {
  return (
    <section className="container-wide flex flex-col gap-8" id="get-started">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Get started
        </span>
        <h2 className="section-title">A few lines to verifiable randomness.</h2>
        <p className="max-w-3xl text-ink-300">
          The pure-JS ECVRF library works on its own, with no on-chain
          dependency. Use it anywhere you need RFC 9381 randomness; add the SDK
          and program to commit proofs on-chain.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-3">
          <h3 className="subsection-title text-sm">Install</h3>
          <CodeBlock code={INSTALL} language="bash" />

          <h3 className="subsection-title text-sm mt-4">Quickstart</h3>
          <CodeBlock code={QUICKSTART} />
        </div>

        <div className="flex flex-col gap-3">
          <div className="card flex flex-col gap-2">
            <h3 className="subsection-title">On-chain program</h3>
            <p className="text-sm text-ink-300">
              Live on Solana devnet and mainnet &mdash; same program ID, same
              bytecode. Permissionless.
            </p>
            <dl className="kv">
              <dt>program id</dt>
              <dd>
                <a
                  className="font-mono text-accent-400 hover:underline"
                  href={`https://explorer.solana.com/address/${CC_VRF_PROGRAM_ID}`}
                  target="_blank"
                  rel="noreferrer"
                  title="View on Solana Explorer (mainnet)"
                >
                  {CC_VRF_PROGRAM_ID}
                </a>
              </dd>
              <dt>cluster</dt>
              <dd>devnet + mainnet</dd>
              <dt>idl + types</dt>
              <dd>
                included in{" "}
                <code className="font-mono">@collectorcrypt/vrf-client</code>
              </dd>
            </dl>
          </div>
          <div className="card flex flex-col gap-2">
            <h3 className="subsection-title">Packages</h3>
            <ul className="space-y-1 text-sm text-ink-300">
              <li>
                <a
                  className="font-mono text-accent-400 hover:underline"
                  href={NPM_ECVRF_URL}
                  target="_blank"
                  rel="noreferrer"
                  title="View @collectorcrypt/ecvrf on npm"
                >
                  @collectorcrypt/ecvrf
                </a>{" "}
                &mdash; RFC 9381 Ed25519 ECVRF (zero Solana deps).
              </li>
              <li>
                <a
                  className="font-mono text-accent-400 hover:underline"
                  href={NPM_VRF_CLIENT_URL}
                  target="_blank"
                  rel="noreferrer"
                  title="View @collectorcrypt/vrf-client on npm"
                >
                  @collectorcrypt/vrf-client
                </a>{" "}
                &mdash; on-chain SDK and verification helpers.
              </li>
            </ul>
          </div>
          <div className="card flex flex-col gap-2">
            <h3 className="subsection-title">Source &amp; reference demo</h3>
            <p className="text-sm text-ink-300">
              Repo, demo CLI, RFC 9381 fixture generator, and 50-test crypto
              suite on GitHub.
            </p>
            <a className="btn-primary self-start" href={GITHUB_URL}>
              cc-vrf on GitHub
              <span aria-hidden>&rarr;</span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
