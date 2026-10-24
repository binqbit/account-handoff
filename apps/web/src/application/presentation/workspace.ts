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
        role: "Pure creation reserve",
        mappingRequired: false,
      },
      ...(workspace.pure
        ? [
            {
              address: workspace.pure,
              role: "Beneficiary P liquidity",
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
        title: index === 0 ? "Initial deliverable" : "Continued work",
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
            : "No new vesting",
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
      label: "Team and controllers",
      status: "ready",
      detail:
        "M0/M1 membership is saved. Current authority is read separately.",
    },
    {
      id: "pure",
      label: "Beneficiary P",
      status:
        workspace.pure && workspace.creationEvidence.length
          ? "ready"
          : "blocked",
      detail: workspace.pure
        ? workspace.creationEvidence.length
          ? "The Pure address and creation receipt are saved."
          : "The address is known; provenance needs verification."
        : "Create P through M0.",
    },
    {
      id: "mapping",
      label: "Persistent P mapping",
      status: mapped(pureState) ? "ready" : !pureState ? "unknown" : "blocked",
      detail: mapped(pureState)
        ? "Reverse mapping confirms the same P."
        : "A current P → h(P) → P read is required.",
    },
    {
      id: "grant",
      label: "Grant for h(P)",
      status:
        grant &&
        mapped(pureState) &&
        eq(grant.grantee, pureState?.mappedAddress)
          ? "ready"
          : "blocked",
      detail: grant
        ? "Contract state was read; the exact beneficiary is checked."
        : "The funder creates the grant after the beneficiary is ready.",
    },
    {
      id: "baseline",
      label: "Baseline and vesting",
      status: workspace.baseline ? "ready" : "blocked",
      detail: workspace.baseline
        ? "The baseline is saved and bound to its block."
        : "The first tranche must be released with active native vesting.",
    },
  ];
  let currentTask: WorkspaceView["currentTask"];
  if (!chain || !eq(chain.fingerprint.genesis, workspace.genesis))
    currentTask = {
      title: "Check the workspace network",
      detail: "Select the matching native endpoint and read finalized data.",
      destination: "network",
    };
  else if (!workspace.pure)
    currentTask = {
      title: "Create the stable beneficiary",
      detail:
        "Fund M0's creation reserve, then create P through the original group.",
      actionId: "GRC-SETUP-CREATE-PURE",
    };
  else if (!mapped(pureState))
    currentTask = {
      title: "Prepare beneficiary mapping",
      detail: "Fund P's liquidity and verify its persistent mapping to h(P).",
      actionId: "GRC-SETUP-MAP-P",
    };
  else if (!grant || workspace.grantId === null)
    currentTask = {
      title: "Create a grant for h(P)",
      detail:
        "The funder finances two milestones for the prepared beneficiary.",
      actionId: "GRC-GRANT-CREATE",
    };
  else if (current === "Diverged")
    currentTask = {
      title: "Review unexpected authority",
      detail:
        "The actual delegate inventory does not match the allowed M0/M1 set.",
      destination: "team",
    };
  else if (
    milestones.some((item) => item.state === "Submitted") &&
    !workspace.baseline
  )
    currentTask = {
      title: "The first milestone awaits reviewers",
      detail:
        "R1 and R2 independently review the evidence and approve the first tranche release.",
      actionId: "GRC-GRANT-APPROVE",
    };
  else if (!workspace.baseline)
    currentTask = {
      title: "Prepare the grant baseline",
      detail:
        "The first milestone must establish active vesting before control is handed off.",
      actionId: "GRC-GRANT-SUBMIT-M0",
    };
  else if (current === "DualControl")
    currentTask = {
      title: "Remove the original group M0",
      detail:
        "Both groups currently have authority. M1 performs the next step.",
      actionId: "GRC-ROTATION-REMOVE-M0",
    };
  else if (current === "M1" && continuity.continuity !== "continued")
    currentTask = {
      title: "Continue the grant with the new group",
      detail:
        "Submit the next milestone through M1. This is a separate action after removing M0.",
      actionId: "GRC-GRANT-SUBMIT-M1",
    };
  else if (
    continuity.continuity === "continued" ||
    continuity.continuity === "drift"
  )
    currentTask = {
      title: "Review the saved evidence",
      detail: continuity.detail,
      destination: "history",
    };
  else
    currentTask = {
      title: "Prepare the new controller group",
      detail:
        "Add M1 through the original group. Then remove M0 separately and continue the grant.",
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
          label: "Stable beneficiary P",
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
