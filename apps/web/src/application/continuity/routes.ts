import { hasHandoff } from "../models";
import { canonicalJson } from "@account-handoff/contracts";
import type { FrozenEnvelope } from "@account-handoff/contracts";
import type { WorkspaceRecord } from "../models";
import type { InspectedExtrinsic } from "./types";
import { bigint, object, roleAddress, text } from "./observations";

function callParts(value: unknown): {
  pallet: string;
  name: string;
  params: Record<string, unknown>;
} {
  const call = object(value);
  const inner = object(call.palletCall);
  return {
    pallet: text(call.pallet),
    name: text(inner.name),
    params: object(inner.params),
  };
}
export function inspectM1ProofRoute(
  inspection: InspectedExtrinsic,
  envelope: FrozenEnvelope,
  w: WorkspaceRecord,
  first: boolean,
): unknown {
  if (!hasHandoff(w)) return null;
  const expectedSigner = first ? w.participants.A : w.participants.D;
  if (inspection.signer !== expectedSigner)
    throw new Error("Unexpected participant in M1 route");
  const outer = callParts(inspection.call);
  if (
    outer.pallet !== "Multisig" ||
    outer.name !== "AsMulti" ||
    bigint(outer.params.threshold) !== 2n ||
    !Array.isArray(outer.params.otherSignatories)
  )
    throw new Error("Expected full-call 2-of-3 Multisig.as_multi");
  const others = outer.params.otherSignatories.map(roleAddress).sort();
  const expectedOthers = w.M1.members
    .filter((member) => member !== expectedSigner)
    .sort();
  if (canonicalJson(others) !== canonicalJson(expectedOthers))
    throw new Error("M1 multisig membership differs");
  const proxy = callParts(outer.params.call);
  if (
    proxy.pallet !== "Proxy" ||
    proxy.name !== "Proxy" ||
    roleAddress(proxy.params.real) !== w.pure ||
    proxy.params.forceProxyType !== "Any"
  )
    throw new Error(
      "Expected M1 proxy dispatch through the unchanged beneficiary",
    );
  const leaf = callParts(proxy.params.call);
  if (envelope.intent.operationId === "GRC-ROTATION-REMOVE-M0") {
    if (
      leaf.pallet !== "Proxy" ||
      leaf.name !== "RemoveProxy" ||
      roleAddress(leaf.params.delegate) !== w.M0.account ||
      leaf.params.proxyType !== "Any" ||
      bigint(leaf.params.delay) !== 0n
    )
      throw new Error("Expected exact old-controller tuple removal");
  } else {
    if (
      leaf.pallet !== "Revive" ||
      leaf.name !== "Call" ||
      text(leaf.params.dest).toLowerCase() !== w.contract ||
      bigint(leaf.params.value) !== 0n
    )
      throw new Error("Expected zero-value continuation on the same contract");
    const reviveNode = envelope.callTree.children[0];
    if (
      !reviveNode ||
      reviveNode.method !== "call" ||
      text(leaf.params.data) !== text(object(reviveNode.parameters).data)
    )
      throw new Error(
        "Continuation ABI bytes differ from the reviewed envelope",
      );
  }
  return outer.params.call;
}
