import { canonicalJson } from "@account-handoff/contracts";
import type {
  AccountingLedger,
  CanonicalRecord,
  ContinuityCertificate,
} from "@account-handoff/contracts";
import {
  assessBacking,
  hasPreservedSchedule,
  vestingRemaining,
} from "@account-handoff/domain";
import type { GrantHistory } from "@account-handoff/grant-adapter";
import type { ChainView, WorkspaceRecord } from "../models";
import type { WorkspaceCertificateInput } from "./types";
import { schedules, tupleIdentity } from "./observations";

/** A matching certificate remains historical evidence; it does not assert a current state. */
export function certificateMatchesWorkspace(
  certificate: ContinuityCertificate,
  workspace: WorkspaceRecord,
  profile: WorkspaceCertificateInput["profile"],
): boolean {
  return (
    (certificate.verdict === "verified" ||
      certificate.verdict === "historically_verified_current_drift") &&
    certificate.profileId === profile.profileId &&
    certificate.profileDigest === profile.digest &&
    certificate.identity.P === workspace.pure &&
    certificate.identity.contractAddress === workspace.contract &&
    certificate.identity.grantId === workspace.grantId &&
    certificate.before.blockHash === workspace.baseline?.blockHash &&
    canonicalJson(certificate.M0) === canonicalJson(workspace.M0) &&
    canonicalJson(certificate.M1) === canonicalJson(workspace.M1)
  );
}

export function certificateReferencesPresent(
  certificate: ContinuityCertificate,
  records: readonly CanonicalRecord[],
): boolean {
  const removal = records.find(
    (record) =>
      record.kind === "ReceiptBundle" &&
      record.recordId === certificate.removalReceiptId,
  );
  const continuation = records.find(
    (record) =>
      record.kind === "ReceiptBundle" &&
      record.recordId === certificate.milestone1SubmissionReceiptId,
  );
  return (
    removal?.kind === "ReceiptBundle" &&
    continuation?.kind === "ReceiptBundle" &&
    removal.recordId !== continuation.recordId &&
    removal.operationId === "GRC-ROTATION-REMOVE-M0" &&
    continuation.operationId === "GRC-GRANT-SUBMIT-M1" &&
    removal.profileDigest === certificate.profileDigest &&
    continuation.profileDigest === certificate.profileDigest &&
    removal.businessEffect === "historically_verified" &&
    continuation.businessEffect === "historically_verified"
  );
}

/** Recomputed from the fresh checkpoint. Missing evidence cannot erase the historical certificate. */
export function assessCurrentContinuity(input: {
  workspace: WorkspaceRecord;
  chain: ChainView;
  accounting: AccountingLedger | null;
  history: GrantHistory | null;
}): NonNullable<ChainView["currentContinuity"]> {
  const { workspace: w, chain: c, accounting, history } = input;
  const certificate = w.continuityCertificate;
  const result: NonNullable<ChainView["currentContinuity"]> = {
    certificateDigest: certificate?.digest ?? "",
    profileDigest: c.profile.digest,
    blockHash: c.fingerprint.anchor.hash,
    status: "matched",
    reasons: [],
  };
  let unavailable = false;
  const reject = (reason: string, missing = false) => {
    result.reasons.push(reason);
    unavailable ||= missing;
  };
  if (!certificate || !certificateMatchesWorkspace(certificate, w, c.profile)) {
    reject(
      "The historical certificate does not bind the current workspace and profile.",
      true,
    );
  } else {
    if (
      c.profile.status !== "accepted" ||
      c.fingerprint.genesis !== c.profile.genesis ||
      c.fingerprint.metadataSha256 !== c.profile.metadataSha256 ||
      c.fingerprint.runtimeCodeHash !== c.profile.runtimeCodeHash
    )
      reject(
        "The current native runtime no longer matches the accepted proof profile.",
      );
    const pure = w.pure ? c.accounts[w.pure] : undefined;
    if (!pure) reject("Current beneficiary account is unavailable.", true);
    else {
      if (
        pure.address !== certificate.identity.P ||
        pure.mappedTo !== certificate.identity.P ||
        pure.mappedAddress !== certificate.identity.hP
      )
        reject("Current beneficiary or persisted reverse mapping differs.");
      if (
        pure.proxies.length !== 1 ||
        pure.proxies[0]!.delegate !== w.M1.account ||
        pure.proxies[0]!.proxyType !== "Any" ||
        pure.proxies[0]!.delay !== 0
      )
        reject("M1 is no longer the exact sole Any/0 controller.");
      try {
        const tuple = certificate.identity.milestone0Tuple;
        const current = schedules(pure.vesting);
        if (
          !hasPreservedSchedule([tuple], current) ||
          current.filter((item) => tupleIdentity(item) === tupleIdentity(tuple))
            .length !== Number(certificate.identity.tupleMultiplicity)
        )
          reject("The original vesting tuple or its multiplicity changed.");
        if (
          tuple.clockDomain !== "native-block-number" ||
          vestingRemaining(tuple, BigInt(c.fingerprint.anchor.number)) === 0n
        )
          reject(
            "The original vesting schedule is no longer active at the current native block.",
          );
      } catch {
        reject("Current vesting data cannot be interpreted.", true);
      }
    }
    if (!c.grant) reject("The current grant is unavailable.", true);
    else if (
      c.grant.grantee !== certificate.identity.grantee ||
      c.grant.funder !== w.baseline?.grant.funder ||
      c.grant.token !== w.baseline.grant.token ||
      c.grant.threshold !== 2 ||
      c.grant.milestoneCount !== 2 ||
      c.grant.milestones.length !== 2 ||
      c.grant.milestones.some((milestone) => milestone.round !== 0)
    )
      reject("Current grant identity, policy or round differs.");
    if (
      !history?.complete ||
      history.toBlock !== c.fingerprint.anchor.number ||
      history.scannedThrough !== c.fingerprint.anchor.number
    )
      reject(
        "Complete grant history at the current checkpoint is unavailable.",
        true,
      );
    else if (history.scope !== "EligibleSingleRound")
      reject(
        "Current grant history no longer has the supported single-round scope.",
      );
    if (
      !accounting ||
      accounting.anchor.blockHash !== c.fingerprint.anchor.hash
    )
      reject("Current reserve and hold accounting is unavailable.", true);
    else {
      try {
        if (
          accounting.pure !== w.pure ||
          accounting.creator !== w.M0.account ||
          !assessBacking(accounting).backed ||
          accounting.creatorCurrentAggregateReservedNative === null ||
          BigInt(accounting.creatorCurrentAggregateReservedNative) <
            BigInt(accounting.creatorHistoricalDepositNative) ||
          accounting.pureProxyIncrementNative !== "0" ||
          accounting.proxyDepositRecordedNative !==
            accounting.creatorHistoricalDepositNative ||
          (pure &&
            (BigInt(accounting.pureReservedNative) !== pure.reserved ||
              BigInt(accounting.pureFreeNative) !== pure.free ||
              BigInt(accounting.pureFrozenNative) !== pure.frozen))
        )
          reject("Current reserve and hold backing no longer reconciles.");
      } catch {
        reject("Current accounting cannot be interpreted.", true);
      }
    }
  }
  if (result.reasons.length)
    result.status = unavailable ? "unavailable" : "drift";
  return result;
}
