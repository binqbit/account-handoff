import { hasHandoff } from "../models";
import {
  canonicalJson,
  createSnapshot,
  sha256,
  validateRecordSemantics,
} from "@account-handoff/contracts";
import type {
  AccountingLedger,
  ContinuityCertificate,
  EvidenceRef,
  GrantFlowScope,
  ReceiptBundle,
  Snapshot,
} from "@account-handoff/contracts";
import {
  assessBacking,
  classifyAuthority,
  hasPreservedSchedule,
  vestingRemaining,
} from "@account-handoff/domain";
import { issueContinuityCertificate } from "@account-handoff/evidence";
import { contractAddress, hex, plain } from "@account-handoff/native-adapter";
import type { NativeAccountState } from "@account-handoff/native-adapter";
import { reduceGrantHistory } from "@account-handoff/grant-adapter";
import type { GrantHistory } from "@account-handoff/grant-adapter";
import { buildReadAnchor } from "../record-builders";
import {
  liabilities,
  roleAddress,
  schedules,
  text,
  tupleIdentity,
} from "./observations";
import { proveReceipt } from "./receipt-proof";
import type { WorkspaceCertificateInput } from "./types";

/** Builds a new certificate only after rereading both actual native approval/execution sequences. */
export async function buildWorkspaceCertificate(
  input: WorkspaceCertificateInput,
): Promise<{
  certificate: ContinuityCertificate;
  beforeSnapshot: Snapshot;
  afterSnapshot: Snapshot;
} | null> {
  try {
    const {
      workspace: w,
      profile,
      history,
      beforeFingerprint: before,
      afterFingerprint: after,
      accounting,
    } = input;
    if (!hasHandoff(w)) return null;
    const baseline = w.handoffBaseline ?? w.baseline;
    if (
      !input.records.some(
        (record) =>
          record.kind === "ReceiptBundle" &&
          record.operationId === "GRC-ROTATION-REMOVE-M0",
      ) ||
      !input.records.some(
        (record) =>
          record.kind === "ReceiptBundle" &&
          record.operationId === "GRC-GRANT-SUBMIT-M1",
      )
    )
      return null;
    if (
      profile.status !== "accepted" ||
      !w.pure ||
      !w.contract ||
      w.grantId === null ||
      !baseline ||
      !w.creationEvidence.length ||
      baseline.creatorReserved === undefined ||
      !history.complete ||
      history.toBlock !== after.anchor.number ||
      history.scannedThrough !== after.anchor.number ||
      before.anchor.hash !== baseline.blockHash ||
      before.metadataSha256 !== profile.metadataSha256 ||
      after.metadataSha256 !== profile.metadataSha256 ||
      before.runtimeCodeHash !== after.runtimeCodeHash ||
      after.runtimeCodeHash !== profile.runtimeCodeHash
    )
      return null;
    const baselineAccount = await input.connection.readAccount(
      w.pure,
      hex(before.anchor.hash, 32),
    );
    const baselineCreator = await input.connection.readAccount(
      w.creator?.account ?? w.M0.account,
      hex(before.anchor.hash, 32),
    );
    if (String(baselineCreator.reserved) !== baseline.creatorReserved)
      return null;
    const current = input.currentAccounts[w.pure];
    if (
      !current ||
      current.address !== w.pure ||
      baselineAccount.address !== w.pure ||
      current.mappedTo !== w.pure ||
      baselineAccount.mappedTo !== w.pure ||
      input.currentGrant.grantee !== contractAddress(w.pure) ||
      baseline.grant.grantee !== input.currentGrant.grantee ||
      accounting.anchor.blockHash !== after.anchor.hash ||
      accounting.pure !== w.pure ||
      accounting.creator !== (w.creator?.account ?? w.M0.account) ||
      !assessBacking(accounting).backed
    )
      return null;
    if (
      current.proxies.some((p) => p.proxyType !== "Any" || p.delay !== 0) ||
      baselineAccount.proxies.some(
        (p) => p.proxyType !== "Any" || p.delay !== 0,
      )
    )
      return null;
    const currentTuples = current.proxies.map((p) => ({
      delegate: p.delegate,
      proxyType: "Any" as const,
      delay: "0" as const,
    }));
    const originalTuples = baselineAccount.proxies.map((p) => ({
      delegate: p.delegate,
      proxyType: "Any" as const,
      delay: "0" as const,
    }));
    if (
      classifyAuthority(currentTuples, w.M0.account, w.M1.account) !==
        "M1Only" ||
      classifyAuthority(originalTuples, w.M0.account, w.M1.account) !== "M0Only"
    )
      return null;
    const oldSchedules = schedules(baselineAccount.vesting),
      newSchedules = schedules(current.vesting);
    const tuple = oldSchedules.find(
      (entry) => vestingRemaining(entry, BigInt(before.anchor.number)) > 0n,
    );
    if (
      !tuple ||
      vestingRemaining(tuple, BigInt(after.anchor.number)) === 0n ||
      !hasPreservedSchedule(oldSchedules, newSchedules)
    )
      return null;
    const creation = history.entries.find(
      (entry) =>
        entry.eventName === "GrantCreated" && entry.grantId === w.grantId,
    );
    if (
      !creation ||
      text(creation.args.grantee).toLowerCase() !== contractAddress(w.pure) ||
      creation.blockNumber > before.anchor.number
    )
      return null;
    if (
      !history.firstVestingRelease ||
      history.firstVestingRelease.blockHash !== w.baseline?.blockHash ||
      history.firstVestingRelease.blockNumber > before.anchor.number
    )
      return null;
    const creationMarker = w.creationEvidence.find(
      (entry) =>
        entry.kind === "native_chain" &&
        entry.sourceId &&
        /^0x[0-9a-f]{64}$/.test(entry.sourceId),
    );
    if (!creationMarker || !creationMarker.sourceId) return null;
    const pureBlock = creationMarker.locator.split("/")[0];
    if (!pureBlock || !/^0x[0-9a-f]{64}$/.test(pureBlock)) return null;
    const pureReceipt = await input.connection.receiptAt(
      hex(pureBlock, 32),
      hex(creationMarker.sourceId, 32),
    );
    const pureEvent = pureReceipt.events.find(
      (event) => event.pallet === "Proxy" && event.name === "PureCreated",
    );
    if (
      !pureReceipt.nestedSuccess ||
      !pureEvent ||
      roleAddress(pureEvent.data.pure) !== w.pure ||
      roleAddress(pureEvent.data.who) !== w.M0.account ||
      pureReceipt.blockNumber > creation.blockNumber ||
      (pureReceipt.blockNumber === creation.blockNumber &&
        creation.txIndex !== null &&
        pureReceipt.txIndex >= creation.txIndex)
    )
      return null;
    const pureCreationEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${pureReceipt.blockHash}/${pureReceipt.txIndex}`,
      sourceId: pureReceipt.txHash,
      contentSha256: await sha256(canonicalJson(plain(pureReceipt))),
    };

    const beforeAnchor = buildReadAnchor(profile, before),
      afterAnchor = buildReadAnchor(profile, after);
    const grantEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${creation.blockHash}/${creation.txIndex}/${creation.eventIndex}`,
      sourceId: profile.profileId,
      contentSha256: await sha256(canonicalJson(plain(creation.args))),
    };
    const stateEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${after.anchor.hash}:state:${w.pure}`,
      sourceId: profile.profileId,
      contentSha256: await sha256(canonicalJson(plain(current))),
    };
    const baseEvidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${before.anchor.hash}:state:${w.pure}`,
      sourceId: profile.profileId,
      contentSha256: await sha256(canonicalJson(plain(baselineAccount))),
    };
    const beforeHolds = liabilities(baselineAccount.holds, [baseEvidence]);
    const beforeReserves = liabilities(baselineAccount.namedReserves, [
      baseEvidence,
    ]);
    const beforeLiabilities = [...beforeHolds, ...beforeReserves].reduce(
      (sum, entry) => sum + BigInt(entry.amountNative),
      0n,
    );
    if (
      baselineAccount.reserved !== beforeLiabilities ||
      baselineAccount.proxyDeposit !==
        BigInt(accounting.creatorHistoricalDepositNative) ||
      BigInt(baseline.creatorReserved) <
        BigInt(accounting.creatorHistoricalDepositNative)
    )
      return null;
    const beforeAccounting: AccountingLedger = {
      ...accounting,
      anchor: beforeAnchor,
      proxyDepositRecordedNative: String(baselineAccount.proxyDeposit),
      creatorCurrentAggregateReservedNative: baseline.creatorReserved,
      pureProxyIncrementNative: "0",
      pureFreeNative: String(baselineAccount.free),
      pureReservedNative: String(baselineAccount.reserved),
      pureFrozenNative: String(baselineAccount.frozen),
      pureReasonHolds: beforeHolds,
      pureNamedReserves: beforeReserves,
      pureOtherTracedReservedLiabilitiesNative: "0",
      pureBackedLiabilitiesNative: String(beforeLiabilities),
      unexplainedReservedDeltaNative: "0",
      adjustmentProvenance: [],
      creationProvenance: [pureCreationEvidence],
    };
    const priorEntries = structuredClone(
      history.entries.filter(
        (entry) => entry.blockNumber <= before.anchor.number,
      ),
    );
    const beforeScope = reduceGrantHistory(priorEntries, true, []);
    const grantScope = (
      scope: GrantHistory["scope"],
      rounds: readonly number[],
      evidence: EvidenceRef[],
    ): GrantFlowScope => ({
      policyId: "vestry-single-round-demo-v1",
      status: scope,
      grantId: w.grantId,
      observedRounds: rounds.map(String),
      historyComplete: true,
      blockingReasons: [],
      causalEvidence: evidence,
      reconciliationDigest: null,
      futureExternalActionsPrevented: false,
    });
    const mapping = (
      state: NativeAccountState,
      anchor: Snapshot["anchor"],
      evidence: EvidenceRef[],
    ) => [
      {
        role: "P" as const,
        account: w.pure!,
        h160: contractAddress(w.pure!),
        branch: "normal_non_EE" as const,
        status: "verified" as const,
        originalAccountEntry: state.mappedTo,
        effectiveReverseAccount: state.mappedTo,
        mappingHoldNative: liabilities(state.holds, evidence)
          .filter((entry) => entry.reason.includes("AddressMapping"))
          .reduce((sum, entry) => sum + BigInt(entry.amountNative), 0n)
          .toString(),
        anchor,
        evidence,
      },
    ];
    const beforeSnapshot = await createSnapshot({
      profile,
      anchor: beforeAnchor,
      pure: w.pure,
      authority: {
        state: "M0Only",
        fullInventoryObserved: true,
        tuples: originalTuples,
        unsupportedTuplesRaw: [],
        evidence: [baseEvidence],
      },
      accounting: beforeAccounting,
      mapping: mapping(baselineAccount, beforeAnchor, [baseEvidence]),
      grantScope: grantScope(beforeScope.scope, beforeScope.rounds, [
        grantEvidence,
      ]),
      sourceEvidence: [baseEvidence, grantEvidence],
      completeness: "complete",
    });
    const afterSnapshot = await createSnapshot({
      profile,
      anchor: afterAnchor,
      pure: w.pure,
      authority: {
        state: "M1Only",
        fullInventoryObserved: true,
        tuples: currentTuples,
        unsupportedTuplesRaw: [],
        evidence: [stateEvidence],
      },
      accounting,
      mapping: mapping(current, afterAnchor, [stateEvidence]),
      grantScope: grantScope(history.scope, history.rounds, [grantEvidence]),
      sourceEvidence: [stateEvidence, grantEvidence],
      completeness: "complete",
    });
    if (
      (await validateRecordSemantics(beforeSnapshot)).length ||
      (await validateRecordSemantics(afterSnapshot)).length
    )
      return null;
    const removals = input.records
      .filter(
        (record): record is ReceiptBundle =>
          record.kind === "ReceiptBundle" &&
          record.operationId === "GRC-ROTATION-REMOVE-M0",
      )
      .sort((a, b) =>
        Number(
          BigInt(b.anchor?.blockNumber ?? "0") -
            BigInt(a.anchor?.blockNumber ?? "0"),
        ),
      );
    const continuations = input.records.filter(
      (record): record is ReceiptBundle =>
        record.kind === "ReceiptBundle" &&
        record.operationId === "GRC-GRANT-SUBMIT-M1",
    );
    for (const removal of removals)
      for (const continuation of continuations) {
        if (
          !removal.anchor ||
          !continuation.anchor ||
          BigInt(continuation.anchor.blockNumber) <
            BigInt(removal.anchor.blockNumber) ||
          continuation.causalBusinessContext.grantId !== w.grantId
        )
          continue;
        const removeProof = await proveReceipt(input, removal, baselineAccount),
          continueProof = await proveReceipt(
            input,
            continuation,
            baselineAccount,
          );
        if (!removeProof || !continueProof) continue;
        const originalIdentity = {
          P: w.pure,
          hP: contractAddress(w.pure),
          grantee: baseline.grant.grantee,
          reverseMappingAccount: baselineAccount.mappedTo!,
          milestone0Tuple: tuple,
          tupleMultiplicity: String(
            oldSchedules.filter(
              (entry) => tupleIdentity(entry) === tupleIdentity(tuple),
            ).length,
          ),
          creationReceipt: pureCreationEvidence,
          grantId: w.grantId,
          contractAddress: w.contract,
          mappingBranch: "normal_non_EE" as const,
          originalAccountEntry: baselineAccount.mappedTo!,
          mappingEvidence: [baseEvidence],
          grantCreationReceipt: grantEvidence,
        };
        const identity = {
          ...originalIdentity,
          grantee: input.currentGrant.grantee,
          reverseMappingAccount: current.mappedTo,
          originalAccountEntry: current.mappedTo,
          mappingEvidence: [stateEvidence],
          milestone0Tuple: newSchedules.find(
            (entry) => tupleIdentity(entry) === tupleIdentity(tuple),
          )!,
          tupleMultiplicity: String(
            newSchedules.filter(
              (entry) => tupleIdentity(entry) === tupleIdentity(tuple),
            ).length,
          ),
        };
        const certificate = await issueContinuityCertificate({
          before: beforeAnchor,
          after: afterSnapshot,
          identity,
          originalIdentity,
          M0: w.M0,
          M1: w.M1,
          removal,
          continuation,
          removalSigners: [w.participants.A, w.participants.D],
          continuationSigners: [w.participants.A, w.participants.D],
          requiredAD: [w.participants.A, w.participants.D],
          profileId: profile.profileId,
          profileDigest: profile.digest,
          removalEnvelope: removeProof.envelope,
          continuationEnvelope: continueProof.envelope,
          removalAttempt: removeProof.attempt,
          continuationAttempt: continueProof.attempt,
          removalParticipationEvidence: removeProof.participation,
          continuationParticipationEvidence: continueProof.participation,
          evidence: [
            baseEvidence,
            stateEvidence,
            grantEvidence,
            ...removeProof.participation,
            ...continueProof.participation,
          ],
        });
        if (
          certificate.verdict === "verified" ||
          certificate.verdict === "historically_verified_current_drift"
        )
          return { certificate, beforeSnapshot, afterSnapshot };
      }
    return null;
  } catch {
    return null;
  }
}
