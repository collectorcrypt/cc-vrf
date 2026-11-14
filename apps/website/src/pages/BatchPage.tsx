import { CodeBlock } from "../components/CodeBlock";
import { GITHUB_URL } from "../data/constants";

const SPEC = `leaf = SHA256(0x00 ‖ "ccvrf-batch-v1" ‖ SHA256(memo) ‖ SHA256(alpha) ‖ SHA256(proof80) ‖ beta64)
node = SHA256(0x01 ‖ left ‖ right)
root = RFC 9162 Merkle tree hash over the leaves, in index order`;

const SDK = `import {
  batchLeafV1, buildBatch, buildCommitBatchEventIx,      // operator
  findBatchCommits, fetchAuthority, verifyBatchCommitEndToEnd, // verifier
} from "@collectorcrypt/vrf-client";

// Operator: one commit for many results.
const leaves = results.map((r) => batchLeafV1({ memo: r.memo, alpha: r.alpha, proof: r.proof, beta: r.beta }));
const batch = buildBatch(leaves);                    // { root, count, path(i) }
const ix = await buildCommitBatchEventIx(program, rpc, { owner, label: "gacha", root: batch.root, count: batch.count });

// Verifier: the commit tx, the result's index and path, and the result itself.
const { commits } = await findBatchCommits(program, connection, signature);
const auth = await fetchAuthority(program, rpc, commits[0].owner, commits[0].label);
const r = verifyBatchCommitEndToEnd({
  authority: auth!.onChainAuthority, batch: commits[0],
  memo, alpha, proof, index, path,                   // path = batch.path(index)
});
r.valid; // ECVRF + leaf in the committed root (with the committed count) + frozen authority`;

const RUST = `use cc_vrf_verify::{ring, verify_leaf_v1, LeafV1, Sha256Hasher};

struct Syscall;
impl Sha256Hasher for Syscall {
    fn hashv(parts: &[&[u8]]) -> [u8; 32] { solana_program::hash::hashv(parts).to_bytes() }
}

// Ring account: check owner == cc-vrf and address == PDA(["root_ring", authority]) first.
let e = ring::entry(&ring_data, seq).ok_or(MyError::Evicted)?;   // or your latched copy
let fields = LeafV1 { memo: &memo, alpha: &alpha, proof: &proof, beta: &beta };
require!(verify_leaf_v1::<Syscall>(&e.root, e.count.into(), index, &fields, &path), MyError::NotInBatch);`;

export function BatchPage() {
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
          Batch mode
          <span className="text-ink-400"> &mdash; </span>
          <span className="bg-gradient-to-r from-accent-400 to-accent-600 bg-clip-text text-transparent">
            commit_batch_event
          </span>
        </h1>
        <p className="max-w-3xl text-lg text-ink-300">
          One transaction commits a Merkle root over many VRF results. The
          program proves the frozen authority read-only, exactly as event mode
          does, and emits a{" "}
          <code className="font-mono text-ink-100">VrfBatchCommitted</code> log
          with the root and the leaf count. The cost is one commit per batch,
          whatever the batch holds.
        </p>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">The leaf format (batch spec v1)</h2>
        <div className="card flex flex-col gap-4">
          <CodeBlock code={SPEC} />
          <ul className="flex flex-col gap-2 text-sm text-ink-300">
            <li>
              The leaf binds the whole 80-byte proof (by hash) and the beta, so
              a beta that does not match its proof is publicly provable.
            </li>
            <li>
              Leaves and inner nodes hash with different prefixes (0x00 / 0x01),
              so a node can never pass as a leaf.
            </li>
            <li>
              Verify with the{" "}
              <span className="text-ink-100">count from the commit</span>, never
              one a caller hands you: RFC 9162 sizes only shape the path, and
              one path can fit several sizes.
            </li>
            <li>
              The format is permanent. A change would get a new{" "}
              <code className="font-mono">leaf_version</code>; the program
              accepts only version 1.
            </li>
          </ul>
        </div>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">Verify a batched result</h2>
        <div className="card flex flex-col gap-4">
          <p className="text-sm text-ink-300">
            On the{" "}
            <a
              href="#/verify?mode=batch"
              className="text-accent-300 hover:underline"
            >
              verify page
            </a>
            , pick <span className="font-mono">batch</span> and paste the owner,
            label, memo, alpha, proof, the commit transaction signature, the
            result&rsquo;s leaf index and its inclusion path. Operators can
            deep-link all of it with{" "}
            <span className="font-mono">
              mode=batch&amp;sig=…&amp;index=…&amp;path=…
            </span>
            .
          </p>
          <CodeBlock code={SDK} />
        </div>
      </section>

      <section className="container-wide flex flex-col gap-6">
        <h2 className="section-title">On-chain consumers: the root ring</h2>
        <div className="card flex flex-col gap-4 text-sm text-ink-300">
          <p>
            <code className="font-mono text-ink-100">commit_batch_ring</code>{" "}
            also writes each root into a plain 7,352-byte account at{" "}
            <code className="font-mono">["root_ring", authority]</code> that
            keeps the last 128 batches, so another program can settle against it
            without CPI. The{" "}
            <a
              href={`${GITHUB_URL}/tree/main/crates/cc-vrf-verify`}
              className="text-accent-300 hover:underline"
            >
              cc-vrf-verify
            </a>{" "}
            crate reads it and checks leaves.
          </p>
          <CodeBlock code={RUST} />
          <ul className="flex flex-col gap-2">
            <li>
              Pin the program id, the authority and its ring PDA; check the ring
              account&rsquo;s owner and address.
            </li>
            <li>
              Recompute alpha from your own request data; never take it from the
              caller.
            </li>
            <li>Record each settled alpha so a result settles once.</li>
            <li>
              Copy (latch) the ring entry you depend on before 128 later commits
              evict it.
            </li>
            <li>
              Refund after a timeout if the operator never commits your request.
            </li>
            <li>
              One user drawing many values needs one alpha and{" "}
              <code className="font-mono text-ink-100">vrfStream(beta, …)</code>
              , not the ring.
            </li>
          </ul>
        </div>
      </section>
    </main>
  );
}
