import {
  formatUnits,
  operationResourceRequirements,
} from "@account-handoff/domain";
import type {
  FreshOperationInput,
  OperationResourceRequirement,
} from "@account-handoff/domain";
import type { OperationView } from "../ui-contract";

export type ResourceReviewRow = OperationView["resources"][number] & {
  kind: OperationResourceRequirement["kind"];
  source: OperationResourceRequirement["source"];
  amountNative: string | null;
};

const labels: Record<OperationResourceRequirement["kind"], string> = {
  outer_fee: "Local fee budget · actual fees are nonrefundable",
  value: "Transfer or funding · the amount is spent",
  proposal_deposit:
    "Proposal reserve from runtime parameters · refunded to the depositor after execution or cancellation",
  pure_deposit:
    "Pure creation reserve from runtime parameters · remains with M0 after the control handoff",
  mapping_hold:
    "Mapping hold from runtime parameters · remains locked for the mapping",
  proxy_increment:
    "Additional delegate reserve from runtime parameters · refunded when the extra delegate is removed",
  storage_limit:
    "Storage deposit upper bound · the actual deposit may be smaller; refunds depend on releasing storage",
};
const innerRequirements = new Set<OperationResourceRequirement["kind"]>([
  "pure_deposit",
  "mapping_hold",
  "proxy_increment",
  "storage_limit",
]);

/** Projects the guard's exact requirements; existing reserved/frozen balances are never charged again. */
export function buildResourceReview(
  input: FreshOperationInput,
  token: { decimals: number; symbol: string },
): ResourceReviewRow[] {
  return operationResourceRequirements(input)
    .filter((requirement) => requirement.amountNative !== 0n)
    .map((requirement) => {
      let amount =
        requirement.amountNative === undefined
          ? "Unknown"
          : `${formatUnits(requirement.amountNative, token.decimals)} ${token.symbol}`;
      if (
        requirement.kind === "outer_fee" &&
        input.envelope.resources.outerFeeEstimateNative !== null
      )
        amount += ` (estimate ${formatUnits(BigInt(input.envelope.resources.outerFeeEstimateNative), token.decimals)} ${token.symbol}; the budget is not a runtime limit)`;
      const deferred =
        input.phase === "multisig_first" &&
        innerRequirements.has(requirement.kind)
          ? " · for execution after the second signature"
          : "";
      return {
        kind: requirement.kind,
        source: requirement.source,
        amountNative: requirement.amountNative?.toString() ?? null,
        payer: requirement.payer ?? "Not set",
        label: labels[requirement.kind] + deferred,
        amount,
      };
    });
}
