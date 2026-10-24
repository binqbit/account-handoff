import React from "react";
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
        label: "Ідентичність runtime",
        status: "ready",
        detail: "Синтетичний контекст ізольованого тесту",
      },
    ],
  },
  wallet: {
    connected: true,
    connecting: false,
    selectedAddress: addresses[0]!,
    accounts: addresses.slice(0, 4).map((address, index) => ({
      address,
      label: ["Аліса", "Богдан", "Катерина", "Данило"][index]!,
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
      label: "Сталий P",
    },
    oldController: {
      address: addresses[5]!,
      label: "M0",
      threshold: 2,
      members: addresses.slice(0, 3).map((address, index) => ({
        address,
        label: ["Аліса", "Богдан", "Катерина"][index]!,
      })),
      active: true,
    },
    newController: {
      address: addresses[6]!,
      label: "M1",
      threshold: 2,
      members: [0, 1, 3].map((index) => ({
        address: addresses[index]!,
        label: ["Аліса", "Богдан", "Катерина", "Данило"][index]!,
      })),
      active: false,
    },
    contract: `0x${"b".repeat(40)}`,
    grantId: "42",
    authority: "M0",
    continuity: "not-started",
    continuityDetail: "Тест очікує окреме вилучення та подання.",
    symbol: "UNIT",
    grantTotal: "30",
    funder: { address: addresses[7]!, label: "Фонд" },
    reviewers: [],
    balances: [],
    setupProgress: [],
    currentTask: {
      title: "Підготуйте нову групу керування",
      detail: "Тестова проєкція для перевірки інтерфейсу.",
      actionId,
    },
    milestones: [
      {
        id: "m0",
        index: 0,
        title: "Дослідження",
        amount: "18",
        symbol: "UNIT",
        state: "Released",
        round: "0",
        vesting: "1 800 блоків",
        approvals: [addresses[0]!, addresses[1]!],
        requiredApprovals: 2,
        actions: [],
      },
      {
        id: "m1",
        index: 1,
        title: "Наступний результат",
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
      title: "Додати нову групу M1",
      description: "M0 і M1 тимчасово матимуть повну владу.",
      category: "handoff",
      actor: "M0",
      enabled: true,
      blockers: [],
      fields: [],
    },
    {
      id: "GRC-GRANT-SUBMIT-M1",
      title: "Подати наступний етап",
      description: "Доказ буде публічним.",
      category: "grant",
      actor: "M1",
      enabled: true,
      blockers: [],
      fields: [
        {
          name: "evidence",
          label: "Публічний доказ",
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
if (new URLSearchParams(location.search).get("scenario") === "empty")
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
              blockers: ["Змінено акаунт. Потрібен новий перегляд."],
            }
          : null,
      });
    if (command.type === "prepare-operation") {
      const action = snapshot.actions.find(
        (item) => item.id === command.actionId,
      )!;
      const operation: OperationView = {
        id: "test-operation",
        actionId: action.id,
        title: action.title,
        description: action.description,
        stage: "Prepared",
        tone: "neutral",
        actor: action.actor,
        signer: { address: snapshot.wallet.selectedAddress! },
        route: ["Alice", "Multisig M0", "Proxy P", "addProxy M1"],
        consequences: ["M0 залишається авторизованою."],
        terms: [{ label: "Дозвіл", value: "Any / 0" }],
        resources: [
          { label: "Тестова оцінка", amount: "1 UNIT", payer: "Alice" },
        ],
        blockers: [],
        canSign: true,
        canSend: false,
        canReconcile: false,
        canDiscard: true,
        callHex: "0x0102",
        callHash: `0x${"c".repeat(64)}`,
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
