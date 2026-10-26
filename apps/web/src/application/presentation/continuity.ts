import { validateRecord, type Controller } from "@account-handoff/contracts";
import type { WorkspaceView } from "../../ui-contract";
import { currentHandoffHistory } from "../models";
import type { ChainView, WorkspaceHistory, WorkspaceRecord } from "../models";
import { authority, eq, mapped, stateFor } from "./shared";

function after(left: WorkspaceHistory, right: WorkspaceHistory): boolean {
  return (
    left.receipt.blockNumber > right.receipt.blockNumber ||
    (left.receipt.blockNumber === right.receipt.blockNumber &&
      left.receipt.txIndex > right.receipt.txIndex)
  );
}
function sameController(left: Controller, right: Controller): boolean {
  return (
    eq(left.account, right.account) &&
    left.role === right.role &&
    left.threshold === right.threshold &&
    left.members.length === right.members.length &&
    left.members.every((member, index) => eq(member, right.members[index]))
  );
}
/** The application supplies a certificate only after reconstructing its native evidence. */
function hasBoundCertificate(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): boolean {
  const certificate = workspace.continuityCertificate;
  const baseline = workspace.handoffBaseline ?? workspace.baseline;
  if (
    !workspace.M1 ||
    !chain ||
    !certificate ||
    !baseline ||
    !validateRecord(certificate).ok
  )
    return false;
  return (
    ["verified", "historically_verified_current_drift"].includes(
      certificate.verdict,
    ) &&
    Object.values(certificate.criteria).every(
      (criterion) => criterion === "passed",
    ) &&
    certificate.removalReceiptId !== null &&
    certificate.milestone1SubmissionReceiptId !== null &&
    certificate.removalReceiptId !==
      certificate.milestone1SubmissionReceiptId &&
    certificate.removalParticipationEvidence.length > 0 &&
    certificate.continuationParticipationEvidence.length > 0 &&
    certificate.grantScopeAtSubmission === "EligibleSingleRound" &&
    certificate.profileId === chain.profile.profileId &&
    certificate.profileDigest === chain.profile.digest &&
    sameController(certificate.M0, workspace.M0) &&
    sameController(certificate.M1, workspace.M1) &&
    eq(certificate.identity.P, workspace.pure) &&
    eq(certificate.identity.reverseMappingAccount, workspace.pure) &&
    eq(certificate.identity.originalAccountEntry, workspace.pure) &&
    eq(certificate.identity.hP, baseline.account.mappedAddress) &&
    eq(certificate.identity.grantee, baseline.grant.grantee) &&
    eq(certificate.identity.contractAddress, workspace.contract) &&
    certificate.identity.grantId === workspace.grantId &&
    eq(certificate.before.blockHash, baseline.blockHash) &&
    BigInt(certificate.after.blockNumber) <=
      BigInt(chain.fingerprint.anchor.number) &&
    [certificate.before, certificate.after].every((anchor) =>
      Object.values(anchor.contextBindings).every(
        (context) =>
          eq(context.genesis, workspace.genesis) &&
          eq(context.genesis, chain.fingerprint.genesis) &&
          context.metadataSha256 === chain.profile.metadataSha256 &&
          eq(context.runtimeCodeHash, chain.profile.runtimeCodeHash),
      ),
    )
  );
}
export function proof(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): { continuity: WorkspaceView["continuity"]; detail: string } {
  const removals = currentHandoffHistory(workspace).filter(
    (row) =>
      row.operationId === "GRC-ROTATION-REMOVE-M0" &&
      row.receipt.businessExecuted &&
      row.receipt.outerSuccess &&
      row.receipt.nestedSuccess &&
      eq(row.grantId, workspace.grantId),
  );
  const submissions = currentHandoffHistory(workspace).filter(
    (row) =>
      row.operationId === "GRC-GRANT-SUBMIT-M1" &&
      row.receipt.businessExecuted &&
      row.receipt.outerSuccess &&
      row.receipt.nestedSuccess &&
      eq(row.grantId, workspace.grantId),
  );
  const baseline = workspace.handoffBaseline ?? workspace.baseline;
  const identityPreserved =
    !!baseline &&
    eq(baseline.account.address, workspace.pure) &&
    !!workspace.grantId;
  const continued =
    identityPreserved &&
    hasBoundCertificate(workspace, chain) &&
    submissions.some((submission) =>
      removals.some(
        (removal) =>
          submission.attemptId !== removal.attemptId &&
          submission.receipt.txHash !== removal.receipt.txHash &&
          after(submission, removal),
      ),
    );
  if (continued) {
    const state = authority(workspace, chain);
    const grantMatches =
      !!chain?.grant &&
      eq(chain.grant.grantee, baseline.grant.grantee) &&
      eq(chain.grant.funder, baseline.grant.funder) &&
      chain.grant.milestones.every((milestone) => milestone.round === 0);
    const current = chain?.currentContinuity;
    const currentMatched =
      current?.status === "matched" &&
      current.blockHash === chain?.fingerprint.anchor.hash &&
      current.profileDigest === chain?.profile.digest &&
      current.certificateDigest === workspace.continuityCertificate?.digest;
    if (
      state !== "M1" ||
      !mapped(stateFor(chain, workspace.pure)) ||
      !grantMatches ||
      !currentMatched ||
      workspace.continuityCertificate?.verdict ===
        "historically_verified_current_drift"
    )
      return {
        continuity: "drift",
        detail:
          "Separate finalized receipts record M0 removal and a later M1 submission on the same grant. Current state differs or needs verification; historical receipts remain available.",
      };
    return {
      continuity: "continued",
      detail:
        "The baseline, separate M0 removal receipt and later M1 submission on the same grant are saved. The current beneficiary and controller match. This does not imply approval or release of the next tranche.",
    };
  }
  if (removals.length && identityPreserved) {
    if (
      submissions.some((submission) =>
        removals.some((removal) => after(submission, removal)),
      )
    )
      return {
        continuity: "rotated",
        detail:
          "The replacement group submitted to the same grant. The active-vesting continuity certificate is unavailable; the separate finalized receipts remain in history.",
      };
    return {
      continuity: "rotated",
      detail:
        chain?.grant && !chain.grant.milestones.some((m) => m.state === 0)
          ? "The replacement group controls the same beneficiary. There is no open milestone to submit; review the grant and its saved history."
          : "M0 removal has a separate finalized receipt. Submit the next milestone through M1 and verify its outcome to complete the handoff.",
    };
  }
  if (!chain && workspace.history.length)
    return {
      continuity: "unknown",
      detail:
        "Local history is available. The current network and completeness of evidence have not been verified yet.",
    };
  return {
    continuity: "not-started",
    detail:
      "The baseline, M0 removal and subsequent M1 submission do not yet form a complete chain of evidence.",
  };
}
