import React from "react";
import {
  createWorkspaceRecord,
  planHandoff,
} from "../../../apps/web/src/application/workspace-state";
import { workspaceView } from "../../../apps/web/src/application/presentation";
import { createRoot } from "react-dom/client";
import { App } from "../../../apps/web/src/App";
import type {
  AppCommand,
  AppSnapshot,
  ApplicationFacade,
  OperationView,
} from "../../../apps/web/src/ui-contract";
const addresses = Array.from(
  { length: 8 },
  (_, index) => `0x${String(index + 1).repeat(64)}`,
);
const actionId = "GRC-ROTATION-ADD-M1";
let snapshot: AppSnapshot = {
  revision: 0,
  network: {
    mode: "LOCAL",
    name: "Test harness only",
    endpoint: "ws://127.0.0.1:9944",
    connected: true,
    checking: false,
    genesis: `0x${"a".repeat(64)}`,
    blockNumber: "100",
    runtimeVersion: "1",
    runId: "isolated-test",
    readiness: [
      {
        id: "runtime",
        label: "Runtime identity",
        status: "ready",
        detail: "Synthetic context for an isolated test",
      },
    ],
  },
  wallet: {
    connected: true,
    connecting: false,
    selectedAddress: addresses[0]!,
    accounts: addresses.slice(0, 4).map((address, index) => ({
      address,
      label: ["Alice", "Bob", "Charlie", "Dave"][index]!,
      source: "test-only",
    })),
  },
  workspaces: [{ id: "test-workspace", name: "Atlas Research", mode: "LOCAL" }],
  workspace: {
    id: "test-workspace",
    name: "Atlas Research",
    beneficiary: {
      address: addresses[4]!,
      mappedAddress: `0x${"a".repeat(40)}`,
      label: "Stable P",
    },
    oldController: {
      address: addresses[5]!,
      label: "M0",
      threshold: 2,
      members: addresses.slice(0, 3).map((address, index) => ({
        address,
        label: ["Alice", "Bob", "Charlie"][index]!,
      })),
      active: true,
    },
    newController: {
      address: addresses[6]!,
      label: "M1",
      threshold: 2,
      members: [0, 1, 3].map((index) => ({
        address: addresses[index]!,
        label: ["Alice", "Bob", "Charlie", "Dave"][index]!,
      })),
      active: false,
    },
    contract: `0x${"b".repeat(40)}`,
    grantId: "42",
    authority: "M0",
    continuity: "not-started",
    continuityDetail: "The test awaits separate removal and submission.",
    symbol: "UNIT",
    grantTotal: "30",
    funder: { address: addresses[7]!, label: "Funder" },
    reviewers: [],
    balances: [],
    setupProgress: [],
    currentTask: {
      title: "Prepare the new controller group",
      detail: "Test projection for interface verification.",
      actionId,
    },
    milestones: [
      {
        id: "m0",
        index: 0,
        title: "Research",
        amount: "18",
        symbol: "UNIT",
        state: "Released",
        round: "0",
        vesting: "1,800 blocks",
        approvals: [addresses[0]!, addresses[1]!],
        requiredApprovals: 2,
        actions: [],
      },
      {
        id: "m1",
        index: 1,
        title: "Next deliverable",
        amount: "12",
        symbol: "UNIT",
        state: "Open",
        round: "0",
        approvals: [],
        requiredApprovals: 2,
        actions: ["GRC-GRANT-SUBMIT-M1"],
      },
    ],
    history: [],
  },
  actions: [
    {
      id: actionId,
      title: "Add the new controller M1",
      description: "M0 and M1 temporarily have full authority.",
      category: "handoff",
      actor: "M0",
      enabled: true,
      blockers: [],
      fields: [],
    },
    {
      id: "GRC-GRANT-SUBMIT-M1",
      title: "Submit the next milestone",
      description: "The evidence will be public.",
      category: "grant",
      actor: "M1",
      enabled: true,
      blockers: [],
      fields: [
        {
          name: "evidence",
          label: "Public evidence",
          type: "textarea",
          required: true,
          maxBytes: 1024,
        },
      ],
    },
  ],
  operation: null,
  busy: null,
};
const scenario = new URLSearchParams(location.search).get("scenario");
if (scenario?.startsWith("identity-") && snapshot.workspace) {
  const missing = scenario === "identity-unknown";
  snapshot.workspace.identityComparison =
    scenario === "identity-unchecked"
      ? []
      : [
          {
            label: "Native beneficiary",
            before: addresses[4]!,
            current: addresses[4]!,
            matches: true,
          },
          {
            label: "Grant recipient",
            before: `0x${"a".repeat(40)}`,
            current: missing
              ? null
              : scenario === "identity-changed"
                ? `0x${"d".repeat(40)}`
                : `0x${"a".repeat(40)}`,
            matches: missing ? null : scenario !== "identity-changed",
          },
        ];
}
if (!location.hash && scenario !== "public-home")
  history.replaceState(
    null,
    "",
    `${location.pathname}${location.search}#overview`,
  );
function reviewOperation(): OperationView {
  const action = snapshot.actions[0]!;
  return {
    id: "test-operation",
    actionId: action.id,
    title: action.title,
    description: action.description,
    stage: "Prepared",
    tone: "neutral",
    actor: action.actor,
    signer: { address: snapshot.wallet.selectedAddress! },
    route: ["Alice", "Multisig M0", "Proxy P", "addProxy M1"],
    consequences: ["M0 remains authorized."],
    terms: [{ label: "Permission", value: "Any / 0" }],
    resources: [
      {
        label: "Test estimate",
        amount: "0.00000008132674 UNIT (budget 0.00000016265348 UNIT)",
        payer: addresses[0]!,
      },
    ],
    blockers: [],
    canSign: true,
    canSend: false,
    canReconcile: false,
    canDiscard: true,
    callHex: "0x0102",
    callHash: `0x${"c".repeat(64)}`,
  };
}
if (scenario === "same-names") {
  snapshot = {
    ...snapshot,
    wallet: {
      ...snapshot.wallet,
      accounts: snapshot.wallet.accounts.map((account, index) =>
        index < 2 ? { ...account, label: "Signer" } : account,
      ),
    },
  };
}
if (scenario === "unselected-wallet") snapshot.wallet.selectedAddress = null;
if (scenario === "wallet-menu") {
  snapshot.wallet = {
    ...snapshot.wallet,
    selectedAddress: `0x${"01".repeat(32)}`,
    accounts: Array.from({ length: 24 }, (_, index) => ({
      address: `0x${(index + 1).toString(16).padStart(2, "0").repeat(32)}`,
      source: "test-only",
      label:
        index === 0
          ? "Research and Development Treasury Committee With A Long Name"
          : `Account ${index + 1}`,
    })),
  };
}
if (scenario === "current-only")
  snapshot.workspace = { ...snapshot.workspace!, newController: null };
if (scenario === "rotated")
  snapshot.workspace = {
    ...snapshot.workspace!,
    authority: "M1",
    continuity: "rotated",
    oldController: { ...snapshot.workspace!.oldController, active: false },
    newController: { ...snapshot.workspace!.newController!, active: true },
  };
if (scenario === "empty")
  snapshot = {
    ...snapshot,
    workspace: null,
    workspaces: [],
    wallet: {
      connected: false,
      connecting: false,
      accounts: [],
      selectedAddress: null,
    },
  };
if (scenario === "unknown")
  snapshot = {
    ...snapshot,
    operation: {
      ...reviewOperation(),
      stage: "unknown",
      tone: "warning",
      canSign: false,
      canSend: false,
      canReconcile: true,
      canDiscard: false,
      blockers: ["Reconcile the existing attempt's outcome first."],
    },
  };
if (scenario === "read-only")
  snapshot = {
    ...snapshot,
    network: { ...snapshot.network, connected: false },
    wallet: {
      connected: false,
      connecting: false,
      selectedAddress: null,
      accounts: [],
    },
    workspace: {
      ...snapshot.workspace!,
      authority: "Unknown",
      continuity: "unknown",
      continuityDetail: "Imported evidence requires network verification.",
      history: [
        {
          id: "imported-evidence",
          title: "Imported record",
          state: "Historical evidence",
          tone: "neutral",
          detail: "Importing does not establish current control authority.",
          evidence: { blockNumber: "50", recordedAmount: 123n },
        },
      ],
    },
    actions: snapshot.actions.map((action) => ({
      ...action,
      enabled: false,
      blockers: ["Connect the network and wallet for a new review."],
    })),
  };
if (scenario === "approval-counts" || scenario === "approval-unknown")
  snapshot = {
    ...snapshot,
    workspace: {
      ...snapshot.workspace!,
      milestones: snapshot.workspace!.milestones.map((milestone, index) => ({
        ...milestone,
        approvals: null,
        approvalCount:
          scenario === "approval-counts" ? (index === 0 ? 2 : 0) : null,
      })),
    },
  };
const listeners = new Set<() => void>();
const commands: AppCommand[] = [];
const publish = (next: AppSnapshot) => {
  snapshot = { ...next, revision: snapshot.revision + 1 };
  listeners.forEach((listener) => listener());
};
const facade: ApplicationFacade = {
  getSnapshot: () => snapshot,
  subscribe: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  async dispatch(command) {
    commands.push(command);
    if (command.type === "select-account")
      publish({
        ...snapshot,
        wallet: { ...snapshot.wallet, selectedAddress: command.address },
        operation: snapshot.operation
          ? {
              ...snapshot.operation,
              canSign: false,
              blockers: ["Account changed. A new review is required."],
            }
          : null,
      });
    if (command.type === "plan-handoff" && snapshot.workspace) {
      const current = snapshot.workspace;
      const record = createWorkspaceRecord(
        {
          name: current.name,
          oldMembers: current.oldController.members.map(
            (member) => member.address,
          ),
          threshold: 2,
          funder: addresses[7]!,
          reviewers: [addresses[5]!, addresses[6]!],
        },
        "LOCAL",
        `0x${"a".repeat(64)}`,
      );
      const planned = workspaceView(planHandoff(record, command.members), null);
      publish({
        ...snapshot,
        workspace: { ...current, newController: planned.newController },
      });
    }
    if (command.type === "next-handoff" && snapshot.workspace?.newController) {
      const current = snapshot.workspace;
      publish({
        ...snapshot,
        workspace: {
          ...current,
          authority: "M0",
          continuity: "not-started",
          oldController: current.newController!,
          newController: null,
          handoffs: [
            {
              id: "saved-handoff",
              from: current.oldController.address,
              to: current.newController!.address,
              completedAt: new Date().toISOString(),
              continued: false,
              receiptId: "synthetic-receipt",
            },
          ],
        },
      });
    }
    if (command.type === "prepare-operation") {
      const action = snapshot.actions.find(
        (item) => item.id === command.actionId,
      )!;
      const operation: OperationView = {
        ...reviewOperation(),
        actionId: action.id,
        title: action.title,
        description: action.description,
        actor: action.actor,
      };
      publish({ ...snapshot, operation });
    }
    if (command.type === "sign-operation" && snapshot.operation)
      publish({
        ...snapshot,
        operation: {
          ...snapshot.operation,
          stage: "Signed",
          canSign: false,
          canSend: true,
        },
      });
    if (command.type === "send-operation" && snapshot.operation)
      publish({
        ...snapshot,
        operation: {
          ...snapshot.operation,
          stage: "Broadcast",
          canSign: false,
          canSend: false,
          canReconcile: true,
        },
      });
    if (command.type === "reconcile-operation" && snapshot.operation)
      publish({
        ...snapshot,
        operation: {
          ...snapshot.operation,
          stage: "Finalized",
          tone: "positive",
          canReconcile: false,
          canDiscard: false,
        },
      });
    if (command.type === "export-package")
      return {
        download: {
          name: "test-unsigned.json",
          mime: "application/json",
          contents: '{"synthetic":true}',
        },
      };
    return;
  },
};
Object.defineProperty(window, "__uiTest", {
  value: { commands, getSnapshot: () => snapshot },
});
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App application={facade} />
  </React.StrictMode>,
);
