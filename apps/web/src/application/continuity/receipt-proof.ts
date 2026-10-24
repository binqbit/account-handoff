import { hasHandoff } from "../models";
import {
  canonicalJson,
  hexBytes,
  sha256,
  validateRecordSemantics,
} from "@account-handoff/contracts";
import type {
  EvidenceRef,
  FrozenEnvelope,
  NativeProposal,
  ReceiptBundle,
  SignedAttempt,
} from "@account-handoff/contracts";
import { hasPreservedSchedule } from "@account-handoff/domain";
import { hex, plain } from "@account-handoff/native-adapter";
import type { NativeAccountState } from "@account-handoff/native-adapter";
import { blake2AsHex } from "dedot/utils";
import { buildReceipt } from "../record-builders";
import {
  bigint,
  field,
  liabilities,
  object,
  roleAddress,
  schedules,
} from "./observations";
import { inspectM1ProofRoute } from "./routes";
import type { ReceiptProof, WorkspaceCertificateInput } from "./types";

function eventProjection(receipt: ReceiptBundle): unknown {
  return receipt.events.map(({ rawEvidence: _raw, ...event }) => event);
}
export async function proveReceipt(
  input: WorkspaceCertificateInput,
  candidate: ReceiptBundle,
  baselineAccount: NativeAccountState,
): Promise<ReceiptProof | null> {
  const { connection, workspace: w, records } = input;
  if (!hasHandoff(w)) return null;
  if (
    !candidate.anchor ||
    candidate.profileDigest !== input.profile.digest ||
    candidate.operationPhase !== "multisig_final" ||
    candidate.businessEffect !== "historically_verified" ||
    candidate.status !== "finalized_success"
  )
    return null;
  const attempt = records.find(
    (record): record is SignedAttempt =>
      record.kind === "SignedAttempt" &&
      record.recordId === candidate.signedAttemptId,
  );
  const envelope =
    attempt &&
    records.find(
      (record): record is FrozenEnvelope =>
        record.kind === "FrozenEnvelope" &&
        record.digest === attempt.envelopeDigest,
    );
  const proposal =
    attempt &&
    records.find(
      (record): record is NativeProposal =>
        record.kind === "NativeProposal" &&
        record.digest === attempt.reviewedSigningContext.nativeProposalDigest,
    );
  if (
    !attempt ||
    !envelope ||
    !proposal ||
    proposal.timepoint === null ||
    proposal.state !== "present" ||
    proposal.depositor !== w.participants.A ||
    proposal.approvals.length !== 1 ||
    proposal.approvals[0] !== w.participants.A ||
    proposal.multisig !== w.M1.account ||
    proposal.innerCallHash !== envelope.innerRuntimeCallHash ||
    attempt.signer !== w.participants.D ||
    attempt.reviewedSigningContext.operationPhase !== "multisig_final" ||
    envelope.controller?.account !== w.M1.account ||
    canonicalJson(envelope.requiredSigners) !==
      canonicalJson([w.participants.A, w.participants.D])
  )
    return null;
  if (
    (
      await Promise.all(
        [candidate, attempt, envelope, proposal].map(validateRecordSemantics),
      )
    ).some((issues) => issues.length > 0)
  )
    return null;
  const finalNative =
    input.verifiedReceipts?.find(
      (entry) =>
        entry.receipt.txHash === candidate.extrinsicHash &&
        entry.receipt.blockHash === candidate.blockHash,
    )?.receipt ??
    (await connection.receiptAt(
      hex(candidate.blockHash, 32),
      hex(candidate.extrinsicHash, 32),
    ));
  if (
    !finalNative.nestedSuccess ||
    !finalNative.businessExecuted ||
    String(finalNative.txIndex) !== candidate.extrinsicIndex
  )
    return null;
  const finalInspection = await connection.inspectExtrinsic(
    hex(candidate.blockHash, 32),
    Number(candidate.extrinsicIndex),
  );
  if (
    blake2AsHex(finalInspection.bytes) !== candidate.extrinsicHash ||
    finalInspection.callHex !== attempt.reviewedSigningContext.outerCallBytes ||
    finalInspection.callHex === "0x"
  )
    return null;
  if (
    attempt.signedExtrinsicBytes !== null &&
    finalInspection.bytes !== attempt.signedExtrinsicBytes
  )
    return null;
  const finalInner = inspectM1ProofRoute(finalInspection, envelope, w, false);
  const firstHeight = Number(proposal.timepoint.height),
    firstIndex = Number(proposal.timepoint.index);
  if (
    !Number.isSafeInteger(firstHeight) ||
    !Number.isSafeInteger(firstIndex) ||
    firstHeight > finalNative.blockNumber
  )
    return null;
  const firstHash = await connection.api.rpc.chain_getBlockHash(firstHeight);
  if (!firstHash) return null;
  const firstInspection = await connection.inspectExtrinsic(
    hex(firstHash, 32),
    firstIndex,
  );
  const firstNative = await connection.receiptAt(
    hex(firstHash, 32),
    blake2AsHex(firstInspection.bytes),
  );
  if (!firstNative.outerSuccess || firstNative.businessExecuted) return null;
  const firstInner = inspectM1ProofRoute(firstInspection, envelope, w, true);
  if (canonicalJson(plain(firstInner)) !== canonicalJson(plain(finalInner)))
    return null;
  const start = firstNative.events.find(
    (event) => event.pallet === "Multisig" && event.name === "NewMultisig",
  );
  const complete = finalNative.events.find(
    (event) => event.pallet === "Multisig" && event.name === "MultisigExecuted",
  );
  if (
    !start ||
    !complete ||
    roleAddress(start.data.approving) !== w.participants.A ||
    roleAddress(start.data.multisig) !== w.M1.account ||
    field(start.data, "callHash", "call_hash") !==
      envelope.innerRuntimeCallHash ||
    roleAddress(complete.data.approving) !== w.participants.D ||
    roleAddress(complete.data.multisig) !== w.M1.account ||
    field(complete.data, "callHash", "call_hash") !==
      envelope.innerRuntimeCallHash
  )
    return null;
  const actualTimepoint = object(complete.data.timepoint);
  if (
    bigint(actualTimepoint.height).toString() !== proposal.timepoint.height ||
    bigint(actualTimepoint.index).toString() !== proposal.timepoint.index
  )
    return null;
  const checkpoint = await connection.readAccount(
    w.pure!,
    hex(candidate.blockHash, 32),
  );
  if (
    checkpoint.mappedTo !== w.pure ||
    checkpoint.proxies.length !== 1 ||
    checkpoint.proxies[0]!.delegate !== w.M1.account ||
    checkpoint.proxies[0]!.proxyType !== "Any" ||
    checkpoint.proxies[0]!.delay !== 0 ||
    checkpoint.proxyDeposit !== baselineAccount.proxyDeposit ||
    !hasPreservedSchedule(
      schedules(baselineAccount.vesting),
      schedules(checkpoint.vesting),
    )
  )
    return null;
  const checkpointLiabilities = [
    ...liabilities(checkpoint.holds, []),
    ...liabilities(checkpoint.namedReserves, []),
  ].reduce((sum, entry) => sum + BigInt(entry.amountNative), 0n);
  if (checkpoint.reserved !== checkpointLiabilities) return null;
  let actualRound: string | null = null;
  if (candidate.operationId === "GRC-GRANT-SUBMIT-M1") {
    const events = input.history.entries.filter(
      (entry) =>
        entry.eventName === "MilestoneSubmitted" &&
        entry.blockHash === candidate.blockHash &&
        String(entry.txIndex) === candidate.extrinsicIndex &&
        entry.grantId === w.grantId,
    );
    if (
      events.length !== 1 ||
      events[0]!.roundBefore !== 0 ||
      events[0]!.rawExtrinsic !== finalInspection.bytes
    )
      return null;
    actualRound = "0";
  }
  const recomputed = await buildReceipt(
    envelope,
    attempt,
    finalNative,
    candidate.anchor,
    "multisig_final",
    {
      postconditions: candidate.postconditions,
      ...(actualRound !== null ? { roundAtIntendedEvent: actualRound } : {}),
      orderedHistoryComplete: input.history.complete,
    },
  );
  if (
    recomputed.businessEffect !== "historically_verified" ||
    recomputed.status !== "finalized_success"
  )
    return null;
  if (
    canonicalJson(eventProjection(recomputed)) !==
    canonicalJson(eventProjection(candidate))
  )
    return null;
  const participation: EvidenceRef[] = [
    {
      kind: "native_chain",
      locator: `${firstHash}/${firstIndex}`,
      sourceId: firstNative.txHash,
      contentSha256: await sha256(hexBytes(firstInspection.callHex)),
    },
    {
      kind: "native_chain",
      locator: `${candidate.blockHash}/${candidate.extrinsicIndex}`,
      sourceId: candidate.extrinsicHash,
      contentSha256: await sha256(hexBytes(finalInspection.callHex)),
    },
  ];
  return { receipt: candidate, envelope, attempt, proposal, participation };
}
