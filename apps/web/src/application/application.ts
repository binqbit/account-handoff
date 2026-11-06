import type { NetworkDescriptor } from "./network-descriptor";
import {
  canonicalJson,
  parseBoundedJson,
  sha256,
} from "@account-handoff/contracts";
import type {
  ChainProfile,
  Postcondition,
  AccountingLedger,
} from "@account-handoff/contracts";
import { type FreshOperationInput } from "@account-handoff/domain";
import {
  NativeConnection,
  safeEndpoint,
  hex,
  object,
  type NativeReceipt,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import type { WalletSession } from "@account-handoff/wallet-adapter";
import { type GrantHistory } from "@account-handoff/grant-adapter";
import { openJournal, type Journal } from "@account-handoff/local-store";
import { deleteDB } from "idb";
import type {
  ApplicationFacade,
  AppSnapshot,
  AppCommand,
  CommandResult,
  WorkspaceInput,
  OperationView,
  RuntimeMode,
  PackageImportPreview,
} from "../ui-contract";
import type { ChainView, WorkspaceRecord, PendingOperation } from "./models";
import { actionViews, workspaceView } from "./presentation";
import {
  validateLocalWorkspaceImport,
  verifyWorkspaceConnection,
  type VerifiedLocalWorkspaceImport,
} from "./local-import";
import type { OperationRecovery } from "./models";
import { errorText, id, json } from "./values";
import { verifyAndAdvanceHandoff } from "./advance-handoff";
import { operationView } from "./operation-view";
import {
  createWorkspaceRecord,
  planHandoff,
  captureHandoffBaseline,
  restoreWorkspace,
} from "./workspace-state";
import { accountingLedger } from "./accounting";
import { loadOperationInputs } from "./operation-inputs";
import { prepareOperation } from "./prepare-operation";
import { updateWorkspaceCertificate } from "./certificate-state";
import { operationPostconditions } from "./operation-postconditions";
import { finalizeOperation } from "./finalize-operation";
import { resolveRecovery } from "./recover-operation";
import { readNetworkDescriptor, qualifiedProfile } from "./network-profile";
import { readWorkspaceState, connectedNetwork } from "./network-state";
import { checkPendingOperation } from "./check-pending";
import {
  parseWorkspacePackage,
  exportWorkspacePackage,
  validateWorkspaceDescriptor,
} from "./workspace-package";
import {
  descriptorInput,
  completeDescriptor,
  assertWorkspaceEvidence,
  sameWorkspace,
  restoreWorkspaceCandidate,
  restoreWorkspaceHistory,
  restoreCheckpointHints,
  sameWorkspaceConfiguration,
} from "./workspace-import";
import { signOperation } from "./sign-operation";
import { operationTabId } from "./tab-identity";
import {
  WalletConnection,
  readWalletPreference,
  WALLET_PREFERENCE,
} from "./wallet-connection";
import {
  NETWORK_PREFERENCE,
  readNetworkPreference,
  type NetworkPreference,
} from "./network-preference";
import {
  isRetryableNetworkFailure,
  normalizeNetworkFailure,
} from "./network-failure";
import {
  deployment,
  assertDeploymentMode,
  assertDeploymentGenesis,
} from "../config/deployment";

const terminal = new Set(["finalized", "failed", "stale"]);

const initial = (): AppSnapshot => ({
  revision: 0,
  network: {
    mode: deployment.defaultMode,
    name: deployment.defaultName,
    endpoint: deployment.defaultEndpoint,
    connected: false,
    checking: false,
    readiness: [],
  },
  wallet: {
    connected: false,
    connecting: false,
    accounts: [],
    selectedAddress: null,
  },
  workspaces: [],
  workspace: null,
  actions: [],
  operation: null,
  busy: null,
});

export class Application implements ApplicationFacade {
  private state = initial();
  private listeners = new Set<() => void>();
  private connection: NativeConnection | null = null;
  private chain: ChainView | null = null;
  private workspaces: WorkspaceRecord[] = [];
  private currentId: string | null = null;
  private wallets: WalletSession[] = [];
  private walletConnection: WalletConnection;
  private journal: Journal | null = null;
  private pending: PendingOperation | null = null;
  private recovery: OperationRecovery | null = null;
  private generation = 0;
  private profiles = new Map<string, ChainProfile>();
  private commandRunning = false;
  private grantHistory: GrantHistory | null = null;
  private networkPreference: NetworkPreference | null = null;
  private networkSubscriptions: (() => void)[] = [];
  private queuedNetworkRefresh: NativeConnection | null = null;
  private networkBlocked = false;
  private networkNoticeId: string | null = null;
  private packageNoticeId: string | null = null;
  private constructor(
    private metadata: Journal,
    private tabId: string,
  ) {
    this.walletConnection = new WalletConnection(
      metadata,
      (wallet, sessions, reason) => {
        this.wallets = sessions;
        this.state = { ...this.state, wallet };
        if (reason) this.invalidateReview(reason);
        this.render();
      },
    );
  }
  static async create(): Promise<Application> {
    const app = new Application(
      await openJournal(deployment.journalName),
      await operationTabId(),
    );
    const stored = await app.metadata.getPreference<unknown>("workspaces");
    if (Array.isArray(stored))
      for (const value of stored) {
        try {
          app.workspaces.push(app.restoreWorkspace(value));
        } catch {
          /* Invalid local metadata remains outside active execution. */
        }
      }
    app.currentId =
      (await app.metadata.getPreference<string>("currentId")) ??
      app.workspaces[0]?.id ??
      null;
    const wallet = readWalletPreference(
      await app.metadata.getPreference<unknown>(WALLET_PREFERENCE),
    );
    app.networkPreference = readNetworkPreference(
      await app.metadata.getPreference<unknown>(NETWORK_PREFERENCE),
    );
    if (app.networkPreference) {
      const { mode, endpoint } = app.networkPreference;
      app.state = {
        ...app.state,
        network: {
          ...app.state.network,
          mode,
          endpoint,
          name: deployment.isTestnet
            ? deployment.defaultName
            : mode === "LOCAL"
              ? "Account Handoff LOCAL"
              : `PortalDot ${mode}`,
        },
      };
    }
    app.render();
    if (wallet) void app.walletConnection.restore(wallet);
    return app;
  }
  getSnapshot = (): AppSnapshot => this.state;
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  private workspace(): WorkspaceRecord | null {
    return this.workspaces.find((w) => w.id === this.currentId) ?? null;
  }
  private clearWorkspaceContext() {
    this.chain = null;
    this.grantHistory = null;
    this.pending = null;
    this.recovery = null;
    // Close this view's journal handle; its durable attempts and leases stay saved.
    this.journal?.close();
    this.journal = null;
  }
  private selected() {
    return (
      this.state.wallet.accounts.find(
        (a) =>
          a.address === this.state.wallet.selectedAddress &&
          (!this.state.wallet.source || a.source === this.state.wallet.source),
      ) ?? null
    );
  }
  private notify(
    message: string,
    tone: "positive" | "warning" | "negative" | "neutral" = "neutral",
  ) {
    this.state = { ...this.state, notice: { id: id(), message, tone } };
    this.render();
  }
  private render() {
    const workspace = this.workspace();
    this.state = {
      ...this.state,
      revision: this.state.revision + 1,
      workspaces: this.workspaces.map((w) => ({
        id: w.id,
        name: w.name,
        mode: w.mode,
      })),
      workspace: workspace ? workspaceView(workspace, this.chain) : null,
      actions: actionViews(
        workspace,
        this.chain,
        this.state.wallet.selectedAddress,
      ),
      operation: this.operationView(),
    };
    for (const listener of this.listeners) listener();
  }
  private operationView(): OperationView | null {
    return operationView(this.pending, this.recovery);
  }
  async dispatch(command: AppCommand): Promise<CommandResult | void> {
    // Inspection is bounded and offline; a pending read-only connection must not
    // prevent reviewing the local file or install any of its network claims.
    if (command.type === "inspect-package") {
      try {
        const importPreview = await this.inspectPackage(command.contents);
        if (this.state.notice?.id === this.packageNoticeId) {
          this.state = { ...this.state, notice: null };
          this.render();
        }
        this.packageNoticeId = null;
        return { importPreview };
      } catch (error) {
        this.notify(errorText(error), "negative");
        this.packageNoticeId = this.state.notice?.id ?? null;
        throw error;
      }
    }
    if (command.type === "dismiss-notice") {
      this.state = { ...this.state, notice: null };
      this.render();
      return;
    }
    if (this.commandRunning)
      throw new Error("Wait for the current action to finish.");
    this.commandRunning = true;
    this.state = { ...this.state, busy: command.type };
    this.render();
    try {
      switch (command.type) {
        case "connect-wallet":
          await this.connectWallet();
          break;
        case "disconnect-wallet":
          await this.walletConnection.disconnect();
          break;
        case "select-account":
          await this.walletConnection.select(command.address);
          break;
        case "connect-network":
          await this.connectNetwork(command.mode, command.endpoint);
          break;
        case "refresh":
          await this.refresh();
          break;
        case "create-workspace":
          await this.createWorkspace(command.input);
          break;
        case "next-handoff":
          await this.nextHandoff();
          break;
        case "plan-handoff":
          await this.planHandoff(command.members);
          break;
        case "select-workspace":
          if (!this.workspaces.some((w) => w.id === command.id))
            throw new Error("Unknown workspace");
          if (this.currentId !== command.id) {
            this.currentId = command.id;
            this.clearWorkspaceContext();
          }
          await this.save();
          await this.refresh();
          break;
        case "prepare-operation":
          await this.prepare(command.actionId, command.fields);
          break;
        case "sign-operation":
          await this.sign(command.id);
          break;
        case "send-operation":
          await this.send(command.id);
          break;
        case "reconcile-operation":
          await this.reconcile(command.id);
          break;
        case "discard-operation":
          if (
            this.pending?.id === command.id &&
            ["prepared", "failed", "stale", "finalized"].includes(
              this.pending.stage,
            )
          ) {
            await this.journal?.releaseLease(this.pending.lease);
            this.pending = null;
            this.recovery = null;
            await this.journal?.setPreference("recovery", null);
          }
          break;
        case "import-package":
          await this.import(command);
          break;
        case "export-package":
          return await this.export();
      }
    } catch (error) {
      this.notify(errorText(error), "negative");
      if (command.type === "import-package")
        this.packageNoticeId = this.state.notice?.id ?? null;
      if (command.type === "connect-network" || command.type === "refresh")
        this.networkNoticeId = this.state.notice?.id ?? null;
      throw error;
    } finally {
      this.commandRunning = false;
      this.state = { ...this.state, busy: null };
      this.render();
      void this.drainNetworkRefresh();
    }
  }
  private invalidateReview(reason: string) {
    if (this.pending?.stage === "prepared") {
      this.pending.stage = "stale";
      this.pending.blockers = [reason];
    }
  }
  private async save() {
    await this.metadata.setPreference("workspaces", json(this.workspaces));
    await this.metadata.setPreference("currentId", this.currentId);
  }
  private restoreWorkspace(input: unknown): WorkspaceRecord {
    return restoreWorkspace(input);
  }
  private async connectWallet() {
    await this.walletConnection.connect();
    if (this.state.wallet.connected) {
      this.notify(
        this.state.wallet.selectedAddress
          ? "Wallet reconnected."
          : "Wallet connected. Select your personal account.",
        "positive",
      );
    }
  }
  private async descriptor(): Promise<NetworkDescriptor | null> {
    return readNetworkDescriptor(this.state.network.mode);
  }
  private stopNetworkObservers() {
    for (const stop of this.networkSubscriptions.splice(0)) stop();
    this.queuedNetworkRefresh = null;
  }
  private invalidateNetwork(
    connection: NativeConnection,
    reconnecting: boolean,
    error: string,
    retryable = true,
  ) {
    if (connection !== this.connection) return;
    this.generation++;
    this.queuedNetworkRefresh = null;
    this.chain = null;
    this.grantHistory = null;
    this.invalidateReview(
      "The network connection changed. Review fresh state before signing.",
    );
    const previouslyBlocked = this.networkBlocked;
    if (!retryable) this.networkBlocked = true;
    const blocked = this.networkBlocked;
    this.state = {
      ...this.state,
      network: {
        ...this.state.network,
        connected: false,
        checking: false,
        reconnecting: reconnecting && !blocked,
        retryable: retryable && !blocked,
        historyProgress: null,
        error:
          previouslyBlocked && this.state.network.error
            ? this.state.network.error
            : error,
        readiness: this.state.network.readiness.map((item) =>
          item.id === "wallet"
            ? item
            : {
                ...item,
                status: "unknown",
                detail:
                  "Fresh finalized observations are unavailable. Reconnect before continuing.",
              },
        ),
      },
    };
    this.render();
  }
  private observeNetwork(connection: NativeConnection) {
    this.stopNetworkObservers();
    const ready = () => {
      if (connection !== this.connection || this.networkBlocked) return;
      this.invalidateNetwork(
        connection,
        true,
        "Rechecking finalized network state.",
      );
      this.queuedNetworkRefresh = connection;
      this.state = {
        ...this.state,
        network: { ...this.state.network, checking: true },
      };
      this.render();
      void this.drainNetworkRefresh();
    };
    this.networkSubscriptions = [
      connection.api.on("disconnected", () => {
        this.invalidateNetwork(
          connection,
          false,
          "The network connection was interrupted.",
        );
      }),
      connection.api.on("reconnecting", () => {
        this.invalidateNetwork(
          connection,
          true,
          "Reconnecting to the native network.",
        );
      }),
      connection.api.on("ready", ready),
      connection.api.on("runtimeUpgraded", () => ready()),
      connection.api.on("error", (failure) => {
        if (connection !== this.connection) return;
        const error = normalizeNetworkFailure(failure);
        this.invalidateNetwork(
          connection,
          isRetryableNetworkFailure(error) &&
            connection.api.status === "reconnecting",
          errorText(error),
          isRetryableNetworkFailure(error),
        );
      }),
    ];
  }
  /** API events cannot compete with wallet requests, broadcasts or manual commands. */
  private async drainNetworkRefresh() {
    if (this.commandRunning || !this.queuedNetworkRefresh) return;
    const connection = this.queuedNetworkRefresh;
    this.queuedNetworkRefresh = null;
    if (connection !== this.connection) return;
    this.commandRunning = true;
    this.state = { ...this.state, busy: "refresh" };
    this.render();
    try {
      await this.refresh();
    } catch {
      // refresh retains the visible error; an automatic read does not add toasts.
    } finally {
      this.commandRunning = false;
      this.state = { ...this.state, busy: null };
      this.render();
      void this.drainNetworkRefresh();
    }
  }
  private async connectNetwork(mode: RuntimeMode, endpoint: string) {
    assertDeploymentMode(mode);
    endpoint = safeEndpoint(endpoint, mode);
    this.generation++;
    this.networkBlocked = false;
    this.invalidateReview("Network changed");
    this.stopNetworkObservers();
    const previous = this.connection;
    this.connection = null;
    this.chain = null;
    this.grantHistory = null;
    const sameTarget =
      this.state.network.mode === mode &&
      this.state.network.endpoint === endpoint;
    this.state = {
      ...this.state,
      network: {
        ...(sameTarget ? this.state.network : {}),
        mode,
        name: deployment.isTestnet
          ? deployment.defaultName
          : mode === "LOCAL"
            ? "Account Handoff LOCAL"
            : `PortalDot ${mode}`,
        endpoint,
        connected: false,
        checking: true,
        reconnecting: sameTarget && !!this.state.network.updatedAt,
        retryable: false,
        error: null,
        historyProgress: null,
        readiness: [],
      },
    };
    this.render();
    // A stopped SDK may already have discarded its socket. Cleanup must not
    // prevent connecting the explicitly selected target.
    await previous?.close().catch(() => {});
    try {
      const descriptor = await this.descriptor();
      if (
        descriptor?.mode === "LOCAL" &&
        descriptor.qualified &&
        !descriptor.nativeMetadataBinding
      )
        throw new Error(
          "Qualified codec metadata is missing; refresh the LOCAL qualification.",
        );
      this.connection = await NativeConnection.connect(
        endpoint,
        mode,
        descriptor?.nativeMetadataBinding,
      );
      this.observeNetwork(this.connection);
      await this.refresh();
    } catch (failure) {
      const error = normalizeNetworkFailure(failure);
      // Local persistence can fail after the network itself was verified.
      if (this.chain && this.state.network.connected) throw error;
      this.stopNetworkObservers();
      await this.connection?.close().catch(() => {});
      this.connection = null;
      this.chain = null;
      this.state = {
        ...this.state,
        network: {
          ...this.state.network,
          connected: false,
          checking: false,
          reconnecting: false,
          retryable: isRetryableNetworkFailure(error),
          error: errorText(error),
        },
      };
      throw error;
    }
  }
  private async profile(
    f: NativeFingerprint,
    d: NetworkDescriptor | null,
  ): Promise<ChainProfile> {
    return qualifiedProfile(
      this.state.network.mode,
      this.profiles,
      f,
      d,
      this.connection ?? undefined,
    );
  }
  private async refresh() {
    const connection = this.connection;
    if (!connection) return;
    const generation = this.generation;
    const current = () =>
      generation === this.generation && connection === this.connection;
    let observationsReady = false;
    this.state = {
      ...this.state,
      network: {
        ...this.state.network,
        checking: true,
        historyProgress: null,
      },
    };
    this.render();
    try {
      const [f, d, genesis] = await Promise.all([
        connection.fingerprint(),
        this.descriptor(),
        connection.api.rpc.chain_getBlockHash(0),
      ]);
      assertDeploymentGenesis(f.genesis);
      if (!current()) return;
      // Dedot retains api.genesisHash across a reconnect. A fresh transport
      // must independently confirm it before cached client identity is reused.
      if (hex(genesis, 32) !== f.genesis)
        throw new Error(
          "The endpoint genesis changed. Connect to the verified network again.",
        );
      if (
        d?.mode === "LOCAL" &&
        d.nativeRpc !== connection.endpoint &&
        new URL(d.nativeRpc).toString() !== connection.endpoint
      )
        throw new Error(
          "The endpoint does not match the active network descriptor",
        );
      const profile = await this.profile(f, d);
      if (!current()) return;
      const w = this.workspace();
      const observedWorkspace = w ? { ...w } : null;
      this.grantHistory = null;
      let lastHistoryProgressAt = 0;
      const observed = await readWorkspaceState(
        connection,
        f,
        observedWorkspace,
        this.state.wallet.accounts,
        (completed, total) => {
          if (!current()) return;
          const now = Date.now();
          if (completed !== total && now - lastHistoryProgressAt < 200) return;
          lastHistoryProgressAt = now;
          this.state = {
            ...this.state,
            network: {
              ...this.state.network,
              historyProgress: { completed, total },
            },
          };
          this.render();
        },
      );
      if (!current()) return;
      this.grantHistory = observed.history;
      const { accounts, grant } = observed;
      this.chain = {
        fingerprint: f,
        accounts,
        grant,
        profile,
        descriptor: d,
      };
      this.state = {
        ...this.state,
        network: connectedNetwork(
          this.state.network,
          f,
          d,
          profile,
          this.state.wallet.connected,
        ),
      };
      observationsReady = true;
      this.networkBlocked = false;
      if (w && observed.baselineChanged && observedWorkspace) {
        w.baseline = observedWorkspace.baseline;
        await this.save();
        if (!current()) return;
      }
      if (w) {
        await this.journal?.close();
        const journal = await openJournal(
          `account-handoff:${w.mode.toLowerCase()}:${f.genesis}:${d?.mode === "LOCAL" ? d.runId : "network"}:${w.id}`,
        );
        if (!current()) {
          journal.close();
          return;
        }
        this.journal = journal;
        await this.journal.appendRecord(profile);
        if (!current()) return;
        if (!this.pending)
          this.recovery =
            (await this.journal.getPreference<OperationRecovery | null>(
              "recovery",
            )) ?? null;
        if (!current()) return;
        await this.updateCertificate();
      }
      if (!current()) return;
      const preference = readNetworkPreference({
        version: 1,
        mode: this.state.network.mode,
        endpoint: connection.endpoint,
      });
      if (
        preference &&
        (preference.mode !== this.networkPreference?.mode ||
          preference.endpoint !== this.networkPreference?.endpoint)
      ) {
        await this.metadata.setPreference(NETWORK_PREFERENCE, preference);
        if (!current()) return;
        this.networkPreference = preference;
      }
      if (this.state.notice?.id === this.networkNoticeId)
        this.state = { ...this.state, notice: null };
      this.networkNoticeId = null;
    } catch (failure) {
      if (!current()) return;
      const error = normalizeNetworkFailure(failure);
      if (observationsReady && !isRetryableNetworkFailure(error)) {
        // Chain observations remain fresh if saving local configuration or
        // journal data fails. Storage failure is not a transport disconnect.
        this.networkBlocked = true;
        this.state = {
          ...this.state,
          network: {
            ...this.state.network,
            checking: false,
            reconnecting: false,
            retryable: false,
            error: errorText(error),
          },
        };
        throw error;
      }
      // A refresh may follow a workspace switch. Retaining the previous chain view
      // would present another workspace's grant and balances as current evidence.
      this.chain = null;
      this.grantHistory = null;
      const retryable =
        isRetryableNetworkFailure(error) && !this.networkBlocked;
      if (!retryable) this.networkBlocked = true;
      this.state = {
        ...this.state,
        network: {
          ...this.state.network,
          connected: false,
          checking: false,
          reconnecting: false,
          retryable,
          historyProgress: null,
          error: errorText(error),
          readiness: this.state.network.readiness.map((item) =>
            item.id === "wallet"
              ? item
              : {
                  ...item,
                  status: "unknown",
                  detail:
                    "Fresh finalized observations are unavailable. Refresh the network state before continuing.",
                },
          ),
        },
      };
      throw error;
    } finally {
      if (current())
        this.state = {
          ...this.state,
          network: { ...this.state.network, historyProgress: null },
        };
      this.render();
    }
  }
  private async createWorkspace(
    input: WorkspaceInput,
    verified?: VerifiedLocalWorkspaceImport,
  ) {
    if (!this.chain) throw new Error("Connect to a network first.");
    const w = createWorkspaceRecord(
      input,
      this.state.network.mode,
      this.chain.fingerprint.genesis,
      this.selected()?.address,
    );
    if ((input.contract || input.grantId !== undefined) && !input.beneficiary)
      throw new Error(
        "Connect the grant's Pure beneficiary and its creation receipt first.",
      );
    if (input.beneficiary && !verified) {
      if (this.chain.profile.status !== "accepted")
        throw new Error(
          "Qualify the network before connecting an existing beneficiary.",
        );
      if (!input.creation || !this.connection || !this.chain.descriptor)
        throw new Error(
          "Connecting a beneficiary requires its creation block and transaction on a qualified network.",
        );
      verified = await verifyWorkspaceConnection(
        input,
        input.creation,
        this.connection,
        this.chain.descriptor,
      );
    }
    if (verified) {
      w.creator = verified.creator;
      w.creationBlock = verified.creationBlock;
      w.creationEvidence = verified.creationEvidence;
    }
    this.workspaces.push(w);
    this.currentId = w.id;
    this.clearWorkspaceContext();
    await this.save();
    await this.refresh();
    this.notify(
      "Workspace saved. Authority and state are verified through native RPC.",
      "positive",
    );
  }
  private async planHandoff(members: string[]) {
    const workspace = this.workspace();
    if (!workspace || !this.connection || !this.chain || !this.journal)
      throw new Error("Open a workspace on its network first.");
    if (this.recovery || (this.pending && !terminal.has(this.pending.stage)))
      throw new Error("Finish or reconcile the current operation first.");
    await this.refresh();
    if (this.chain.fingerprint.genesis !== workspace.genesis)
      throw new Error("Connect to this workspace's network first.");
    if (
      workspace.pure &&
      workspaceView(workspace, this.chain).authority !== "M0"
    )
      throw new Error(
        "Verify the current group as the beneficiary's sole controller first.",
      );
    for (const record of await this.journal.listRecords("FrozenEnvelope")) {
      if (
        record.kind === "FrozenEnvelope" &&
        record.controller?.account === workspace.M0.account &&
        record.innerRuntimeCallHash &&
        (await this.connection.proposal(
          workspace.M0.account,
          hex(record.innerRuntimeCallHash, 32),
        ))
      )
        throw new Error(
          "Complete or cancel the current group's outstanding proposal before planning a handoff.",
        );
    }
    const next = planHandoff(workspace, members);
    if (workspace.pure && this.chain.grant)
      next.handoffBaseline = captureHandoffBaseline(workspace, this.chain);
    this.workspaces = this.workspaces.map((item) =>
      item.id === next.id ? next : item,
    );
    this.pending = null;
    await this.save();
    this.render();
    this.notify(
      "Replacement group saved. Review the on-chain handoff separately.",
      "positive",
    );
  }
  private async nextHandoff() {
    if (this.recovery || (this.pending && !terminal.has(this.pending.stage)))
      throw new Error("Finish or reconcile the current operation first.");
    await this.refresh();
    const workspace = this.workspace();
    if (
      !workspace ||
      !this.chain ||
      !this.connection ||
      !this.journal ||
      !this.grantHistory
    )
      throw new Error("Read the current workspace and grant history first.");
    const next = await verifyAndAdvanceHandoff({
      workspace,
      chain: this.chain,
      connection: this.connection,
      journal: this.journal,
      history: this.grantHistory,
      accounting: await this.accounting(
        this.chain.fingerprint,
        this.chain.accounts,
      ),
    });
    this.workspaces = this.workspaces.map((item) =>
      item.id === next.id ? next : item,
    );
    this.pending = null;
    await this.save();
    await this.refresh();
    this.notify(
      "Previous handoff saved. The authorized group is now the current group.",
      "positive",
    );
  }
  private async prepare(actionId: string, fields: Record<string, string>) {
    const selected = this.selected();
    if (!selected || !this.connection || !this.chain || !this.journal)
      throw new Error(
        "Connect a network, open a workspace, and select a signer.",
      );
    if (this.recovery || (this.pending && !terminal.has(this.pending.stage)))
      throw new Error("Finish or reconcile the current operation first.");
    await this.refresh();
    if (
      actionId === "GRC-ROTATION-ADD-M1" &&
      !this.workspace()!.handoffBaseline
    ) {
      this.workspace()!.handoffBaseline = captureHandoffBaseline(
        this.workspace()!,
        this.chain!,
      );
      await this.save();
    }
    this.pending = await prepareOperation(
      {
        selected,
        chain: this.chain!,
        connection: this.connection,
        journal: this.journal,
        workspace: this.workspace()!,
        wallets: this.wallets,
        tabId: this.tabId,
        grantHistory: this.grantHistory,
      },
      actionId,
      fields,
    );
    this.recovery = null;
    this.render();
  }
  private async accounting(
    f: NativeFingerprint,
    accounts: ChainView["accounts"],
  ): Promise<AccountingLedger | undefined> {
    return accountingLedger(
      this.workspace(),
      this.chain,
      this.connection,
      f,
      accounts,
    );
  }
  private async updateCertificate() {
    await updateWorkspaceCertificate({
      workspace: this.workspace(),
      chain: this.chain,
      connection: this.connection,
      journal: this.journal,
      grantHistory: this.grantHistory,
      accounting: (f, accounts) => this.accounting(f, accounts),
      saveWorkspace: () => this.save(),
    });
  }
  private async operationInputs(
    p: Pick<
      PendingOperation,
      "envelope" | "action" | "signer" | "phase" | "actionId"
    >,
    f: NativeFingerprint,
  ): Promise<FreshOperationInput & { accounts: ChainView["accounts"] }> {
    return loadOperationInputs(
      {
        connection: this.connection!,
        chain: this.chain!,
        workspace: this.workspace()!,
        accounting: (f, accounts) => this.accounting(f, accounts),
      },
      p,
      f,
    );
  }
  private async checkPending(idValue: string) {
    const p = this.pending;
    const connection = this.connection;
    const w = this.workspace();
    if (
      !p ||
      p.id !== idValue ||
      !connection ||
      !this.journal ||
      !this.chain ||
      !w
    )
      throw new Error("Operation unavailable");
    return checkPendingOperation({
      pending: p,
      connection,
      journal: this.journal,
      wallets: this.wallets,
      getSelected: () => this.selected(),
      clearRecovery: () => {
        this.recovery = null;
      },
      descriptor: () => this.descriptor(),
      profile: (f, d) => this.profile(f, d),
      operationInputs: (pending, f) => this.operationInputs(pending, f),
    });
  }
  private async saveRecovery(p: PendingOperation) {
    this.recovery = {
      id: p.id,
      workspaceId: p.workspaceId,
      actionId: p.actionId,
      title: p.title,
      stage: p.stage,
      envelopeId: p.envelope.recordId,
      context: p.context,
      attemptId: p.signedAttempt?.recordId ?? null,
      signer: p.signer,
    };
    await this.journal!.setPreference("recovery", this.recovery);
  }
  private async sign(idValue: string) {
    const connection = this.connection;
    const generation = this.generation;
    await signOperation(
      {
        checkPending: (id) => this.checkPending(id),
        assertNetworkUnchanged: () => {
          if (connection !== this.connection || generation !== this.generation)
            throw new Error(
              "The network changed during signing. Review fresh state before continuing.",
            );
        },
        getSelected: () => this.selected(),
        wallets: this.wallets,
        journal: this.journal!,
        connection: this.connection!,
        saveRecovery: (p) => this.saveRecovery(p),
        clearRecovery: () => {
          this.recovery = null;
        },
        render: () => this.render(),
      },
      idValue,
    );
  }
  private async send(idValue: string) {
    const connection = this.connection;
    const generation = this.generation;
    const assertNetworkUnchanged = () => {
      if (
        !connection ||
        connection !== this.connection ||
        generation !== this.generation
      )
        throw new Error(
          "The network changed before sending. Reconnect and verify the saved packet before continuing.",
        );
    };
    const p = await this.checkPending(idValue);
    assertNetworkUnchanged();
    if (p.stage !== "signed" || !p.signedBytes)
      throw new Error("A verified, saved signature is required");
    p.stage = "broadcast";
    const priorRecovery = this.recovery;
    let recoverySaved = false;
    try {
      await this.saveRecovery(p);
      recoverySaved = true;
      assertNetworkUnchanged();
    } catch (error) {
      // No submission has begun. Keep the exact saved packet ready for a later,
      // explicit send once the recovery checkpoint can be retained.
      p.stage = "signed";
      this.recovery = priorRecovery;
      if (recoverySaved) await this.saveRecovery(p);
      throw error;
    }
    this.render();
    try {
      const receipt = await connection!.send(p.signedBytes);
      await this.finish(p, receipt);
    } catch (error) {
      p.stage = "unknown";
      p.blockers = [errorText(error)];
      await this.saveRecovery(p);
      throw error;
    }
  }
  private async finish(p: PendingOperation, receipt: NativeReceipt) {
    const w = this.workspace();
    if (
      !w ||
      !this.connection ||
      !this.chain ||
      !this.journal ||
      !p.signedAttempt
    )
      throw new Error("Operation context is missing");
    await finalizeOperation(
      {
        workspace: w,
        connection: this.connection,
        appendRecord: (record) => this.journal!.appendRecord(record),
        refresh: async () => {
          await this.save();
          await this.refresh();
          return this.chain!;
        },
        postconditions: (pending, finalized) =>
          this.postconditions(pending, finalized),
      },
      p,
      receipt,
    );
    // Persist the observed outcome before clearing recovery or deriving a certificate.
    // Certificate verification can outlive the page that submitted this operation.
    await this.save();
    if (p.stage === "unknown") {
      await this.saveRecovery(p);
    } else {
      await this.journal!.setPreference("recovery", null);
      this.recovery = null;
      await this.journal!.releaseLease(p.lease);
    }
    this.render();
    await this.updateCertificate();
    await this.save();
    this.render();
  }
  private async postconditions(
    p: PendingOperation,
    receipt: NativeReceipt,
  ): Promise<Postcondition[]> {
    return operationPostconditions(
      {
        workspace: this.workspace()!,
        chain: this.chain!,
        connection: this.connection!,
        accounting: (f, accounts) => this.accounting(f, accounts),
      },
      p,
      receipt,
    );
  }
  private async reconcile(idValue: string) {
    if (!this.connection || !this.journal)
      throw new Error("Connect to the same network.");
    const p = this.pending;
    if (p?.id === idValue && p.signedAttempt) {
      if (
        !this.chain ||
        this.workspace()?.id !== p.workspaceId ||
        p.envelope.intent.profileDigest !== this.chain.profile.digest
      )
        throw new Error(
          "The original workspace and exact runtime profile are required.",
        );
      const receipt = await this.connection.findReceipt(
        hex(p.signedAttempt.signedExtrinsicHash, 32),
      );
      if (!receipt)
        throw new Error(
          "The attempt was not found in available finalized history. It will not be retried automatically.",
        );
      await this.finish(p, receipt);
      return;
    }
    const { recovered, receipt, resumeSigned } = await resolveRecovery(
      {
        recovery: this.recovery,
        workspaceId: this.workspace()?.id,
        chain: this.chain,
        journal: this.journal,
        connection: this.connection,
        tabId: this.tabId,
      },
      idValue,
    );
    this.pending = recovered;
    if (resumeSigned) {
      try {
        await this.checkPending(recovered.id);
        await this.saveRecovery(recovered);
      } catch (error) {
        if (recovered.stage !== "stale") this.pending = null;
        await this.journal.releaseLease(recovered.lease);
        throw error;
      }
      this.render();
      return;
    }
    await this.finish(recovered, receipt!);
  }
  private async inspectPackage(
    contents: string,
  ): Promise<PackageImportPreview> {
    const raw = object(parseBoundedJson(contents));
    const digest = await sha256(contents);
    if (raw["format"] === "account-handoff-local-workspace") {
      const input = object(raw["input"]);
      return {
        digest,
        kind: "local",
        recordCount: 0,
        name: typeof input["name"] === "string" ? input["name"] : null,
        mode: "LOCAL",
        genesis:
          typeof raw["genesisHash"] === "string" ? raw["genesisHash"] : null,
        workspaceInput: null,
        missingFields: [],
        matchingWorkspaces: [],
        warnings: [
          "This LOCAL configuration must match the selected qualified local run. Provider settings from the file are never installed.",
        ],
      };
    }
    const candidate = await parseWorkspacePackage(contents);
    const matchingWorkspaces = this.workspaces
      .filter((w) => {
        if (candidate.workspace.mode && candidate.workspace.mode !== w.mode)
          return false;
        if (
          candidate.source === "workspace-package" &&
          !sameWorkspace(w, candidate.workspace)
        )
          return false;
        try {
          assertWorkspaceEvidence(candidate.evidence.records, w);
          return true;
        } catch {
          return false;
        }
      })
      .map((w) => ({ id: w.id, name: w.name }));
    return {
      digest,
      kind: candidate.source === "workspace-package" ? "workspace" : "evidence",
      recordCount: candidate.evidence.records.length,
      name: candidate.workspace.name ?? null,
      mode: candidate.workspace.mode ?? null,
      genesis: candidate.workspace.genesis ?? null,
      workspaceInput: descriptorInput(candidate.workspace),
      missingFields: candidate.missingFields,
      warnings: candidate.warnings,
      matchingWorkspaces,
    };
  }
  private async import(
    command: Extract<AppCommand, { type: "import-package" }>,
  ) {
    const { contents } = command;
    const raw = object(parseBoundedJson(contents));
    if (
      command.previewDigest &&
      command.previewDigest !== (await sha256(contents))
    )
      throw new Error(
        "The package changed after review. Review it again before importing.",
      );
    if (raw["format"] === "account-handoff-local-workspace") {
      if (
        !this.connection ||
        !this.chain ||
        this.state.network.mode !== "LOCAL"
      )
        throw new Error(
          "Connect to the matching LOCAL network before importing.",
        );
      const descriptor = this.chain.descriptor;
      if (descriptor?.mode !== "LOCAL")
        throw new Error("A qualified LOCAL manifest is required.");
      const verified = await validateLocalWorkspaceImport(
        raw,
        this.connection,
        descriptor,
      );
      await this.createWorkspace(verified.input, verified);
      this.notify(
        "LOCAL workspace imported; Pure provenance verified.",
        "positive",
      );
      return;
    }
    const candidate = await parseWorkspacePackage(contents);
    if (candidate.source === "workspace-package" && !command.previewDigest)
      throw new Error("Review the workspace package before restoring it.");
    if (
      !this.connection ||
      !this.chain ||
      !this.state.network.connected ||
      this.state.network.checking ||
      this.state.network.reconnecting
    )
      throw new Error(
        "Connect and verify the matching network before restoring this workspace. Your package is kept for retry.",
      );
    // Read a fresh network anchor without refreshing an unrelated selected
    // workspace. A file may contain newer receipts than the last visible view.
    const connection = this.connection;
    const generation = this.generation;
    const [fingerprint, networkDescriptor, genesis] = await Promise.all([
      connection.fingerprint(),
      this.descriptor(),
      connection.api.rpc.chain_getBlockHash(0),
    ]);
    assertDeploymentGenesis(fingerprint.genesis);
    if (hex(genesis, 32) !== fingerprint.genesis)
      throw new Error(
        "The endpoint genesis changed. Reconnect to the matching network.",
      );
    if (
      networkDescriptor?.mode === "LOCAL" &&
      new URL(networkDescriptor.nativeRpc).toString() !== connection.endpoint
    )
      throw new Error("The endpoint does not match the selected LOCAL run.");
    const profile = await this.profile(fingerprint, networkDescriptor);
    const current: ChainView = {
      fingerprint,
      descriptor: networkDescriptor,
      profile,
      accounts: {},
      grant: null,
    };
    const assertCurrent = () => {
      if (
        !connection ||
        !current ||
        connection !== this.connection ||
        generation !== this.generation ||
        !this.state.network.connected ||
        this.state.network.checking ||
        this.state.network.reconnecting
      )
        throw new Error(
          "Connect and verify the matching network before restoring this workspace. Your package is kept for retry.",
        );
    };
    assertCurrent();
    if (current!.profile.status !== "accepted")
      throw new Error(
        "The selected network must be qualified before restoring a workspace.",
      );
    let target = command.targetWorkspaceId
      ? this.workspaces.find((w) => w.id === command.targetWorkspaceId)
      : undefined;
    if (command.targetWorkspaceId && !target)
      throw new Error(
        "The selected workspace is no longer available. Review the package again.",
      );
    if (
      !target &&
      !command.previewDigest &&
      candidate.source === "legacy-evidence"
    )
      target = this.workspace() ?? undefined;
    if (target) {
      if (
        target.mode !== this.state.network.mode ||
        target.genesis !== current!.fingerprint.genesis
      )
        throw new Error(
          "Connect to the selected workspace's matching network before importing.",
        );
      assertWorkspaceEvidence(candidate.evidence.records, target);
      if (
        candidate.source === "workspace-package" &&
        !sameWorkspace(target, candidate.workspace)
      )
        throw new Error(
          "The selected workspace does not match the package configuration.",
        );
    }
    let descriptor: ReturnType<typeof validateWorkspaceDescriptor> | null =
      null;
    if (!target) {
      if (candidate.source === "workspace-package")
        descriptor = validateWorkspaceDescriptor(candidate.workspace);
      else if (command.workspaceInput)
        descriptor = completeDescriptor(
          candidate.workspace,
          command.workspaceInput,
          this.state.network.mode,
          candidate.workspace.genesis ?? current!.fingerprint.genesis,
        );
      else
        throw new Error(
          "This evidence file has no complete workspace configuration. Complete the missing details or select a matching workspace.",
        );
    }
    if (descriptor) {
      if (
        descriptor.mode !== this.state.network.mode ||
        descriptor.genesis !== current!.fingerprint.genesis
      )
        throw new Error(
          "The package belongs to another network. Connect to its matching network before restoring it.",
        );
      const configured = createWorkspaceRecord(
        descriptorInput(descriptor) as WorkspaceInput,
        descriptor.mode,
        descriptor.genesis,
      );
      assertWorkspaceEvidence(candidate.evidence.records, configured);
      const matches = this.workspaces.filter(
        (w) => w.mode === descriptor!.mode && sameWorkspace(w, descriptor!),
      );
      if (matches.length > 1)
        throw new Error(
          "Several local workspaces match this package. Select one in the review.",
        );
      target = matches[0];
      if (target && !sameWorkspaceConfiguration(target, descriptor))
        throw new Error(
          "A local workspace has the same beneficiary but different controller or participant settings. Select it explicitly to merge evidence while keeping its configuration.",
        );
    }
    const workspace = target
      ? structuredClone(target)
      : await restoreWorkspaceCandidate(
          descriptor!,
          candidate.evidence.records,
          connection!,
          current!.descriptor,
          current!.fingerprint,
        );
    if (target && descriptor && candidate.source === "workspace-package")
      await restoreWorkspaceCandidate(
        descriptor,
        candidate.evidence.records,
        connection!,
        current!.descriptor,
        current!.fingerprint,
      );
    assertCurrent();
    assertWorkspaceEvidence(candidate.evidence.records, workspace);
    const observed = await readWorkspaceState(
      connection!,
      current!.fingerprint,
      workspace,
      this.state.wallet.accounts,
    );
    if (descriptor)
      await restoreCheckpointHints(
        workspace,
        descriptor,
        connection!,
        current!.fingerprint,
      );
    const { verifyWorkspaceEvidence } = await import("./workspace-evidence");
    await verifyWorkspaceEvidence(
      candidate.evidence.records,
      {
        ...workspace,
        contract:
          workspace.contract ?? current.descriptor?.contract?.address ?? null,
      },
      connection!,
      current!.fingerprint,
    );
    await restoreWorkspaceHistory(
      workspace,
      candidate.evidence.records,
      connection!,
      current!.fingerprint,
      workspace.handoffBaseline?.blockHash ?? null,
    );
    assertCurrent();
    const namespace = `account-handoff:${workspace.mode.toLowerCase()}:${workspace.genesis}:${current!.descriptor?.mode === "LOCAL" ? current!.descriptor.runId : "network"}:${workspace.id}`;
    const journal = await openJournal(namespace);
    let published = false;
    try {
      await journal.importRecords(candidate.evidence.records);
      assertCurrent();
      const workspaces = target
        ? this.workspaces.map((w) => (w.id === workspace.id ? workspace : w))
        : [...this.workspaces, workspace];
      await this.metadata.setPreferences({
        workspaces: json(workspaces),
        currentId: workspace.id,
      });
      published = true;
      this.clearWorkspaceContext();
      this.workspaces = workspaces;
      this.currentId = workspace.id;
      this.journal = journal;
      if (generation === this.generation && connection === this.connection) {
        this.chain = {
          ...current!,
          accounts: observed.accounts,
          grant: observed.grant,
        };
        this.grantHistory = observed.history;
        this.state = {
          ...this.state,
          network: connectedNetwork(
            this.state.network,
            current.fingerprint,
            current.descriptor,
            current.profile,
            this.state.wallet.connected,
          ),
        };
      }
      this.notify(
        "Workspace restored. Public configuration and unsigned evidence are saved; wallet access and signing remain your choice.",
        "positive",
      );
      // Reconstruct continuity from the saved graph independently. No wallet or
      // transaction command is scheduled by this read-only follow-up.
      if (
        generation === this.generation &&
        connection === this.connection &&
        this.state.network.connected
      )
        this.queuedNetworkRefresh = connection;
    } finally {
      if (!published) {
        journal.close();
        if (!target) await deleteDB(namespace);
      }
    }
  }
  private async export(): Promise<CommandResult> {
    const workspace = this.workspace();
    if (!this.journal || !workspace) throw new Error("Open a workspace");
    const records = await this.journal.listRecords();
    const pkg = await exportWorkspacePackage(workspace, records);
    const contents = canonicalJson(pkg);
    parseBoundedJson(contents);
    return {
      download: {
        name: "account-handoff-workspace.json",
        mime: "application/json",
        contents,
      },
    };
  }
}

export async function createApplication(): Promise<ApplicationFacade> {
  return Application.create();
}
