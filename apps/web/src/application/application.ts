import type { NetworkDescriptor } from "./network-descriptor";
import {
  canonicalJson,
  parseBoundedJson,
  exportPortable,
  importPortable,
} from "@account-handoff/contracts";
import type {
  ChainProfile,
  Postcondition,
  AccountingLedger,
} from "@account-handoff/contracts";
import { type FreshOperationInput } from "@account-handoff/domain";
import {
  NativeConnection,
  hex,
  object,
  type NativeReceipt,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import type { WalletSession } from "@account-handoff/wallet-adapter";
import { type GrantHistory } from "@account-handoff/grant-adapter";
import { openJournal, type Journal } from "@account-handoff/local-store";
import type {
  ApplicationFacade,
  AppSnapshot,
  AppCommand,
  CommandResult,
  WorkspaceInput,
  OperationView,
  RuntimeMode,
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
import { signOperation } from "./sign-operation";
import { operationTabId } from "./tab-identity";
import {
  WalletConnection,
  readWalletPreference,
  WALLET_PREFERENCE,
} from "./wallet-connection";
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
          this.currentId = command.id;
          this.pending = null;
          this.recovery = null;
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
          await this.import(command.contents);
          break;
        case "export-package":
          return await this.export();
      }
    } catch (error) {
      this.notify(errorText(error), "negative");
      throw error;
    } finally {
      this.commandRunning = false;
      this.state = { ...this.state, busy: null };
      this.render();
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
  private async connectNetwork(mode: RuntimeMode, endpoint: string) {
    assertDeploymentMode(mode);
    this.generation++;
    this.invalidateReview("Network changed");
    if (this.connection) await this.connection.close();
    this.connection = null;
    this.chain = null;
    this.state = {
      ...this.state,
      network: {
        mode,
        name: deployment.isTestnet
          ? deployment.defaultName
          : mode === "LOCAL"
            ? "Account Handoff LOCAL"
            : `PortalDot ${mode}`,
        endpoint,
        connected: false,
        checking: true,
        readiness: [],
      },
    };
    this.render();
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
      await this.refresh();
    } catch (error) {
      await this.connection?.close();
      this.connection = null;
      this.chain = null;
      this.state = {
        ...this.state,
        network: {
          ...this.state.network,
          connected: false,
          checking: false,
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
    this.state = {
      ...this.state,
      network: { ...this.state.network, checking: true },
    };
    this.render();
    try {
      const [f, d] = await Promise.all([
        connection.fingerprint(),
        this.descriptor(),
      ]);
      assertDeploymentGenesis(f.genesis);
      if (
        d &&
        d.nativeRpc !== connection.endpoint &&
        new URL(d.nativeRpc).toString() !== connection.endpoint
      )
        throw new Error(
          "The endpoint does not match the active network descriptor",
        );
      const profile = await this.profile(f, d);
      const w = this.workspace();
      this.grantHistory = null;
      const observed = await readWorkspaceState(
        connection,
        f,
        w,
        this.state.wallet.accounts,
      );
      this.grantHistory = observed.history;
      if (observed.baselineChanged) await this.save();
      const { accounts, grant } = observed;
      if (generation !== this.generation) return;
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
      if (w) {
        await this.journal?.close();
        this.journal = await openJournal(
          `account-handoff:${w.mode.toLowerCase()}:${f.genesis}:${d?.mode === "LOCAL" ? d.runId : "network"}:${w.id}`,
        );
        await this.journal.appendRecord(profile);
        if (!this.pending)
          this.recovery =
            (await this.journal.getPreference<OperationRecovery | null>(
              "recovery",
            )) ?? null;
        await this.updateCertificate();
      }
    } catch (error) {
      if (this.chain?.currentContinuity)
        this.chain.currentContinuity = {
          ...this.chain.currentContinuity,
          status: "unavailable",
          reasons: ["Fresh finalized observations are unavailable."],
        };
      this.state = {
        ...this.state,
        network: {
          ...this.state.network,
          checking: false,
          error: errorText(error),
        },
      };
      throw error;
    } finally {
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
    this.pending = null;
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
    await signOperation(
      {
        checkPending: (id) => this.checkPending(id),
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
    const p = await this.checkPending(idValue);
    if (p.stage !== "signed" || !p.signedBytes)
      throw new Error("A verified, saved signature is required");
    p.stage = "broadcast";
    await this.saveRecovery(p);
    this.render();
    try {
      const receipt = await this.connection!.send(p.signedBytes);
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
  private async import(contents: string) {
    const raw = object(parseBoundedJson(contents));
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
    const result = await importPortable(contents);
    if (!this.chain || !this.journal)
      throw new Error("Open the matching workspace first");
    for (const record of result.records) {
      if (
        record.kind === "ChainProfile" &&
        record.genesis !== this.chain.fingerprint.genesis
      )
        throw new Error("The package belongs to another network");
      if (record.kind === "FrozenEnvelope")
        await this.journal.sealEnvelope(record);
      else await this.journal.appendRecord(record);
    }
    this.notify(
      "Package verified and saved for reconciliation. Importing does not authorize signing.",
      "positive",
    );
  }
  private async export(): Promise<CommandResult> {
    if (!this.journal) throw new Error("Open a workspace");
    const records = await this.journal.listRecords();
    const pkg = await exportPortable(records);
    return {
      download: {
        name: "account-handoff-evidence.json",
        mime: "application/json",
        contents: canonicalJson(pkg),
      },
    };
  }
}

export async function createApplication(): Promise<ApplicationFacade> {
  return Application.create();
}
