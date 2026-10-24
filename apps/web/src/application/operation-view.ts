import type { OperationView } from "../ui-contract";
import type { PendingOperation } from "./models";

import type { OperationRecovery } from "./models";
import { json } from "./values";
export function operationView(
  p: PendingOperation | null,
  r: OperationRecovery | null,
): OperationView | null {
  if (!p) {
    return r
      ? {
          id: r.id,
          actionId: r.actionId,
          title: r.title,
          description:
            r.stage === "signed"
              ? "Signed bytes were saved before submission. Restore their review and check the current state before explicitly submitting them."
              : "The saved request requires reconciliation after restart.",
          stage: r.stage,
          tone: "warning",
          actor: r.signer,
          signer: { address: r.signer },
          route: [],
          consequences: ["Restarting does not repeat signing or submission."],
          terms: [],
          resources: [],
          blockers: [],
          callHex: r.context.outerCallBytes,
          callHash: r.context.outerCallHash,
          canSign: false,
          canSend: false,
          canReconcile: true,
          canDiscard: false,
        }
      : null;
  }
  return {
    id: p.id,
    actionId: p.actionId,
    title: p.title,
    description: p.description,
    stage: p.stage,
    tone:
      p.stage === "finalized"
        ? "positive"
        : p.stage === "failed"
          ? "negative"
          : p.stage === "unknown"
            ? "warning"
            : "neutral",
    actor: p.signer,
    signer: { address: p.signer },
    route: p.route,
    consequences: [
      "The operation uses the exact native calls shown.",
      "The native proposal remains valid after this review is closed.",
    ],
    terms: [
      { label: "Network", value: p.prepared.fingerprint.specName },
      {
        label: "Checkpoint",
        value: String(p.prepared.fingerprint.anchor.number),
      },
      { label: "Signer", value: p.signer },
      { label: "Phase", value: p.phase },
    ],
    resources: p.resources,
    blockers: p.blockers,
    callHex: p.prepared.callHex,
    callHash: p.prepared.callHash,
    txHash: p.signedAttempt?.signedExtrinsicHash ?? null,
    canSign: p.stage === "prepared" && !p.blockers.length,
    canSend: p.stage === "signed" && !p.blockers.length,
    canReconcile: ["unknown", "broadcast"].includes(p.stage),
    canDiscard: ["prepared", "failed", "stale", "finalized"].includes(p.stage),
    ...(p.receipt
      ? { evidence: json(p.receipt) as unknown as Record<string, unknown> }
      : {}),
  };
}
