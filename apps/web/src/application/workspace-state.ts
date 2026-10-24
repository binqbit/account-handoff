import { createKeyMulti } from "@polkadot/util-crypto";
import { u8aToHex } from "dedot/utils";

import { makeController } from "@account-handoff/domain";
import {
  account,
  hex,
  object,
  type Hex,
} from "@account-handoff/native-adapter";

import type { WorkspaceInput, RuntimeMode } from "../ui-contract";
import type { WorkspaceRecord, ChainView, HandoffWorkspace } from "./models";

import { id } from "./values";
export function restoreWorkspace(input: unknown): WorkspaceRecord {
  const w = object(input);
  if (
    typeof w["id"] !== "string" ||
    typeof w["name"] !== "string" ||
    !["LOCAL", "DEMO", "LIVE"].includes(String(w["mode"]))
  )
    throw new Error("Invalid workspace metadata");
  const value = w as unknown as WorkspaceRecord;
  value.continuityCertificate = null;
  account(value.M0.account);
  if (value.M1) account(value.M1.account);
  Object.values(value.participants)
    .filter((value): value is string => value !== null)
    .forEach(account);
  if (value.handoffBaseline) {
    for (const name of ["free", "reserved", "frozen", "proxyDeposit"] as const)
      value.handoffBaseline.account[name] = BigInt(
        value.handoffBaseline.account[name],
      );
  }
  if (value.baseline) {
    for (const name of ["free", "reserved", "frozen", "proxyDeposit"] as const)
      value.baseline.account[name] = BigInt(value.baseline.account[name]);
  }
  return value;
}
export function createWorkspaceRecord(
  input: WorkspaceInput,
  mode: RuntimeMode,
  genesis: Hex,
  selectedAddress?: string,
): WorkspaceRecord {
  const old = input.oldMembers.map(account);
  const codec = {
    deriveMultisig: (members: readonly string[], threshold: number) =>
      u8aToHex(createKeyMulti([...members], threshold)),
  };
  const M0 = makeController(old, input.threshold, "M0", codec);
  if (
    input.controllerAddress &&
    account(input.controllerAddress) !== M0.account
  )
    throw new Error(
      "The multisig address does not match these members and threshold.",
    );
  if (input.reviewers.length !== 2)
    throw new Error("Two separate reviewers are required.");
  const reviewers = input.reviewers.map(account);
  if (new Set(reviewers).size !== 2)
    throw new Error("Reviewers must be distinct.");
  const w: WorkspaceRecord = {
    id: id(),
    name: input.name.trim() || "New workspace",
    createdAt: new Date().toISOString(),
    mode: mode,
    genesis: genesis,
    M0,
    creator: M0,
    handoffId: "initial",
    handoffs: [],
    M1: null,
    participants: {
      A: old[0]!,
      B: old[1]!,
      C: old[2]!,
      D: null,
      F: account(input.funder),
      R1: reviewers[0]!,
      R2: reviewers[1]!,
      S: selectedAddress ?? old[0]!,
    },
    pure: input.beneficiary ? account(input.beneficiary) : null,
    contract: input.contract ? hex(input.contract, 20) : null,
    grantId: input.grantId ?? null,
    creationEvidence: [],
    history: [],
    baseline: null,
    continuityCertificate: null,
  };
  if (input.newMembers?.length) return planHandoff(w, input.newMembers);
  return w;
}

/** Drafting changes no authority. A saved plan cannot be silently replaced. */
export function planHandoff(
  workspace: WorkspaceRecord,
  members: string[],
): WorkspaceRecord {
  if (workspace.M1)
    throw new Error(
      "A replacement group is already planned for this workspace.",
    );
  const next: string[] = members.map(account);
  const M1 = makeController(next, 2, "M1", {
    deriveMultisig: (signers, threshold) =>
      u8aToHex(createKeyMulti([...signers], threshold)),
  });
  const shared = [
    workspace.participants.A,
    workspace.participants.B,
    workspace.participants.C,
  ].filter((member) => next.includes(member));
  if (shared.length !== 2)
    throw new Error(
      "This profile replaces one of the three members. Keep two current members.",
    );
  return {
    ...workspace,
    M1,
    participants: {
      ...workspace.participants,
      A: shared[0]!,
      B: shared[1]!,
      C: workspace.M0.members.find((member) => !next.includes(member))!,
      D: next.find((member) => !workspace.M0.members.includes(member))!,
    },
  };
}

export function captureHandoffBaseline(
  workspace: WorkspaceRecord,
  chain: ChainView,
): WorkspaceRecord["baseline"] {
  const state = workspace.pure ? chain.accounts[workspace.pure] : null;
  const creator =
    chain.accounts[workspace.creator?.account ?? workspace.M0.account];
  if (
    !state ||
    !chain.grant ||
    !creator ||
    chain.fingerprint.genesis !== workspace.genesis
  )
    throw new Error(
      "Read the beneficiary, grant and creator reserve before planning a handoff.",
    );
  return structuredClone({
    account: state,
    grant: chain.grant,
    blockHash: chain.fingerprint.anchor.hash,
    creatorReserved: String(creator.reserved),
  });
}

/** Called only after the coordinator revalidates the finalized removal receipt. */
export function advanceHandoff(
  workspace: HandoffWorkspace,
  removalReceiptId: string,
): WorkspaceRecord {
  const controller = { ...workspace.M1, role: "M0" as const };
  return {
    ...workspace,
    creator: workspace.creator ?? workspace.M0,
    handoffs: [
      ...(workspace.handoffs ?? []),
      {
        id: workspace.handoffId ?? "initial",
        completedAt: new Date().toISOString(),
        from: workspace.M0,
        to: workspace.M1,
        removalReceiptId,
        certificate: workspace.continuityCertificate ?? null,
      },
    ],
    handoffId: id(),
    M0: controller,
    M1: null,
    handoffBaseline: null,
    continuityCertificate: null,
    participants: {
      ...workspace.participants,
      A: workspace.participants.A,
      B: workspace.participants.B,
      C: workspace.participants.D,
      D: null,
    },
  };
}
