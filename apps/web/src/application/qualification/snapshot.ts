import {
  canonicalJson,
  createSnapshot,
  OPERATION_REQUIREMENTS,
  sha256,
  verifyReviewedSigningContext,
} from "@account-handoff/contracts";
import type {
  EvidenceRef,
  GateId,
  GateRecord,
  Snapshot,
} from "@account-handoff/contracts";
import {
  assessPreparation,
  validateFreshOperation,
} from "@account-handoff/domain";
import type { Blocker } from "@account-handoff/domain";
import type { PreparationSnapshotInput } from "./types";
import { assessCurrentWallet } from "./wallet";

/** Complete only the observations needed for this operation, without inventing its future outputs. */
export async function completePreparationSnapshot(
  input: PreparationSnapshotInput,
): Promise<{ snapshot: Snapshot; blockers: Blocker[] }> {
  const {
    profile,
    snapshot: initial,
    envelope,
    freshInput: fresh,
    signingContext: context,
    wallet,
  } = input;
  const blockers = validateFreshOperation(fresh);
  if (
    fresh.envelope.digest !== envelope.digest ||
    initial.profileDigest !== profile.digest ||
    fresh.profileDigest !== profile.digest ||
    initial.anchor.blockHash !== envelope.anchor.blockHash
  )
    blockers.push({
      code: "PreparationContextMismatch",
      message:
        "Preparation inputs are not bound to the same profile and reviewed anchor",
      guardIds: ["SG-05", "SG-06"],
    });
  const facts = JSON.parse(
    JSON.stringify(
      {
        accounts: fresh.accounts,
        authority: fresh.authorityTuples,
        proposal: fresh.proposal,
        grant: fresh.grant,
        timeUnixSeconds: fresh.timeUnixSeconds,
      },
      (_key, value: unknown) => {
        if (typeof value === "number") {
          if (!Number.isSafeInteger(value))
            throw new Error("Imprecise native numeric observation");
          return String(value);
        }
        return typeof value === "bigint" ? value.toString() : value;
      },
    ),
  );
  const evidence: EvidenceRef = {
    kind: "native_chain",
    locator: `${initial.anchor.blockHash}:preparation:${envelope.intent.operationId}`,
    sourceId: profile.profileId,
    contentSha256: await sha256(canonicalJson(facts)),
  };
  const currentWallet = assessCurrentWallet({
    profile,
    envelope,
    signer: fresh.signer,
    phase: fresh.phase,
    signingContext: context,
    wallet,
  });
  let walletOk = currentWallet.walletAccepted;
  try {
    await verifyReviewedSigningContext(context);
  } catch {
    walletOk = false;
  }
  const walletEvidence: EvidenceRef = {
    kind: "local_artifact",
    locator: `wallet:${wallet?.source ?? "missing"}:${wallet?.version ?? "unknown"}:native-signPayload-capability`,
    sourceId: context.walletBuildId,
    contentSha256: await sha256(
      canonicalJson({
        source: wallet?.source ?? null,
        version: wallet?.version ?? null,
        accounts: wallet?.accounts ?? [],
        signer: context.signer,
        requestDigest: context.signPayloadSha256,
      }),
    ),
  };
  const assessments: GateRecord[] = [];
  const actionGate = (
    id: GateId,
    accepted: boolean,
    reason: string,
    refs = [evidence],
  ) =>
    assessments.push({
      id,
      status: accepted ? "accepted" : "not_qualified",
      stage: "action_input",
      subject: envelope.intent.operationId,
      anchor: initial.anchor,
      evidence: accepted ? refs : [],
      reason,
    });
  actionGate(
    "Q-WALLET",
    walletOk,
    "An explicit supported account and unchanged signature-only wallet request are required.",
    [walletEvidence],
  );
  const fundingCodes = new Set([
    "UnknownResourceRequirement",
    "BalanceUnavailable",
    "InsufficientLiquidity",
  ]);
  actionGate(
    "Q-FUNDING",
    !blockers.some((b) => fundingCodes.has(b.code)),
    "Every actual payer must cover value, deposits, fee budget and existential minimum.",
  );
  const inventoryOk =
    fresh.authorityTuples !== null &&
    !!fresh.pure &&
    !blockers.some((b) =>
      ["AuthorityUnavailable", "AuthorityChanged"].includes(b.code),
    );
  actionGate(
    "Q-INVENTORY",
    inventoryOk,
    "Full current native delegate inventory, including unsupported entries, is required.",
  );
  const scopeOk =
    envelope.intent.operationId === "GRC-GRANT-CREATE"
      ? fresh.grant === null
      : fresh.grantHistoryComplete &&
        fresh.grantScope === "EligibleSingleRound";
  actionGate(
    "Q-GRANT-SCOPE",
    scopeOk &&
      !blockers.some((b) =>
        [
          "GrantBindingChanged",
          "GrantScopeChanged",
          "MilestoneChanged",
          "ContinuationUnavailable",
        ].includes(b.code),
      ),
    "Creation policy or complete original-round grant history must match this action.",
  );
  actionGate(
    "Q-READINESS",
    walletOk && currentWallet.readinessAccepted,
    "Distinct controller roles and available supported A/D wallet accounts establish pre-sign readiness; custody and future signatures remain unproven.",
    [walletEvidence],
  );
  const required =
    OPERATION_REQUIREMENTS[envelope.intent.operationId].requiredGateIds;
  for (const assessment of assessments) {
    if (required.includes(assessment.id) && assessment.status !== "accepted")
      blockers.push({
        code: "MissingActionInput",
        message: `${assessment.id}: ${assessment.reason}`,
        guardIds: [assessment.id],
      });
  }
  const missing = required.some(
    (id) =>
      ![...profile.gateRecords, ...assessments].some(
        (item) =>
          item.id === id &&
          item.status === "accepted" &&
          item.stage !== "finalized_output",
      ),
  );
  const completed = await createSnapshot({
    profile,
    anchor: initial.anchor,
    pure: initial.pure,
    authority: initial.authority,
    mapping: initial.mapping,
    accounting: fresh.accounting ?? initial.accounting,
    grantScope: initial.grantScope,
    observations: {
      ...initial.observations,
      preparation: {
        availability: "observed",
        value: facts,
        anchor: initial.anchor,
        decoderId:
          profile.bindingEvidence.generatedNativeTypesSha256 ?? "unqualified",
        evidence: [evidence],
        errorCode: null,
      },
    },
    gateAssessments: assessments,
    sourceEvidence: [...initial.sourceEvidence, evidence],
    completeness: blockers.length === 0 && !missing ? "complete" : "incomplete",
  });
  blockers.push(...assessPreparation(profile, completed, required));
  return { snapshot: completed, blockers };
}
