import type {
  ChainProfile,
  FrozenEnvelope,
  GateId,
  GrantFlowScope,
  Snapshot,
} from "@account-handoff/contracts";
import type { Blocker } from "./result.js";

export function assessPreparation(
  profile: ChainProfile,
  snapshot: Snapshot,
  requiredGateIds: readonly GateId[],
): Blocker[] {
  const blockers: Blocker[] = [];
  const add = (
    code: string,
    message: string,
    guardIds: string[] = [],
  ): void => {
    blockers.push({ code, message, guardIds });
  };
  if (profile.status !== "accepted")
    add("UnqualifiedProfile", "The active network profile is not accepted", [
      "SG-04",
    ]);
  if (
    snapshot.profileDigest !== profile.digest ||
    snapshot.profileId !== profile.profileId
  )
    add("ProfileMismatch", "Snapshot belongs to another profile revision", [
      "SG-05",
    ]);
  if (snapshot.completeness !== "complete")
    add(
      "IncompleteCheckpoint",
      "Required finalized observations are incomplete",
      ["SG-06"],
    );
  const facts = [...profile.gateRecords, ...snapshot.gateAssessments];
  for (const id of requiredGateIds) {
    const passed = facts.some(
      (fact) =>
        fact.id === id &&
        fact.status === "accepted" &&
        fact.stage !== "finalized_output" &&
        fact.evidence.length > 0,
    );
    if (!passed)
      add(
        "MissingQualification",
        `${id} has no accepted prerequisite evidence`,
        [id],
      );
  }
  return blockers;
}

export function isReviewCurrent(
  envelope: FrozenEnvelope,
  profileDigest: string,
  nowUnixSeconds: bigint,
): boolean {
  if (envelope.status !== "frozen" && envelope.status !== "approved")
    return false;
  if (
    !envelope.semanticIntentDigest ||
    envelope.intent.profileDigest !== profileDigest
  )
    return false;
  const expires = envelope.intent.expectedState.localReviewExpiresAtUnixSeconds;
  return expires === null || nowUnixSeconds <= BigInt(expires);
}

/** A proven scope breach is sticky. Incomplete observations can never erase it. */
export function reconcileGrantScope(
  previous: GrantFlowScope,
  next: GrantFlowScope,
): GrantFlowScope {
  if (previous.status !== "ScopeBreached") return next;
  return {
    ...next,
    status: "ScopeBreached",
    blockingReasons: Array.from(
      new Set([...previous.blockingReasons, ...next.blockingReasons]),
    ),
    causalEvidence: [...previous.causalEvidence, ...next.causalEvidence],
  };
}
