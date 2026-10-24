import { parseBoundedJson } from "@account-handoff/contracts";
import type { ChainProfile } from "@account-handoff/contracts";
import {
  validateFreshOperation,
  assessPreparation,
  type FreshOperationInput,
  assessNativeEra,
} from "@account-handoff/domain";
import {
  NativeConnection,
  object,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import { type WalletSession } from "@account-handoff/wallet-adapter";

import { type Journal } from "@account-handoff/local-store";

import type { ChainView, LocalDescriptor, PendingOperation } from "./models";

import { buildResourceReview } from "./resources";
import { assessCurrentWallet } from "./qualification";

import type { WalletAccount } from "@account-handoff/wallet-adapter";
export interface PendingCheckContext {
  pending: PendingOperation;
  connection: NativeConnection;
  journal: Journal;
  wallets: WalletSession[];
  getSelected: () => WalletAccount | null;
  clearRecovery: () => void;
  descriptor: () => Promise<LocalDescriptor | null>;
  profile: (
    f: NativeFingerprint,
    descriptor: LocalDescriptor | null,
  ) => Promise<ChainProfile>;
  operationInputs: (
    pending: PendingOperation,
    f: NativeFingerprint,
  ) => Promise<FreshOperationInput & { accounts: ChainView["accounts"] }>;
}
export async function checkPendingOperation({
  pending: p,
  connection,
  journal,
  wallets,
  getSelected,
  clearRecovery,
  descriptor: loadDescriptor,
  profile,
  operationInputs,
}: PendingCheckContext): Promise<PendingOperation> {
  await journal.assertLease(p.lease);
  const f = await connection.fingerprint();
  if (
    f.genesis !== p.prepared.fingerprint.genesis ||
    f.runtimeCodeHash !== p.prepared.fingerprint.runtimeCodeHash ||
    f.metadataSha256 !== p.prepared.fingerprint.metadataSha256
  )
    throw new Error(
      "The runtime changed after review. A new qualification is required.",
    );
  const originalPayload = object(
    parseBoundedJson(p.context.originalSignPayloadJcsUtf8),
  );
  const signingBlock = originalPayload["blockNumber"];
  if (typeof signingBlock !== "string" || !/^0x[0-9a-f]+$/i.test(signingBlock))
    throw new Error(
      "The exact original signing block is missing; the validity period cannot be verified.",
    );
  const era = assessNativeEra(
    p.context.era,
    BigInt(signingBlock),
    BigInt(f.anchor.number),
  );
  if (era.state === "expired") {
    const message = `The native packet expired at block ${era.death}. A new explicit review is required; the multisig proposal is checked separately.`;
    if (["prepared", "wallet-requested", "signed"].includes(p.stage)) {
      p.stage = "stale";
      p.blockers = [message];
      await journal.setPreference("recovery", null);
      clearRecovery();
      await journal.releaseLease(p.lease);
    }
    throw new Error(message);
  }
  if (era.state === "not_yet_valid")
    throw new Error(
      "The original native packet block is not yet confirmed on the current network.",
    );
  if (getSelected()?.address !== p.signer) throw new Error("Signer changed");
  const selected = getSelected();
  const wallet = wallets.find((session) => session.source === selected?.source);
  if (
    !wallet ||
    `${wallet.source}:${wallet.version}` !== p.context.walletBuildId
  )
    throw new Error("The wallet or its version changed after review.");
  const descriptor = await loadDescriptor();
  if (
    p.runScope &&
    (!descriptor?.qualified ||
      `${descriptor.runId}:${descriptor.generation}` !== p.runScope)
  )
    throw new Error("The LOCAL run changed or was reset.");
  const currentProfile = await profile(f, descriptor);
  if (currentProfile.digest !== p.envelope.intent.profileDigest)
    throw new Error("Network qualification changed after review.");
  const fresh = await operationInputs(p, f);
  if (String(fresh.accounts[p.signer]!.nonce) !== p.context.nonce)
    throw new Error("The signer nonce changed. Reconciliation is required.");
  const blockers = validateFreshOperation(fresh);
  blockers.push(
    ...assessCurrentWallet({
      profile: currentProfile,
      envelope: p.envelope,
      signer: p.signer,
      phase: p.phase,
      signingContext: p.context,
      wallet,
    }).blockers,
  );
  const snapshot = (await journal.listRecords("Snapshot")).find(
    (record) =>
      record.digest === p.envelope.intent.expectedState.snapshotDigest,
  );
  if (snapshot?.kind !== "Snapshot")
    throw new Error("The operation preparation snapshot is missing.");
  blockers.push(
    ...assessPreparation(currentProfile, snapshot, p.envelope.requiredGateIds),
  );
  if (blockers.length)
    throw new Error(blockers.map((b) => b.message).join("; "));
  p.resources = buildResourceReview(fresh, {
    decimals: f.tokenDecimals,
    symbol: f.tokenSymbol,
  });
  return p;
}
