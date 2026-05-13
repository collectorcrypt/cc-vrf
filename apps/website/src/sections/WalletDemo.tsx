import { useMemo, useState } from "react";
import { useConnection, useAnchorWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { ComputeBudgetProgram, Transaction } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { createRpc } from "@lightprotocol/stateless.js";
import {
  bytesToHex,
  generateKeyPair,
  proveVRF,
  vrfProofToHash,
  SUITE_EDWARDS25519_SHA512_TAI,
  buildInitAuthorityIx,
  buildCommitProofIx,
  fetchAuthority,
  fetchProofCommit,
  verifyEndToEnd,
} from "@collectorcrypt/vrf-client";

import {
  buildProgramFromWallet,
  explorerAddressUrl,
  explorerTxUrl,
  isLikelyHeliusOrEquivalent,
} from "../wallet/AnchorProgram";
import { VITE_RPC_URL } from "../data/constants";
import { CodeBlock } from "../components/CodeBlock";

type Phase = "needs-wallet" | "needs-init" | "ready" | "rolling";
type RecordedRoll = {
  memo: string;
  rollValue: number;
  txSig: string;
  commitAddr: string;
  verifyValid: boolean;
};

const SAMPLE_CODE = `import {
  generateKeyPair,
  proveVRF,
  vrfProofToHash,
  buildInitAuthorityIx,
  buildCommitProofIx,
  fetchProofCommit,
  verifyEndToEnd,
  SUITE_EDWARDS25519_SHA512_TAI,
} from "@collectorcrypt/vrf-client";

// 1. Generate a VRF keypair (operator-side, off-chain).
const { sk, pk } = generateKeyPair();

// 2. Init the on-chain authority (one-time per operator + label).
const { ix } = await buildInitAuthorityIx(program, rpc, {
  owner: wallet.publicKey,
  pk,
  suite: SUITE_EDWARDS25519_SHA512_TAI,
  label: "my-app",
});
await wallet.sendTransaction(new Transaction().add(ix), connection);

// 3. Commit one VRF call.
const memo = \`req-\${requestId}\`;
const alpha = sha256(new TextEncoder().encode(memo));
const { proof } = proveVRF(sk, alpha);
const beta = vrfProofToHash(proof);

const { ix: commitIx } = await buildCommitProofIx(program, rpc, {
  owner: wallet.publicKey,
  label: "my-app",
  memo, alpha, proof,
});
await wallet.sendTransaction(new Transaction().add(commitIx), connection);

// 4. Anyone can verify after the fact.
const commit = await fetchProofCommit(program, rpc, authorityAddr, memo);
const { valid } = verifyEndToEnd({
  pk, alpha, proof, memo, onChainCommit: commit.onChainCommit,
});`;

export function WalletDemo() {
  const { connection } = useConnection();
  const wallet = useAnchorWallet();

  // Per-session VRF keypair. Persisted only in memory.
  const [vrfKeypair, setVrfKeypair] = useState(() => generateKeyPair());
  const [label, setLabel] = useState(
    "web-demo-" + Math.random().toString(36).slice(2, 7),
  );
  const [authorityExists, setAuthorityExists] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rolls, setRolls] = useState<RecordedRoll[]>([]);

  const rpc = useMemo(() => createRpc(VITE_RPC_URL, VITE_RPC_URL), []);
  const photonWarning = !isLikelyHeliusOrEquivalent(VITE_RPC_URL);

  const phase: Phase = !wallet
    ? "needs-wallet"
    : authorityExists === true
      ? "ready"
      : "needs-init";

  async function checkAuthority() {
    if (!wallet) return;
    setBusy("checking authority…");
    setError(null);
    try {
      const { program } = buildProgramFromWallet(connection, wallet);
      const auth = await fetchAuthority(program, rpc, wallet.publicKey, label);
      setAuthorityExists(!!auth);
    } catch (e) {
      setError(toErr(e));
    } finally {
      setBusy(null);
    }
  }

  async function initAuthority() {
    if (!wallet) return;
    setBusy("submitting init_authority…");
    setError(null);
    try {
      const { program, provider } = buildProgramFromWallet(connection, wallet);
      const { ix, authorityAddress } = await buildInitAuthorityIx(
        program,
        rpc,
        {
          owner: wallet.publicKey,
          pk: vrfKeypair.pk,
          suite: SUITE_EDWARDS25519_SHA512_TAI,
          label,
        },
      );
      const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
        .add(ix);
      const sig = await provider.sendAndConfirm(tx, []);
      setAuthorityExists(true);
      setBusy(null);
      setRolls((prev) => [
        {
          memo: `[init] authority created at ${authorityAddress.toBase58().slice(0, 8)}…`,
          rollValue: 0,
          txSig: sig,
          commitAddr: authorityAddress.toBase58(),
          verifyValid: true,
        },
        ...prev,
      ]);
    } catch (e) {
      setError(toErr(e));
      setBusy(null);
    }
  }

  async function rollOnce() {
    if (!wallet) return;
    setBusy("rolling…");
    setError(null);
    try {
      const { program, provider } = buildProgramFromWallet(connection, wallet);
      const memo = `web-${Date.now()}`;
      const alpha = sha256(new TextEncoder().encode(memo));
      const { proof } = proveVRF(vrfKeypair.sk, alpha);
      const beta = vrfProofToHash(proof);
      const rollValue =
        Number(BigInt("0x" + bytesToHex(beta).slice(0, 16)) % 100n) + 1;

      const { ix, commitAddress } = await buildCommitProofIx(program, rpc, {
        owner: wallet.publicKey,
        label,
        memo,
        alpha,
        proof,
      });
      const sig = await provider.sendAndConfirm(
        new Transaction()
          .add(ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }))
          .add(ix),
        [],
      );

      // Fetch + verify end-to-end against on-chain state.
      const auth = await fetchAuthority(program, rpc, wallet.publicKey, label);
      const commit = auth
        ? await fetchProofCommit(program, rpc, auth.authorityAddress, memo)
        : null;
      const result = commit
        ? verifyEndToEnd({
            pk: vrfKeypair.pk,
            alpha,
            proof,
            memo,
            onChainCommit: commit.onChainCommit,
          })
        : null;

      setRolls((prev) => [
        {
          memo,
          rollValue,
          txSig: sig,
          commitAddr: commitAddress.toBase58(),
          verifyValid: !!result?.valid,
        },
        ...prev,
      ]);
    } catch (e) {
      setError(toErr(e));
    } finally {
      setBusy(null);
    }
  }

  function regenerateKeypair() {
    setVrfKeypair(generateKeyPair());
    setLabel("web-demo-" + Math.random().toString(36).slice(2, 7));
    setAuthorityExists(null);
    setRolls([]);
  }

  return (
    <section className="container-wide flex flex-col gap-8" id="wallet-demo">
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Demo 2 &middot; live devnet via wallet
        </span>
        <h2 className="section-title">
          Roll, commit, verify &mdash; signed by your wallet on devnet.
        </h2>
        <p className="max-w-3xl text-ink-300">
          Connect a wallet, generate a VRF keypair in-browser, and sign the
          real <code className="font-mono">init_authority</code> and{" "}
          <code className="font-mono">commit_proof</code> instructions against
          the deployed program{" "}
          <span className="font-mono text-ink-100">5haPNg9hUP6E…ctZe2c</span> on
          devnet. Each roll is then fetched back and run through{" "}
          <code className="font-mono">verifyEndToEnd</code>.
        </p>
      </header>

      {photonWarning && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-4 text-sm text-amber-200">
          <strong>RPC notice.</strong> Your configured RPC{" "}
          <span className="font-mono">{VITE_RPC_URL}</span> may not serve Light
          Photon. The SDK&rsquo;s validity-proof endpoint will fail without it
          &mdash; set <code className="font-mono">VITE_CC_VRF_RPC_URL</code> to
          a Helius/Triton devnet endpoint.
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_1.2fr]">
        <div className="card flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h3 className="subsection-title">Controls</h3>
            <WalletMultiButton style={{ height: 32, fontSize: 12 }} />
          </div>

          <label className="flex flex-col gap-1 text-sm text-ink-300">
            authority label (PDA seed)
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              className="rounded-md border border-ink-700 bg-ink-950 px-3 py-2 font-mono text-sm text-ink-100 focus:border-accent-500 focus:outline-none"
            />
          </label>

          <dl className="kv">
            <dt>vrf pk</dt>
            <dd>{bytesToHex(vrfKeypair.pk)}</dd>
            <dt>vrf sk</dt>
            <dd className="text-ink-400">never leaves the browser</dd>
            <dt>wallet</dt>
            <dd>
              {wallet ? (
                <a
                  className="text-accent-400 hover:underline"
                  href={explorerAddressUrl(wallet.publicKey)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {wallet.publicKey.toBase58().slice(0, 8)}…
                </a>
              ) : (
                "not connected"
              )}
            </dd>
          </dl>

          <div className="flex flex-wrap gap-2">
            <button
              className="btn-ghost"
              onClick={regenerateKeypair}
              disabled={busy != null}
            >
              new keypair
            </button>
            <button
              className="btn-ghost"
              onClick={checkAuthority}
              disabled={!wallet || busy != null}
            >
              check authority
            </button>
            <button
              className="btn-primary"
              onClick={initAuthority}
              disabled={!wallet || busy != null || phase === "ready"}
            >
              init authority
            </button>
            <button
              className="btn-primary"
              onClick={rollOnce}
              disabled={!wallet || busy != null || phase !== "ready"}
            >
              roll once
            </button>
          </div>

          {busy && (
            <div className="text-sm text-accent-300">{busy}</div>
          )}
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="card flex flex-col gap-3">
          <h3 className="subsection-title">Activity</h3>
          {rolls.length === 0 && (
            <p className="text-sm text-ink-400">
              Connect a wallet, then <span className="font-mono">init authority</span>
              {" "}and <span className="font-mono">roll once</span>. Each tx
              shows up here.
            </p>
          )}
          {rolls.map((r, i) => (
            <div
              key={i}
              className="rounded-lg border border-ink-800 bg-ink-950 p-3"
            >
              <div className="flex items-center gap-3">
                {r.rollValue > 0 ? (
                  <span className="text-3xl font-semibold text-accent-400">
                    {r.rollValue}
                  </span>
                ) : (
                  <span className="text-sm font-semibold text-ink-300">
                    init
                  </span>
                )}
                <span
                  className={
                    "pill ml-auto " +
                    (r.verifyValid
                      ? "border-emerald-500/40 text-emerald-300"
                      : "border-red-500/40 text-red-300")
                  }
                >
                  {r.verifyValid ? "verified" : "verify-FAILED"}
                </span>
              </div>
              <dl className="kv mt-2">
                <dt>memo</dt>
                <dd>{r.memo}</dd>
                <dt>commit</dt>
                <dd>
                  <a
                    className="text-accent-400 hover:underline"
                    href={explorerAddressUrl(r.commitAddr)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {r.commitAddr.slice(0, 12)}…
                  </a>
                </dd>
                <dt>tx</dt>
                <dd>
                  <a
                    className="text-accent-400 hover:underline"
                    href={explorerTxUrl(r.txSig)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {r.txSig.slice(0, 16)}…
                  </a>
                </dd>
              </dl>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <h3 className="subsection-title text-sm">What the code looks like</h3>
        <CodeBlock code={SAMPLE_CODE} />
      </div>
    </section>
  );
}

function toErr(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
