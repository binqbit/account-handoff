import type {
  BalanceView,
  MilestoneView,
  ReadinessView,
  WorkspaceView,
} from "../../ui-contract";
import type { ChainView, WorkspaceRecord } from "../models";
import { proof } from "./continuity";
import { historyEntry } from "./history";
import {
  authority,
  decimal,
  eq,
  identity,
  mapped,
  ratioFor,
  roleNames,
  stateFor,
  type ParticipantRole,
} from "./shared";

function deadline(value: bigint): string {
  if (value <= 0n || value > 253402300799n) return `${value} Unix seconds`;
  return new Date(Number(value) * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
}
export function workspaceView(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): WorkspaceView {
  const decimals = chain?.fingerprint.tokenDecimals ?? 0;
  const symbol = chain?.fingerprint.tokenSymbol ?? "native";
  const current = authority(workspace, chain);
  const pureState = stateFor(chain, workspace.pure);
  const grant = chain?.grant;
  const continuity = proof(workspace, chain);
  const balances: BalanceView[] = [];
  const entries: { address: string; role: string; mappingRequired: boolean }[] =
    [
      {
        address: workspace.M0.account,
        role: "Резерв створення Pure",
        mappingRequired: false,
      },
      ...(workspace.pure
        ? [
            {
              address: workspace.pure,
              role: "Ліквідність бенефіціара P",
              mappingRequired: true,
            },
          ]
        : []),
      ...(
        Object.entries(workspace.participants) as [ParticipantRole, string][]
      ).map(([role, address]) => ({
        address,
        role: roleNames[role],
        mappingRequired: ["F", "R1", "R2"].includes(role),
      })),
    ];
  for (const entry of entries) {
    const state = stateFor(chain, entry.address);
    const available = state
      ? state.free > state.frozen
        ? state.free - state.frozen
        : 0n
      : null;
    balances.push({
      identity: identity(workspace, entry.address),
      role: entry.role,
      free: state ? decimal(state.free, decimals) : null,
      reserved: state ? decimal(state.reserved, decimals) : null,
      frozen: state ? decimal(state.frozen, decimals) : null,
      available: available === null ? null : decimal(available, decimals),
      symbol,
      mapping: !entry.mappingRequired
        ? "not-required"
        : !state
          ? "unknown"
          : mapped(state)
            ? "verified"
            : "missing",
    });
  }
  const milestones: MilestoneView[] = (grant?.milestones ?? []).map(
    (milestone, index) => {
      const states: MilestoneView["state"][] = [
        "Open",
        "Submitted",
        "Released",
        "Reclaimed",
      ];
      const actions: string[] = [];
      if (milestone.state === 0 && milestone.round === 0)
        actions.push(
          index === 0 ? "GRC-GRANT-SUBMIT-M0" : "GRC-GRANT-SUBMIT-M1",
        );
      if (milestone.state === 1) actions.push("GRC-GRANT-APPROVE");
      const ratio = ratioFor(chain);
      const nativeAmount =
        ratio !== null && milestone.amount % ratio === 0n
          ? milestone.amount / ratio
          : null;
      return {
        id: `${workspace.grantId}:${index}`,
        index,
        title: index === 0 ? "Початковий результат" : "Продовження роботи",
        amount:
          nativeAmount === null
            ? `${milestone.amount} ABI units`
            : decimal(nativeAmount, decimals),
        symbol: nativeAmount === null ? "" : symbol,
        state: states[milestone.state] ?? "Unknown",
        round: String(milestone.round),
        deadline: deadline(milestone.deadline),
        vesting:
          milestone.vestingBlocks > 0
            ? `${milestone.vestingBlocks} counted blocks`
            : "Без нового vesting",
        approvals: null,
        approvalCount: milestone.approvals,
        requiredApprovals: grant?.threshold ?? 2,
        actions,
      };
    },
  );
  const setupProgress: ReadinessView[] = [
    {
      id: "team",
      label: "Команда й контролери",
      status: "ready",
      detail: "Склад M0/M1 збережено. Поточні повноваження читаються окремо.",
    },
    {
      id: "pure",
      label: "Бенефіціар P",
      status:
        workspace.pure && workspace.creationEvidence.length
          ? "ready"
          : "blocked",
      detail: workspace.pure
        ? workspace.creationEvidence.length
          ? "Збережена адреса та квитанція створення Pure."
          : "Адреса відома, потрібна перевірка походження."
        : "Потрібно створити P через M0.",
    },
    {
      id: "mapping",
      label: "Постійне mapping P",
      status: mapped(pureState) ? "ready" : !pureState ? "unknown" : "blocked",
      detail: mapped(pureState)
        ? "Зворотне зіставлення підтверджує той самий P."
        : "Потрібне актуальне читання P → h(P) → P.",
    },
    {
      id: "grant",
      label: "Грант для h(P)",
      status:
        grant &&
        mapped(pureState) &&
        eq(grant.grantee, pureState?.mappedAddress)
          ? "ready"
          : "blocked",
      detail: grant
        ? "Стан контракту прочитано; перевіряється точний бенефіціар."
        : "Фонд створює грант після підготовки бенефіціара.",
    },
    {
      id: "baseline",
      label: "Початковий стан і vesting",
      status: workspace.baseline ? "ready" : "blocked",
      detail: workspace.baseline
        ? "Початковий стан збережено з прив’язкою до блока."
        : "Потрібна виплата першого траншу з активним native vesting.",
    },
  ];
  let currentTask: WorkspaceView["currentTask"];
  if (!chain || !eq(chain.fingerprint.genesis, workspace.genesis))
    currentTask = {
      title: "Перевірте мережу простору",
      detail:
        "Оберіть відповідний native endpoint і отримайте фіналізовані дані.",
      destination: "network",
    };
  else if (!workspace.pure)
    currentTask = {
      title: "Створіть сталого бенефіціара",
      detail:
        "Спочатку забезпечте M0 резервом створення, потім створіть P через початкову групу.",
      actionId: "GRC-SETUP-CREATE-PURE",
    };
  else if (!mapped(pureState))
    currentTask = {
      title: "Підготуйте mapping бенефіціара",
      detail:
        "Забезпечте P ліквідністю та підтвердьте його постійне зіставлення з h(P).",
      actionId: "GRC-SETUP-MAP-P",
    };
  else if (!grant || workspace.grantId === null)
    currentTask = {
      title: "Створіть грант для h(P)",
      detail: "Фонд фінансує два етапи для підготовленого бенефіціара.",
      actionId: "GRC-GRANT-CREATE",
    };
  else if (current === "Diverged")
    currentTask = {
      title: "Перевірте неочікувані повноваження",
      detail:
        "Фактичний список делегатів не відповідає дозволеному набору M0/M1.",
      destination: "team",
    };
  else if (
    milestones.some((item) => item.state === "Submitted") &&
    !workspace.baseline
  )
    currentTask = {
      title: "Перший етап очікує рецензентів",
      detail:
        "R1 та R2 окремо перевіряють доказ і схвалюють виплату першого траншу.",
      actionId: "GRC-GRANT-APPROVE",
    };
  else if (!workspace.baseline)
    currentTask = {
      title: "Підготуйте початковий стан гранту",
      detail:
        "Перший етап має створити активний vesting перед передачею керування.",
      actionId: "GRC-GRANT-SUBMIT-M0",
    };
  else if (current === "DualControl")
    currentTask = {
      title: "Вилучіть початкову групу M0",
      detail:
        "Зараз обидві групи мають повноваження. Наступний крок виконує M1.",
      actionId: "GRC-ROTATION-REMOVE-M0",
    };
  else if (current === "M1" && continuity.continuity !== "continued")
    currentTask = {
      title: "Продовжіть грант новою групою",
      detail:
        "Подайте наступний етап через M1. Це окрема дія після вилучення M0.",
      actionId: "GRC-GRANT-SUBMIT-M1",
    };
  else if (
    continuity.continuity === "continued" ||
    continuity.continuity === "drift"
  )
    currentTask = {
      title: "Перегляньте збережений доказ",
      detail: continuity.detail,
      destination: "history",
    };
  else
    currentTask = {
      title: "Підготуйте нову групу керування",
      detail:
        "Додайте M1 через початкову групу. Потім окремо вилучіть M0 та продовжіть грант.",
      actionId: "GRC-ROTATION-ADD-M1",
    };
  const totals = grant?.milestones.reduce((sum, item) => sum + item.amount, 0n);
  const ratio = ratioFor(chain);
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    beneficiary: workspace.pure
      ? {
          address: workspace.pure,
          label: "Сталий бенефіціар P",
          mappedAddress: mapped(pureState) ? pureState!.mappedAddress : null,
        }
      : null,
    oldController: {
      address: workspace.M0.account,
      label: "M0",
      threshold: Number(workspace.M0.threshold),
      members: workspace.M0.members.map((address) =>
        identity(workspace, address),
      ),
      active:
        current === "Unknown"
          ? null
          : current === "M0" || current === "DualControl",
    },
    newController: {
      address: workspace.M1.account,
      label: "M1",
      threshold: Number(workspace.M1.threshold),
      members: workspace.M1.members.map((address) =>
        identity(workspace, address),
      ),
      active:
        current === "Unknown"
          ? null
          : current === "M1" || current === "DualControl",
    },
    contract: workspace.contract,
    grantId: workspace.grantId,
    authority: current,
    continuity: continuity.continuity,
    continuityDetail: continuity.detail,
    symbol,
    grantTotal:
      totals === undefined || ratio === null || totals % ratio !== 0n
        ? null
        : decimal(totals / ratio, decimals),
    milestones,
    balances,
    history: [...workspace.history]
      .sort(
        (left, right) =>
          right.receipt.blockNumber - left.receipt.blockNumber ||
          right.receipt.txIndex - left.receipt.txIndex,
      )
      .map(historyEntry),
    funder: identity(workspace, workspace.participants.F),
    reviewers: [
      identity(workspace, workspace.participants.R1),
      identity(workspace, workspace.participants.R2),
    ],
    setupProgress,
    currentTask,
  };
}
