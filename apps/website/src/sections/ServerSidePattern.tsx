import { CodeBlock } from "../components/CodeBlock";

const OPERATOR_CODE = `// operator-side: a Vercel/Node serverless function holds the VRF secret key
// in an env var (or KMS/Nitro Enclave/threshold scheme — your choice).
import {
  proveVRF,
  vrfProofToHash,
  buildCommitProofIx,
  bytesToHex,
  hexToBytes,
  getProgram,
} from "@collectorcrypt/vrf-client";

export async function POST(req: Request) {
  const { requestId } = await req.json();

  const sk = hexToBytes(process.env.VRF_SECRET_KEY_HEX!);
  const memo = \`req-\${requestId}\`;
  const alpha = sha256(new TextEncoder().encode(memo));
  const { proof } = proveVRF(sk, alpha);
  const beta = vrfProofToHash(proof);

  // Submit the on-chain commit (operator pays the ~$0.004 tx fee).
  const { ix } = await buildCommitProofIx(program, rpc, {
    owner: operatorKeypair.publicKey,
    label: "live",
    memo, alpha, proof,
  });
  const sig = await provider.sendAndConfirm(
    new Transaction().add(ix),
    [operatorKeypair],
  );

  // Return the proof + beta to the caller. Consumers verify off-chain.
  return Response.json({
    memo,
    alpha: bytesToHex(alpha),
    proof: bytesToHex(proof),
    beta: bytesToHex(beta),
    txSignature: sig,
  });
}`;

export function ServerSidePattern() {
  return (
    <section
      className="container-wide flex flex-col gap-8"
      id="server-pattern"
    >
      <header className="flex flex-col gap-3">
        <span className="text-xs font-semibold uppercase tracking-wider text-accent-500">
          Production pattern &middot; server-side operator
        </span>
        <h2 className="section-title">
          For real apps, run cc-vrf behind your API.
        </h2>
        <p className="max-w-3xl text-ink-300">
          The wallet demo above is illustrative &mdash; in production you
          don&rsquo;t want every user holding their own VRF keypair. The
          intended pattern is that <em>you</em> run the operator: a serverless
          function (or daemon) that holds the secret key, proves on demand,
          and posts the on-chain commit. Consumers receive the proof + beta
          and can independently verify against the on-chain record.
        </p>
      </header>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.1fr_1fr]">
        <CodeBlock code={OPERATOR_CODE} />
        <div className="flex flex-col gap-4">
          <Box
            title="Where the secret key lives"
            body="Anywhere you trust. The simplest setup is a Vercel env var (VRF_SECRET_KEY_HEX). For higher assurance: AWS KMS with key-derivation, Nitro Enclave with attestation, or an MPC/threshold ECVRF scheme. The on-chain program doesn't care — it only locks the public key."
          />
          <Box
            title="Why this scales"
            body="One operator authority can serve millions of requests. Commits are independent compressed PDAs (each ~$0.00001) so you can run thousands per second if needed. Multiple txs can batch many commits to amortize the base fee further."
          />
          <Box
            title="What clients verify"
            body="They fetch the on-chain commit by (authority, memo_hash), grab the operator-published proof from your API or DB, and run verifyEndToEnd. Four invariants must hold: ECVRF is valid, and sha256(proof / alpha / memo) each match the committed hash."
          />
        </div>
      </div>

      <div className="card flex flex-col gap-3 border-amber-500/30 bg-amber-500/5">
        <h3 className="subsection-title flex items-center gap-2">
          <span className="text-amber-300">Aside</span>
          <span>Why not drand / a distributed randomness beacon?</span>
        </h3>
        <p className="text-sm text-ink-300">
          drand (and other distributed beacons like Internet Computer&rsquo;s
          randomness) is genuinely cool &mdash; a public, BLS-signed
          randomness round published every few seconds, free to consume.
          We considered it. The problem is{" "}
          <span className="text-ink-100">latency</span>: the fastest public
          drand chain publishes a round every <span className="font-mono">3s</span>
          {" "}(quicknet) or <span className="font-mono">30s</span> (League of
          Entropy mainnet). For a Solana game or auction that wants the
          randomness <em>now</em>, that&rsquo;s too slow &mdash; the
          transaction has either landed before the round arrives (so the
          randomness wasn&rsquo;t bindable to it) or your users wait seconds
          per call. ECVRF lets each operator produce a fresh, verifiable
          random value in milliseconds, then commit the hash to chain inside
          the same transaction context. Drand is the right answer for
          slow-tick lotteries; ECVRF is the right answer for tight-loop apps.
        </p>
      </div>
    </section>
  );
}

function Box({ title, body }: { title: string; body: string }) {
  return (
    <div className="card">
      <h3 className="subsection-title mb-1">{title}</h3>
      <p className="text-sm text-ink-300">{body}</p>
    </div>
  );
}
