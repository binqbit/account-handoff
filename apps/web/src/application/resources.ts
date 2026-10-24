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
  outer_fee: "Локальний бюджет комісії · фактична комісія не повертається",
  value: "Переказ або фінансування · сума списується",
  proposal_deposit:
    "Резерв пропозиції за параметрами runtime · повертається depositor після виконання або скасування",
  pure_deposit:
    "Резерв створення Pure за параметрами runtime · залишається у M0 після передачі контролю",
  mapping_hold:
    "Hold mapping за параметрами runtime · залишається заблокованим під mapping",
  proxy_increment:
    "Додатковий резерв делегата за параметрами runtime · повертається при вилученні зайвого делегата",
  storage_limit:
    "Верхня межа депозиту storage · фактичний внесок може бути меншим; повернення залежить від звільнення storage",
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
          ? "Невідомо"
          : `${formatUnits(requirement.amountNative, token.decimals)} ${token.symbol}`;
      if (
        requirement.kind === "outer_fee" &&
        input.envelope.resources.outerFeeEstimateNative !== null
      )
        amount += ` (оцінка ${formatUnits(BigInt(input.envelope.resources.outerFeeEstimateNative), token.decimals)} ${token.symbol}; бюджет не є лімітом runtime)`;
      const deferred =
        input.phase === "multisig_first" &&
        innerRequirements.has(requirement.kind)
          ? " · для виконання після другого підпису"
          : "";
      return {
        kind: requirement.kind,
        source: requirement.source,
        amountNative: requirement.amountNative?.toString() ?? null,
        payer: requirement.payer ?? "Не встановлено",
        label: labels[requirement.kind] + deferred,
        amount,
      };
    });
}
