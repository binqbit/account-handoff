import { blake2AsHex } from "dedot/utils";
import { canonicalJson } from "@account-handoff/contracts";
import { otherSignatories } from "@account-handoff/domain";
import {
  NativeConnection,
  account,
  hex,
  type NativeReceipt,
} from "@account-handoff/native-adapter";
import { type Journal } from "@account-handoff/local-store";
import type { ChainView, PendingOperation } from "./models";
import { nativeActionFromTree } from "./record-builders";
import type { OperationRecovery } from "./models";
export async function resolveRecovery(
  {
    recovery: r,
    workspaceId,
    chain,
    journal,
    connection,
    tabId,
  }: {
    recovery: OperationRecovery | null;
    workspaceId: string | undefined;
    chain: ChainView | null;
    journal: Journal;
    connection: NativeConnection;
    tabId: string;
  },
  idValue: string,
): Promise<{
  recovered: PendingOperation;
  receipt: NativeReceipt | null;
  resumeSigned: boolean;
}> {
  if (!r || r.id !== idValue)
    throw new Error(
      "The wallet response is unknown; the exact signed bytes were not saved. Manual reconciliation is required.",
    );
  const envelope = await journal.getRecord(r.envelopeId);
  if (
    envelope?.kind !== "FrozenEnvelope" ||
    !chain ||
    workspaceId !== r.workspaceId ||
    envelope.intent.profileDigest !== chain.profile.digest
  )
    throw new Error(
      "The original workspace and exact runtime profile are required.",
    );
  let attempt = r.attemptId ? await journal.getRecord(r.attemptId) : undefined;
  if (!r.attemptId) {
    const accepted = (await journal.listProgress(r.context.requestId)).filter(
      (progress) =>
        progress.phase === "SignedAttemptRecorded" &&
        progress.envelopeDigest === envelope.digest &&
        canonicalJson(progress.reviewedSigningContext) ===
          canonicalJson(r.context),
    );
    const ids = [
      ...new Set(
        accepted
          .map((progress) => progress.acceptedSignedAttemptId)
          .filter((value): value is string => value !== null),
      ),
    ];
    if (ids.length === 1) attempt = await journal.getRecord(ids[0]!);
  }
  if (
    attempt?.kind !== "SignedAttempt" ||
    attempt.recordScope !== "local_journal" ||
    !attempt.signedExtrinsicBytes
  )
    throw new Error(
      "The exact signed bytes were not saved. Manual reconciliation is required.",
    );
  if (
    envelope?.kind !== "FrozenEnvelope" ||
    envelope.digest !== attempt.envelopeDigest ||
    canonicalJson(attempt.reviewedSigningContext) !== canonicalJson(r.context)
  )
    throw new Error("The saved signing context does not match the attempt.");
  const resumeSigned = r.stage === "signed";
  const receipt = resumeSigned
    ? null
    : await connection.findReceipt(hex(attempt.signedExtrinsicHash, 32));
  if (!receipt && !resumeSigned)
    throw new Error(
      "The exact transaction was not found; its status remains unknown.",
    );
  const payload = JSON.parse(r.context.originalSignPayloadJcsUtf8);
  const innerAction = nativeActionFromTree(envelope.callTree);
  let action = innerAction;
  if (resumeSigned) {
    if (
      blake2AsHex(hex(attempt.signedExtrinsicBytes)) !==
        attempt.signedExtrinsicHash ||
      blake2AsHex(hex(r.context.outerCallBytes)) !== r.context.outerCallHash
    )
      throw new Error(
        "The saved signed bytes or RuntimeCall have a different hash.",
      );
    if (envelope.controller) {
      const weight = envelope.resources.multisigInnerMaxWeight;
      if (!weight)
        throw new Error("The saved multisig weight limit is missing.");
      let timepoint: { height: number; index: number } | undefined;
      if (r.context.operationPhase === "multisig_final") {
        const proposal = r.context.nativeProposalDigest
          ? await journal.getRecordByDigest(r.context.nativeProposalDigest)
          : undefined;
        if (
          proposal?.kind !== "NativeProposal" ||
          !proposal.timepoint ||
          proposal.multisig !== envelope.controller.account ||
          proposal.innerCallHash !== envelope.innerRuntimeCallHash ||
          proposal.profileDigest !== envelope.intent.profileDigest
        )
          throw new Error(
            "The exact saved native proposal context is missing.",
          );
        timepoint = {
          height: Number(proposal.timepoint.height),
          index: Number(proposal.timepoint.index),
        };
        if (
          !Number.isSafeInteger(timepoint.height) ||
          !Number.isSafeInteger(timepoint.index)
        )
          throw new Error("The saved proposal timepoint is invalid.");
      }
      action = {
        kind: "multisig",
        threshold: 2,
        others: otherSignatories(envelope.controller, r.signer),
        timepoint,
        inner: innerAction,
        weight: {
          refTime: BigInt(weight.refTime),
          proofSize: BigInt(weight.proofSize),
        },
      };
    }
    if (
      connection.transaction(innerAction).callHex !==
        envelope.innerRuntimeCallBytes ||
      connection.transaction(action).callHex !== r.context.outerCallBytes
    )
      throw new Error(
        "The current native decoder does not reproduce the exact saved calls.",
      );
  }
  const lease = await journal.acquireLease(
    `operation:${r.workspaceId}`,
    tabId,
    300000,
  );
  if (!lease) throw new Error("Another tab controls reconciliation.");
  const recovered: PendingOperation = {
    id: r.id,
    workspaceId: r.workspaceId,
    actionId: envelope.intent.operationId,
    fields: {},
    stage: resumeSigned ? "signed" : "unknown",
    title: r.title,
    description: resumeSigned
      ? "The same signed bytes were restored. Submission requires a separate explicit command."
      : "Reconciling the saved signed attempt.",
    action,
    innerAction,
    envelope,
    prepared: {
      payload,
      rawPayload: hex(
        r.context.outerCallBytes +
          r.context.encodedExtraPayloadBytes.slice(2) +
          r.context.additionalSignedPayloadBytes.slice(2),
      ),
      callHex: hex(r.context.outerCallBytes),
      callHash: hex(r.context.outerCallHash, 32),
      signer: account(r.signer),
      extra: [],
      encodedExtra: hex(r.context.encodedExtraPayloadBytes),
      additionalSigned: hex(r.context.additionalSignedPayloadBytes),
      createdAt: 0,
      fingerprint: chain.fingerprint,
    },
    context: r.context,
    signedAttempt: attempt,
    signedBytes: attempt.signedExtrinsicBytes
      ? hex(attempt.signedExtrinsicBytes)
      : null,
    receipt: null,
    lease,
    blockers: [],
    signer: r.signer,
    phase: r.context.operationPhase,
    route: [],
    resources: [],
    runScope:
      chain.descriptor?.mode === "LOCAL"
        ? `${chain.descriptor.runId}:${chain.descriptor.generation}`
        : null,
  };

  return { recovered, receipt, resumeSigned };
}
