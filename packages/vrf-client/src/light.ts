import { PublicKey } from "@solana/web3.js";
import {
  batchAddressTree,
  bn,
  CompressedAccountWithMerkleContext,
  featureFlags,
  PackedAccounts,
  Rpc,
  selectStateTreeInfo,
  SystemAccountMetaConfig,
  VERSION,
} from "@lightprotocol/stateless.js";

/**
 * Force the SDK into V2 mode so our address derivations + state-tree usage
 * match the on-chain program's ADDRESS_TREE_V2 expectation.
 */
export function forceLightV2() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (featureFlags as any).version = VERSION.V2;
}

/**
 * For CREATE flows (init_authority, commit_proof): builds the validity-proof
 * bundle + packed remaining-accounts list needed to mint a new compressed
 * PDA at the given address.
 */
export async function buildCreateContext(
  rpc: Rpc,
  programId: PublicKey,
  newCompressedAddress: PublicKey,
  existingInputs: {
    hash: Uint8Array;
    tree: PublicKey;
    queue: PublicKey;
  }[] = [],
) {
  forceLightV2();
  const addressTree = new PublicKey(batchAddressTree);
  const proofRes = await rpc.getValidityProofV0(
    existingInputs.map((i) => ({
      hash: bn(i.hash),
      tree: i.tree,
      queue: i.queue,
    })),
    [
      {
        tree: addressTree,
        queue: addressTree,
        address: bn(newCompressedAddress.toBytes()),
      },
    ],
  );

  const stateTreeInfos = await rpc.getStateTreeInfos();
  const stateTreeInfo = selectStateTreeInfo(stateTreeInfos);

  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  const remainingAccounts =
    PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);
  const addressMtIdx = remainingAccounts.insertOrGet(addressTree);
  const outputStIdx = remainingAccounts.insertOrGet(stateTreeInfo.queue);

  const packedAddressTreeInfo = {
    rootIndex: proofRes.rootIndices[proofRes.rootIndices.length - 1],
    addressMerkleTreePubkeyIndex: addressMtIdx,
    addressQueuePubkeyIndex: addressMtIdx,
  };

  return {
    proof: { 0: proofRes.compressedProof },
    packedAddressTreeInfo,
    outputStateTreeIndex: outputStIdx,
    remainingAccountMetas: remainingAccounts.toAccountMetas().remainingAccounts,
  };
}

/**
 * For commit_proof specifically: one input (the existing authority, treated
 * as read-only on chain) + one new address (the commit). Both indices come
 * from the same getValidityProofV0 call so they reference the same proof
 * and the same packed-accounts list.
 */
export async function buildCommitProofContext(
  rpc: Rpc,
  programId: PublicKey,
  authorityExisting: CompressedAccountWithMerkleContext,
  newCommitAddress: PublicKey,
) {
  forceLightV2();
  const addressTree = new PublicKey(batchAddressTree);

  const proofRes = await rpc.getValidityProofV0(
    [
      {
        hash: authorityExisting.hash,
        tree: authorityExisting.treeInfo.tree,
        queue: authorityExisting.treeInfo.queue,
      },
    ],
    [
      {
        tree: addressTree,
        queue: addressTree,
        address: bn(newCommitAddress.toBytes()),
      },
    ],
  );

  const stateTreeInfos = await rpc.getStateTreeInfos();
  const stateTreeInfo = selectStateTreeInfo(stateTreeInfos);

  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  const remainingAccounts =
    PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);

  // Order matters: insert in the order the program will reference them via
  // packed indices. Both the authority's tree and the address tree are
  // shared in V2 (batched merkle tree), but we still pack the auth's tree
  // first since the authority meta is constructed first below.
  const authMerkleTreePubkeyIndex = remainingAccounts.insertOrGet(
    authorityExisting.treeInfo.tree,
  );
  const authQueuePubkeyIndex = remainingAccounts.insertOrGet(
    authorityExisting.treeInfo.queue,
  );
  const addressMtIdx = remainingAccounts.insertOrGet(addressTree);
  const outputStIdx = remainingAccounts.insertOrGet(stateTreeInfo.queue);

  const authorityReadOnlyMeta = {
    treeInfo: {
      rootIndex: proofRes.rootIndices[0],
      proveByIndex: true,
      merkleTreePubkeyIndex: authMerkleTreePubkeyIndex,
      queuePubkeyIndex: authQueuePubkeyIndex,
      leafIndex: authorityExisting.leafIndex,
    },
    address: authorityExisting.address,
  };

  const packedAddressTreeInfo = {
    rootIndex: proofRes.rootIndices[proofRes.rootIndices.length - 1],
    addressMerkleTreePubkeyIndex: addressMtIdx,
    addressQueuePubkeyIndex: addressMtIdx,
  };

  return {
    proof: { 0: proofRes.compressedProof },
    authorityReadOnlyMeta,
    packedAddressTreeInfo,
    outputStateTreeIndex: outputStIdx,
    remainingAccountMetas: remainingAccounts.toAccountMetas().remainingAccounts,
  };
}

/**
 * For event-mode commits: builds a validity-proof bundle for an existing
 * authority treated as read-only. No new compressed address is created.
 */
export async function buildReadOnlyAuthorityContext(
  rpc: Rpc,
  programId: PublicKey,
  authorityExisting: CompressedAccountWithMerkleContext,
) {
  forceLightV2();
  const proofRes = await rpc.getValidityProofV0(
    [
      {
        hash: authorityExisting.hash,
        tree: authorityExisting.treeInfo.tree,
        queue: authorityExisting.treeInfo.queue,
      },
    ],
    [],
  );

  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  const remainingAccounts =
    PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);
  const authMerkleTreePubkeyIndex = remainingAccounts.insertOrGet(
    authorityExisting.treeInfo.tree,
  );
  const authQueuePubkeyIndex = remainingAccounts.insertOrGet(
    authorityExisting.treeInfo.queue,
  );

  const authorityReadOnlyMeta = {
    treeInfo: {
      rootIndex: proofRes.rootIndices[0],
      proveByIndex: true,
      merkleTreePubkeyIndex: authMerkleTreePubkeyIndex,
      queuePubkeyIndex: authQueuePubkeyIndex,
      leafIndex: authorityExisting.leafIndex,
    },
    address: authorityExisting.address,
  };

  return {
    proof: { 0: proofRes.compressedProof },
    authorityReadOnlyMeta,
    remainingAccountMetas: remainingAccounts.toAccountMetas().remainingAccounts,
  };
}

/**
 * For MUTATE flows (freeze_authority, revoke_authority): builds the
 * validity-proof bundle + account meta for an existing compressed PDA.
 */
export async function buildMutateContext(
  rpc: Rpc,
  programId: PublicKey,
  existing: CompressedAccountWithMerkleContext,
) {
  forceLightV2();
  const proofRes = await rpc.getValidityProofV0(
    [
      {
        hash: existing.hash,
        tree: existing.treeInfo.tree,
        queue: existing.treeInfo.queue,
      },
    ],
    [],
  );

  const stateTreeInfos = await rpc.getStateTreeInfos();
  const stateTreeInfo = selectStateTreeInfo(stateTreeInfos);

  const systemAccountConfig = SystemAccountMetaConfig.new(programId);
  const remainingAccounts =
    PackedAccounts.newWithSystemAccountsV2(systemAccountConfig);
  const merkleTreePubkeyIndex = remainingAccounts.insertOrGet(
    existing.treeInfo.tree,
  );
  const queuePubkeyIndex = remainingAccounts.insertOrGet(
    existing.treeInfo.queue,
  );
  const outputStateTreeIndex = remainingAccounts.insertOrGet(
    stateTreeInfo.queue,
  );

  const accountMeta = {
    treeInfo: {
      rootIndex: proofRes.rootIndices[0],
      proveByIndex: true,
      merkleTreePubkeyIndex,
      queuePubkeyIndex,
      leafIndex: existing.leafIndex,
    },
    address: existing.address,
    outputStateTreeIndex,
  };

  return {
    proof: { 0: proofRes.compressedProof },
    accountMeta,
    remainingAccountMetas: remainingAccounts.toAccountMetas().remainingAccounts,
  };
}
