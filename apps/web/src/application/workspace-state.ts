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
import type { WorkspaceRecord } from "./models";

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
  account(value.M1.account);
  Object.values(value.participants).forEach(account);
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
  const next = input.newMembers.map(account);
  const shared = old.filter((a) => next.includes(a));
  if (
    input.threshold !== 2 ||
    shared.length !== 2 ||
    old.length !== 3 ||
    next.length !== 3
  )
    throw new Error(
      "Two 2-of-3 groups are required, with shared A/B members and a new member D.",
    );
  const codec = {
    deriveMultisig: (members: readonly string[], threshold: number) =>
      u8aToHex(createKeyMulti([...members], threshold)),
  };
  const M0 = makeController(old, 2, "M0", codec);
  const M1 = makeController(next, 2, "M1", codec);
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
    M1,
    participants: {
      A: shared[0]!,
      B: shared[1]!,
      C: old.find((a) => !next.includes(a))!,
      D: next.find((a) => !old.includes(a))!,
      F: account(input.funder),
      R1: reviewers[0]!,
      R2: reviewers[1]!,
      S: selectedAddress ?? shared[0]!,
    },
    pure: input.beneficiary ? account(input.beneficiary) : null,
    contract: input.contract ? hex(input.contract, 20) : null,
    grantId: input.grantId ?? null,
    creationEvidence: [],
    history: [],
    baseline: null,
  };
  return w;
}
