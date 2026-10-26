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
      ...(Object.entries(workspace.participants) as [ParticipantRole, string][])
        .filter(
          (entry): entry is [ParticipantRole, string] => entry[1] !== null,
        )
        .map(([role, address]) => ({
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
          index === 0 || current === "M0"
            ? "GRC-GRANT-SUBMIT-M0"
            : "GRC-GRANT-SUBMIT-M1",
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
        "The current group is saved. Authority is verified from the network.",
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
        "Fund the controller’s creation reserve, then create the beneficiary through your current group.",
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
      detail: "The delegate inventory differs from the configured groups.",
      destination: "team",
    };
  else if (current === "DualControl")
    currentTask = {
      title: "Remove the current group",
      detail:
        "Both groups currently have authority. The replacement group performs the next step.",
      actionId: "GRC-ROTATION-REMOVE-M0",
    };
  else if (
    milestones.length > 0 &&
    milestones.every((item) => ["Released", "Reclaimed"].includes(item.state))
  )
    currentTask = {
      title: "Grant complete",
      detail:
        "All milestones are closed. Review the payment history or manage the signing group.",
      destination: "history",
    };
  else if (
    milestones.some((item) => item.state === "Submitted") &&
    !milestones.some((item) => item.state === "Open")
  )
    currentTask = {
      title: "The milestone awaits reviewers",
      detail:
        "R1 and R2 independently review the submitted evidence and approve its release.",
      actionId: "GRC-GRANT-APPROVE",
    };
  else if (!workspace.baseline)
    currentTask = {
      title: "Prepare the grant baseline",
      detail:
        "The first milestone must establish active vesting before control is handed off.",
      actionId: "GRC-GRANT-SUBMIT-M0",
    };
  else if (current === "M1" && continuity.continuity !== "continued")
    currentTask = {
      title: "Continue the grant with the new group",
      detail:
        "Submit the next milestone. This is a separate action after removing M0.",
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
  else if (!workspace.M1 && milestones.some((item) => item.state === "Open"))
    currentTask = {
      title: "Continue work on the grant",
      detail:
        "The current group can submit the next open milestone, or start a control handoff when needed.",
      actionId: "GRC-GRANT-SUBMIT-M0",
    };
  else if (!workspace.M1)
    currentTask = {
      title: "Manage your team",
      detail:
        "Your grant is ready. Start a control handoff when the signing group needs to change.",
      destination: "handoff",
    };
  else
    currentTask = {
      title: "Prepare the new controller group",
      detail:
        "Authorize the replacement group, remove the previous group, then continue the grant.",
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
      label: "Current controller",
      threshold: Number(workspace.M0.threshold),
      members: workspace.M0.members.map((address) =>
        identity(workspace, address),
      ),
      active:
        current === "Unknown"
          ? null
          : current === "M0" || current === "DualControl",
    },
    newController: workspace.M1
      ? {
          address: workspace.M1.account,
          label: "Replacement controller",
          threshold: Number(workspace.M1.threshold),
          members: workspace.M1.members.map((address) =>
            identity(workspace, address),
          ),
          active:
            current === "Unknown"
              ? null
              : current === "M1" || current === "DualControl",
        }
      : null,
    contract: workspace.contract,
    grantId: workspace.grantId,
    authority: current,
    continuity: continuity.continuity,
    continuityDetail: continuity.detail,
    handoffs: (workspace.handoffs ?? []).map((item) => ({
      id: item.id,
      from: item.from.account,
      to: item.to.account,
      completedAt: item.completedAt,
      continued: !!item.certificate,
      receiptId: item.removalReceiptId,
    })),
    identityComparison: workspace.baseline
      ? [
          {
            label: "Native beneficiary",
            before: workspace.baseline.account.address,
            current: pureState?.address ?? null,
            matches: pureState
              ? eq(workspace.baseline.account.address, pureState.address) &&
                eq(workspace.pure, pureState.address)
              : null,
          },
          {
            label: "Grant recipient",
            before: workspace.baseline.grant.grantee,
            current: grant?.grantee ?? null,
            matches:
              grant && pureState
                ? mapped(pureState) &&
                  eq(workspace.baseline.grant.grantee, grant.grantee) &&
                  eq(grant.grantee, pureState.mappedAddress)
                : null,
          },
        ]
      : [],
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
