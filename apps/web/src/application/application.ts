import { createKeyMulti } from "@polkadot/util-crypto";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import {
  createChainProfile,
  createSnapshot,
  createFrozenEnvelope,
  createLocalProgress,
  createSignedAttempt,
  canonicalJson,
  sha256,
  parseBoundedJson,
  exportPortable,
  importPortable,
  hexBytes,
  sealRecord,
  OPERATION_REQUIREMENTS,
  verifyRecordDigest,
} from "@account-handoff/contracts";
import type {
  ChainProfile,
  Intent,
  DataValue,
  ResourceBounds,
  CallTree,
  EvidenceRef,
  GrantFlowScope,
  FrozenEnvelope,
  SignedAttempt,
  Postcondition,
  NativeProposal,
  GrantContext,
  AccountingLedger,
  VestingTuple,
  ReserveReason,
} from "@account-handoff/contracts";
import {
  makeController,
  planOperation,
  parseUnits,
  formatUnits,
  classifyAuthority,
  otherSignatories,
  OPERATION_IDS,
  validateFreshOperation,
  assessPreparation,
  type FreshOperationInput,
  hasPreservedSchedule,
  vestingRemaining,
} from "@account-handoff/domain";
import {
  NativeConnection,
  account,
  hex,
  contractAddress,
  plain,
  object,
  type Hex,
  type NativeAction,
  type NativeReceipt,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import {
  connectWallets,
  requestSignature,
  WalletRejectedError,
  WalletGuardError,
  type WalletSession,
} from "@account-handoff/wallet-adapter";
import {
  readGrant,
  encodeCreateGrant,
  encodeSubmission,
  encodeApproval,
  ZERO_ADDRESS,
  decodeGrantEvent,
  scanGrantHistory,
  roundAtSubmission,
  isGrantReviewer,
  type GrantHistory,
} from "@account-handoff/grant-adapter";
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
import type {
  ChainView,
  WorkspaceRecord,
  LocalDescriptor,
  PendingOperation,
  WorkspaceHistory,
} from "./models";
import { actionViews, workspaceView } from "./presentation";
import {
  buildReadAnchor,
  buildSigningContext,
  nativeActionFromTree,
  buildReceipt,
  cancellationMatches,
} from "./record-builders";
import {
  assessCurrentContinuity,
  buildWorkspaceCertificate,
  certificateMatchesWorkspace,
  certificateReferencesPresent,
} from "./continuity";
import { validateLocalWorkspaceImport } from "./local-import";
import {
  assessCurrentWallet,
  buildLocalQualification,
  completePreparationSnapshot,
} from "./qualification";

interface Recovery {
  id: string;
  workspaceId: string;
  actionId: string;
  title: string;
  stage: string;
  envelopeId: string;
  context: PendingOperation["context"];
  attemptId: string | null;
  signer: string;
}
const json = <T>(value: T): T => plain(value) as T;
const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const id = () => crypto.randomUUID();
const terminal = new Set(["finalized", "failed", "stale"]);
function schedules(value: unknown): VestingTuple[] {
  if (value === null || value === undefined) return [];
  if (!Array.isArray(value)) throw new Error("Невідомий формат native vesting");
  return value.map((item) => {
    const v = object(item);
    return {
      locked: String(v["locked"]),
      perBlock: String(v["perBlock"]),
      startingBlock: String(v["startingBlock"]),
      clockDomain: "native-block-number",
    };
  });
}
function liabilities(value: unknown): ReserveReason[] {
  if (!Array.isArray(value))
    throw new Error("Повний облік резервів недоступний");
  return value.map((item) => {
    const v = object(item);
    if (v["amount"] === undefined) throw new Error("Сума резерву невідома");
    return {
      reason: canonicalJson(v["id"] ?? v["reason"] ?? "unknown"),
      amountNative: String(v["amount"]),
      evidence: [],
    };
  });
}
const initial = (): AppSnapshot => ({
  revision: 0,
  network: {
    mode: "LOCAL",
    name: "Account Handoff LOCAL",
    endpoint: "ws://127.0.0.1:9944",
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
  private walletUnsub: (() => void)[] = [];
  private journal: Journal | null = null;
  private pending: PendingOperation | null = null;
  private recovery: Recovery | null = null;
  private generation = 0;
  private profiles = new Map<string, ChainProfile>();
  private commandRunning = false;
  private tabId = id();
  private grantHistory: GrantHistory | null = null;
  private constructor(private metadata: Journal) {}
  static async create(): Promise<Application> {
    const app = new Application(await openJournal("account-handoff:local:ui"));
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
    app.render();
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
        (a) => a.address === this.state.wallet.selectedAddress,
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
    const p = this.pending;
    if (!p) {
      const r = this.recovery;
      return r
        ? {
            id: r.id,
            actionId: r.actionId,
            title: r.title,
            description:
              r.stage === "signed"
                ? "Підписані байти збережені до надсилання. Відновіть їхній перегляд і перевірте поточний стан перед окремою командою надсилання."
                : "Збережений запит потребує звіряння після перезапуску.",
            stage: r.stage,
            tone: "warning",
            actor: r.signer,
            signer: { address: r.signer },
            route: [],
            consequences: ["Перезапуск не повторює підпис або відправлення."],
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
        "Операція використовує саме показані native-виклики.",
        "Нативна пропозиція залишається дійсною незалежно від закриття цього перегляду.",
      ],
      terms: [
        { label: "Мережа", value: p.prepared.fingerprint.specName },
        {
          label: "Контрольна точка",
          value: String(p.prepared.fingerprint.anchor.number),
        },
        { label: "Підписант", value: p.signer },
        { label: "Фаза", value: p.phase },
      ],
      resources: p.resources,
      blockers: p.blockers,
      callHex: p.prepared.callHex,
      callHash: p.prepared.callHash,
      txHash: p.signedAttempt?.signedExtrinsicHash ?? null,
      canSign: p.stage === "prepared" && !p.blockers.length,
      canSend: p.stage === "signed" && !p.blockers.length,
      canReconcile: ["unknown", "broadcast"].includes(p.stage),
      canDiscard: ["prepared", "failed", "stale", "finalized"].includes(
        p.stage,
      ),
      ...(p.receipt
        ? { evidence: json(p.receipt) as unknown as Record<string, unknown> }
        : {}),
    };
  }
  async dispatch(command: AppCommand): Promise<CommandResult | void> {
    if (command.type === "dismiss-notice") {
      this.state = { ...this.state, notice: null };
      this.render();
      return;
    }
    if (this.commandRunning)
      throw new Error("Дочекайтеся завершення поточної дії.");
    this.commandRunning = true;
    this.state = { ...this.state, busy: command.type };
    this.render();
    try {
      switch (command.type) {
        case "connect-wallet":
          await this.connectWallet();
          break;
        case "disconnect-wallet":
          this.walletUnsub.forEach((fn) => fn());
          this.wallets = [];
          this.state = {
            ...this.state,
            wallet: {
              connected: false,
              connecting: false,
              accounts: [],
              selectedAddress: null,
            },
          };
          this.invalidateReview("Гаманець відключено");
          break;
        case "select-account":
          if (
            !this.state.wallet.accounts.some(
              (a) => a.address === command.address,
            )
          )
            throw new Error("Акаунт не наданий підключеним гаманцем");
          this.state = {
            ...this.state,
            wallet: { ...this.state.wallet, selectedAddress: command.address },
          };
          this.invalidateReview("Змінено підписанта; потрібен новий перегляд");
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
        case "select-workspace":
          if (!this.workspaces.some((w) => w.id === command.id))
            throw new Error("Невідомий простір");
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
    const w = object(input);
    if (
      typeof w["id"] !== "string" ||
      typeof w["name"] !== "string" ||
      !["LOCAL", "DEMO", "LIVE"].includes(String(w["mode"]))
    )
      throw new Error("Invalid workspace metadata");
    const value = w as unknown as WorkspaceRecord;
    value.continuityCertificate = null;
    account(value.M0.account);
    account(value.M1.account);
    Object.values(value.participants).forEach(account);
    if (value.baseline) {
      for (const name of [
        "free",
        "reserved",
        "frozen",
        "proxyDeposit",
      ] as const)
        value.baseline.account[name] = BigInt(value.baseline.account[name]);
    }
    return value;
  }
  private async connectWallet() {
    this.state = {
      ...this.state,
      wallet: { ...this.state.wallet, connecting: true },
    };
    this.render();
    try {
      this.walletUnsub.forEach((fn) => fn());
      this.wallets = await connectWallets();
      const accounts = this.wallets.flatMap((s) => s.accounts);
      this.state = {
        ...this.state,
        wallet: {
          connected: true,
          connecting: false,
          accounts,
          selectedAddress: null,
        },
      };
      for (const session of this.wallets)
        this.walletUnsub.push(
          await session.subscribe((items) => {
            session.accounts = items;
            const accounts = this.wallets.flatMap((s) => s.accounts);
            const selected = this.state.wallet.selectedAddress;
            this.state = {
              ...this.state,
              wallet: {
                ...this.state.wallet,
                accounts,
                selectedAddress: accounts.some((a) => a.address === selected)
                  ? selected
                  : null,
              },
            };
            this.invalidateReview("Перелік акаунтів змінився");
            this.render();
          }),
        );
      this.notify(
        "Гаманець підключено. Виберіть особистий акаунт.",
        "positive",
      );
    } finally {
      this.state = {
        ...this.state,
        wallet: { ...this.state.wallet, connecting: false },
      };
    }
  }
  private async descriptor(): Promise<LocalDescriptor | null> {
    if (this.state.network.mode !== "LOCAL") return null;
    const response = await fetch("/local-run.json", { cache: "no-store" });
    if (!response.ok)
      throw new Error(
        "LOCAL manifest відсутній. Запустіть local:plan та local:up.",
      );
    const data = object(await response.json());
    if (
      data["mode"] !== "LOCAL" ||
      typeof data["runId"] !== "string" ||
      !Number.isSafeInteger(data["generation"])
    )
      throw new Error("Некоректний LOCAL manifest");
    return data as unknown as LocalDescriptor;
  }
  private async connectNetwork(mode: RuntimeMode, endpoint: string) {
    this.generation++;
    this.invalidateReview("Мережу змінено");
    if (this.connection) await this.connection.close();
    this.connection = null;
    this.chain = null;
    this.state = {
      ...this.state,
      network: {
        mode,
        name: mode === "LOCAL" ? "Account Handoff LOCAL" : `PortalDot ${mode}`,
        endpoint,
        connected: false,
        checking: true,
        readiness: [],
      },
    };
    this.render();
    try {
      this.connection = await NativeConnection.connect(endpoint, mode);
      await this.refresh();
    } catch (error) {
      this.state = {
        ...this.state,
        network: {
          ...this.state.network,
          checking: false,
          error: errorText(error),
        },
      };
      throw error;
    }
  }
  private async profile(
    f: NativeFingerprint,
    d: LocalDescriptor | null,
  ): Promise<ChainProfile> {
    const key = canonicalJson({
      mode: this.state.network.mode,
      genesis: f.genesis,
      metadata: f.metadataSha256,
      runtimeCode: f.runtimeCodeHash,
      decimals: f.tokenDecimals,
      symbol: f.tokenSymbol,
      ss58Prefix: f.ss58Prefix,
      run: d?.runId ?? null,
      generation: d?.generation ?? null,
      qualified: d?.qualified ?? false,
      buildHash: d?.buildHash ?? null,
      source: d?.sourceCommit ?? null,
      contract: d?.contract ?? null,
      capabilities: d?.capabilities ?? null,
      generatedNativeTypesSha256: d?.generatedNativeTypesSha256 ?? null,
    });
    const existing = this.profiles.get(key);
    if (existing) return existing;
    const qualified = await buildLocalQualification({
      descriptor: d,
      fingerprint: f,
    });
    const profileId = `${this.state.network.mode.toLowerCase()}-${await sha256(key)}`;
    const result = await createChainProfile({
      profileId,
      recordId: `profile-${await sha256(key)}`,
      fingerprint: {
        ...f,
        specVersion: String(f.specVersion),
        transactionVersion: String(f.transactionVersion),
        metadataVersion: String(f.metadataVersion),
      },
      ...qualified,
    });
    this.profiles.set(key, result);
    return result;
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
      if (
        d &&
        d.nativeRpc !== connection.endpoint &&
        new URL(d.nativeRpc).toString() !== connection.endpoint
      )
        throw new Error("LOCAL endpoint не відповідає активному manifest");
      const profile = await this.profile(f, d);
      const w = this.workspace();
      const addresses = new Set<string>(
        this.state.wallet.accounts.map((a) => a.address),
      );
      if (w) {
        Object.values(w.participants).forEach((a) => addresses.add(a));
        addresses.add(w.M0.account);
        addresses.add(w.M1.account);
        if (w.pure) addresses.add(w.pure);
      }
      const entries = await Promise.all(
        [...addresses].map(
          async (address) =>
            [
              address,
              await connection.readAccount(address, f.anchor.hash),
            ] as const,
        ),
      );
      const accounts = Object.fromEntries(entries);
      let grant = null;
      if (
        w?.contract &&
        w.grantId !== null &&
        w.pure &&
        accounts[w.pure]?.mappedTo === w.pure
      )
        grant = await readGrant(
          connection,
          w.pure,
          w.contract,
          BigInt(w.grantId),
          f.anchor.hash,
        );
      this.grantHistory = null;
      if (w?.contract && w.grantId !== null && w.creationBlock !== undefined) {
        this.grantHistory = await scanGrantHistory(connection, {
          contract: w.contract,
          grantId: w.grantId,
          fromBlock: w.creationBlock,
          toBlock: f.anchor.number,
        });
        const release = this.grantHistory.firstVestingRelease;
        if (!w.baseline && release && w.pure && this.grantHistory.complete) {
          w.baseline = {
            account: await connection.readAccount(w.pure, release.blockHash),
            grant: await readGrant(
              connection,
              w.pure,
              w.contract,
              BigInt(w.grantId),
              release.blockHash,
            ),
            blockHash: release.blockHash,
            creatorReserved: String(
              (await connection.readAccount(w.M0.account, release.blockHash))
                .reserved,
            ),
          };
          await this.save();
        }
      }
      if (generation !== this.generation) return;
      this.chain = {
        fingerprint: f,
        accounts,
        grant,
        profile,
        localDescriptor: d,
      };
      this.state = {
        ...this.state,
        network: {
          ...this.state.network,
          connected: true,
          checking: false,
          genesis: f.genesis,
          blockHash: f.anchor.hash,
          blockNumber: String(f.anchor.number),
          runtimeVersion: `${f.specName} / ${f.specVersion}`,
          runId: d?.runId ?? null,
          updatedAt: new Date().toISOString(),
          error: null,
          readiness: [
            {
              id: "native",
              label: "Native RPC",
              status: "ready",
              detail: `Фіналізований блок ${f.anchor.number}`,
            },
            {
              id: "profile",
              label: "Профіль runtime",
              status: profile.status === "accepted" ? "ready" : "blocked",
              detail:
                profile.status === "accepted"
                  ? "Код, метадані та згенеровані типи відповідають кваліфікованому LOCAL build."
                  : "Потрібні local:qualify та згенеровані native-типи.",
            },
            {
              id: "wallet",
              label: "Гаманець",
              status: this.state.wallet.connected ? "ready" : "blocked",
              detail: "Підписант обирається окремо від мережі.",
            },
          ],
        },
      };
      if (w) {
        await this.journal?.close();
        this.journal = await openJournal(
          `account-handoff:${w.mode.toLowerCase()}:${f.genesis}:${d?.runId ?? "network"}:${w.id}`,
        );
        await this.journal.appendRecord(profile);
        if (!this.pending)
          this.recovery =
            (await this.journal.getPreference<Recovery | null>("recovery")) ??
            null;
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
  private async createWorkspace(input: WorkspaceInput) {
    if (!this.chain) throw new Error("Спочатку підключіть мережу.");
    const old = input.oldMembers.map(account);
    const next = input.newMembers.map(account);
    const shared = old.filter((a) => next.includes(a));
    if (
      input.threshold !== 2 ||
      shared.length !== 2 ||
      old.length !== 3 ||
      next.length !== 3
    )
      throw new Error("Потрібні дві групи 2-з-3 зі спільними A/B та новим D.");
    const codec = {
      deriveMultisig: (members: readonly string[], threshold: number) =>
        u8aToHex(createKeyMulti([...members], threshold)),
    };
    const M0 = makeController(old, 2, "M0", codec);
    const M1 = makeController(next, 2, "M1", codec);
    if (input.reviewers.length !== 2)
      throw new Error("Потрібні два окремі рецензенти.");
    const reviewers = input.reviewers.map(account);
    if (new Set(reviewers).size !== 2)
      throw new Error("Рецензенти мають бути різними.");
    const w: WorkspaceRecord = {
      id: id(),
      name: input.name.trim() || "Новий простір",
      createdAt: new Date().toISOString(),
      mode: this.state.network.mode,
      genesis: this.chain.fingerprint.genesis,
      M0,
      M1,
      participants: {
        A: shared[0]!,
        B: shared[1]!,
        C: old.find((a) => !next.includes(a))!,
        D: next.find((a) => !old.includes(a))!,
        F: account(input.funder),
        R1: reviewers[0]!,
        R2: reviewers[1]!,
        S: this.selected()?.address ?? shared[0]!,
      },
      pure: input.beneficiary ? account(input.beneficiary) : null,
      contract: input.contract ? hex(input.contract, 20) : null,
      grantId: input.grantId ?? null,
      creationEvidence: [],
      history: [],
      baseline: null,
    };
    this.workspaces.push(w);
    this.currentId = w.id;
    this.pending = null;
    await this.save();
    await this.refresh();
    this.notify(
      "Простір збережено. Права й стан перевіряються через native RPC.",
      "positive",
    );
  }
  private async parameters(
    actionId: Intent["operationId"],
    fields: Record<string, string>,
    w: WorkspaceRecord,
    signer: string,
  ): Promise<{
    parameters: Record<string, DataValue>;
    resources: ResourceBounds;
    abi: Hex | null;
  }> {
    if (!this.chain || !this.connection) throw new Error("Мережа недоступна");
    const p: Record<string, DataValue> = {};
    let value = 0n;
    let abi: Hex | null = null;
    const requirePure = () => {
      if (!w.pure) throw new Error("Спочатку створіть і перевірте Pure");
      return w.pure;
    };
    const role = (name: string, allowed: string[]) => {
      const r = fields[name];
      if (!r || !allowed.includes(r)) throw new Error("Оберіть допустиму роль");
      return r as keyof WorkspaceRecord["participants"];
    };
    switch (actionId) {
      case "GRC-SETUP-FUND-M0":
        value = parseUnits(
          fields["amount"] ?? "",
          this.chain.fingerprint.tokenDecimals,
        );
        Object.assign(p, {
          recipient: w.M0.account,
          valueNative: String(value),
        });
        break;
      case "GRC-SETUP-FUND-ACTOR": {
        const r = role("recipientRole", ["A", "B", "D", "F", "R1", "R2"]);
        value = parseUnits(
          fields["amount"] ?? "",
          this.chain.fingerprint.tokenDecimals,
        );
        Object.assign(p, {
          recipientRole: r,
          recipient: w.participants[r],
          valueNative: String(value),
        });
        break;
      }
      case "GRC-SETUP-CREATE-PURE":
        Object.assign(p, {
          pureIndex: fields["pureIndex"] ?? "0",
          proxyType: "Any",
          delay: "0",
        });
        break;
      case "GRC-SETUP-FUND-P":
        value = parseUnits(
          fields["amount"] ?? "",
          this.chain.fingerprint.tokenDecimals,
        );
        Object.assign(p, { pure: requirePure(), valueNative: String(value) });
        break;
      case "GRC-SETUP-MAP-P":
        p["pure"] = requirePure();
        break;
      case "GRC-SETUP-MAP-ACTOR": {
        const r = role("actorRole", ["F", "R1", "R2"]);
        Object.assign(p, { actorRole: r, account: w.participants[r] });
        break;
      }
      case "GRC-ROTATION-ADD-M1":
      case "GRC-ROTATION-REMOVE-M0":
        Object.assign(p, {
          pure: requirePure(),
          oldController: w.M0.account,
          newController: w.M1.account,
          proxyType: "Any",
          delay: "0",
        });
        break;
      case "GRC-GRANT-CREATE": {
        const contract = hex(fields["contract"] ?? w.contract ?? "", 20);
        if (
          this.chain.localDescriptor?.contract?.address.toLowerCase() !==
          contract
        )
          throw new Error(
            "Контракт має відповідати перевіреному локальному deployment.",
          );
        const first = parseUnits(
          fields["firstAmount"] ?? "",
          this.chain.fingerprint.tokenDecimals,
        );
        const second = parseUnits(
          fields["secondAmount"] ?? "",
          this.chain.fingerprint.tokenDecimals,
        );
        value = first + second;
        const days = BigInt(fields["deadlineDays"] ?? "7");
        if (days < 1n || days > 365n)
          throw new Error("Строк має становити 1–365 днів");
        const deadline =
          (await this.connection.currentBlockTime()) / 1000n + days * 86400n;
        const vesting = Number(fields["vestingBlocks"]);
        if (
          !Number.isSafeInteger(vesting) ||
          vesting < 1 ||
          vesting > 0xffffffff
        )
          throw new Error("Некоректна тривалість vesting");
        const milestones = [
          {
            amount: String(first * 10000n),
            deadline: String(deadline),
            vestingBlocks: String(vesting),
            metricTarget: ZERO_ADDRESS,
            metricSelector: "0x00000000",
            metricMin: "0",
          },
          {
            amount: String(second * 10000n),
            deadline: String(deadline),
            vestingBlocks: "0",
            metricTarget: ZERO_ADDRESS,
            metricSelector: "0x00000000",
            metricMin: "0",
          },
        ];
        Object.assign(p, {
          contract,
          granteeH160: contractAddress(requirePure()),
          token: ZERO_ADDRESS,
          reviewers: [
            contractAddress(w.participants.R1),
            contractAddress(w.participants.R2),
          ],
          threshold: "2",
          milestones,
        });
        abi = encodeCreateGrant(
          contractAddress(requirePure()),
          [
            contractAddress(w.participants.R1),
            contractAddress(w.participants.R2),
          ],
          milestones.map((m) => ({
            ...m,
            amount: BigInt(m.amount),
            deadline: BigInt(m.deadline),
            vestingBlocks: Number(m.vestingBlocks),
            metricTarget: hex(m.metricTarget, 20),
            metricSelector: hex(m.metricSelector, 4),
            metricMin: 0n,
          })),
        );
        break;
      }
      case "GRC-GRANT-SUBMIT-M0":
      case "GRC-GRANT-SUBMIT-M1": {
        if (!w.contract || w.grantId === null)
          throw new Error("Немає перевіреного гранту");
        const index = actionId.endsWith("M0") ? "0" : "1";
        Object.assign(p, {
          contract: w.contract,
          grantId: w.grantId,
          index,
          evidence: fields["evidence"] ?? "",
        });
        abi = encodeSubmission(
          BigInt(w.grantId),
          Number(index),
          String(p["evidence"]),
        );
        break;
      }
      case "GRC-GRANT-APPROVE":
        if (!w.contract || w.grantId === null)
          throw new Error("Грант відсутній");
        Object.assign(p, {
          contract: w.contract,
          grantId: w.grantId,
          index: fields["index"] ?? "0",
        });
        abi = encodeApproval(BigInt(w.grantId), Number(p["index"]));
        break;
      case "GRC-VESTING-VEST-OTHER":
        p["targetPure"] = requirePure();
        break;
      case "GRC-MULTISIG-CANCEL": {
        const target = fields["targetController"] === "M1" ? w.M1 : w.M0;
        const hash = hex(fields["callHash"] ?? "", 32);
        const proposal = await this.connection.proposal(target.account, hash);
        if (!proposal || proposal.depositor !== signer)
          throw new Error(
            "Скасування доступне лише фактичному depositor чинної пропозиції.",
          );
        Object.assign(p, {
          targetController: target,
          targetCallHash: hash,
          targetTimepoint: {
            height: String(proposal.when.height),
            index: String(proposal.when.index),
            clockDomain: "native-block-number",
          },
          originalDepositor: signer,
          targetEnvelopeDigest: null,
          originalTargetCallBytes: null,
        });
        break;
      }
    }
    const resources: ResourceBounds = {
      valueNative: String(value),
      reviveWeight: null,
      storageDepositLimitNative: null,
      multisigInnerMaxWeight: null,
      outerFeeEstimateNative: null,
      outerFeeLocalBudgetNative: null,
      feeBudgetIsChainEnforcedCap: false,
      estimationEvidence: [],
    };
    if (abi) {
      const origin =
        actionId === "GRC-GRANT-CREATE"
          ? w.participants.F
          : actionId === "GRC-GRANT-APPROVE"
            ? signer
            : requirePure();
      const dest = hex(String(p["contract"]), 20);
      const estimate = await this.connection.estimateContract(
        origin,
        dest,
        value,
        abi,
      );
      resources.reviveWeight = {
        refTime: String(estimate.weight.refTime),
        proofSize: String(estimate.weight.proofSize),
      };
      resources.storageDepositLimitNative = String(
        estimate.storage + 10n ** BigInt(this.chain.fingerprint.tokenDecimals),
      );
    }
    return { parameters: p, resources, abi };
  }
  private async prepare(actionId: string, fields: Record<string, string>) {
    const selected = this.selected();
    if (!selected || !this.connection || !this.chain || !this.journal)
      throw new Error("Підключіть мережу, простір і виберіть підписанта.");
    if (this.recovery || (this.pending && !terminal.has(this.pending.stage)))
      throw new Error("Спочатку завершіть або звірте поточну операцію.");
    await this.refresh();
    const w = this.workspace()!;
    const chain = this.chain!;
    const connection = this.connection;
    if (chain.profile.status !== "accepted")
      throw new Error(
        "Потрібний кваліфікований LOCAL build із точними native-типами.",
      );
    const view = actionViews(w, chain, selected.address).find(
      (a) => a.id === actionId,
    );
    if (!view?.enabled)
      throw new Error(view?.blockers.join("; ") ?? "Операція недоступна");
    if (!(OPERATION_IDS as readonly string[]).includes(actionId))
      throw new Error("Непідтримувана операція");
    const operationId = actionId as Intent["operationId"];
    const { parameters, resources, abi } = await this.parameters(
      operationId,
      fields,
      w,
      selected.address,
    );
    const anchor = buildReadAnchor(chain.profile, chain.fingerprint);
    const inventory = w.pure ? (chain.accounts[w.pure]?.proxies ?? []) : [];
    const unsupported = inventory.filter(
      (p) => p.proxyType !== "Any" || p.delay !== 0,
    );
    const tuples = inventory
      .filter((p) => p.proxyType === "Any" && p.delay === 0)
      .map((p) => ({
        delegate: p.delegate,
        proxyType: "Any" as const,
        delay: "0" as const,
      }));
    const authority = unsupported.length
      ? "UnexpectedSet"
      : w.pure
        ? classifyAuthority(tuples, w.M0.account, w.M1.account)
        : "NotCreated";
    if (
      authority === "UnexpectedSet" &&
      ![
        "GRC-MULTISIG-CANCEL",
        "GRC-SETUP-FUND-M0",
        "GRC-SETUP-FUND-ACTOR",
        "GRC-SETUP-FUND-P",
      ].includes(actionId)
    )
      throw new Error(
        "Є неочікувані повноваження Pure. Звірте повний склад делегатів.",
      );
    if (
      operationId.startsWith("GRC-GRANT-") &&
      operationId !== "GRC-GRANT-CREATE" &&
      (!this.grantHistory?.complete ||
        this.grantHistory.scope !== "EligibleSingleRound")
    )
      throw new Error("Потрібна повна історія початкового раунду гранту.");
    const scope: GrantFlowScope = {
      policyId: "vestry-single-round-demo-v1",
      status: this.grantHistory?.scope ?? "Unverified",
      grantId: w.grantId,
      observedRounds: this.grantHistory?.rounds.map(String) ?? [],
      historyComplete: this.grantHistory?.complete ?? false,
      blockingReasons: this.grantHistory?.blockers ?? [],
      causalEvidence: [],
      reconciliationDigest: null,
      futureExternalActionsPrevented: false,
    };
    const snapshot = await createSnapshot({
      profile: chain.profile,
      anchor,
      pure: w.pure,
      authority: {
        state: authority,
        fullInventoryObserved: !!w.pure,
        tuples,
        unsupportedTuplesRaw: unsupported.map((p) => ({
          delegate: p.delegate,
          proxyType: p.proxyType,
          delay: String(p.delay),
        })),
        evidence: [],
      },
      grantScope: scope,
    });
    await this.journal!.appendRecord(snapshot);
    let grantContext: GrantContext | null = null;
    if (
      operationId.startsWith("GRC-GRANT-") &&
      operationId !== "GRC-GRANT-CREATE"
    ) {
      const index = String(parameters["index"]);
      const milestone = chain.grant?.milestones[Number(index)];
      if (!milestone || !w.grantId || !["0", "1"].includes(index))
        throw new Error("Немає актуального контексту етапу гранту");
      grantContext = {
        grantId: w.grantId,
        milestoneIndex: index as "0" | "1",
        observedRound: String(milestone.round),
        reviewedExpectedRound: "0",
        roundBinding: "client_review_only_not_ABI_enforced",
        observedMilestoneState: (
          ["Open", "Submitted", "Released", "Reclaimed"] as const
        )[milestone.state]!,
        deadlineUnixSeconds: String(milestone.deadline),
        evidenceSha256:
          typeof parameters["evidence"] === "string"
            ? await sha256(parameters["evidence"])
            : null,
        scopeStatus: scope.status,
        historyComplete: scope.historyComplete,
        evidence: [],
      };
    }
    const intent: Intent = {
      intentId: id(),
      intentRevision: "1",
      operationId,
      profileId: chain.profile.profileId,
      profileDigest: chain.profile.digest,
      authorActor: selected.address,
      parameters,
      expectedState: {
        snapshotDigest: snapshot.digest,
        authority:
          authority === "UnexpectedSet" || authority === "Unknown"
            ? "NotApplicable"
            : authority,
        grantContext,
        localReviewExpiresAtUnixSeconds: String(
          Math.floor(Date.now() / 1000) + 300,
        ),
        localExpiryRevokesNativeProposal: false,
      },
      supersedesIntentId: null,
    };
    const participants = {
      ...w.participants,
      S: [
        "GRC-SETUP-FUND-M0",
        "GRC-SETUP-FUND-ACTOR",
        "GRC-SETUP-FUND-P",
        "GRC-VESTING-VEST-OTHER",
      ].includes(actionId)
        ? selected.address
        : w.participants.S,
    };
    const plan = planOperation(intent, {
      participants,
      M0: w.M0,
      M1: w.M1,
      pure: w.pure,
      resources,
      sourceEvidence: chain.profile.sourceEvidence,
      encodeAbi: () => {
        if (!abi) throw new Error("ABI leaf is unavailable");
        return abi;
      },
      ...(w.pure ? { mappedPure: contractAddress(w.pure) } : {}),
      nativeToAbiRatio: 10000n,
    });
    let innerAction = nativeActionFromTree(plan.callTree);
    let innerTx = connection.transaction(innerAction);
    let innerHash = blake2AsHex(innerTx.callHex);
    const oldEnvelopes = (await this.journal!.listRecords(
      "FrozenEnvelope",
    )) as FrozenEnvelope[];
    let envelope: FrozenEnvelope | null = null;
    for (const old of oldEnvelopes) {
      if (
        old.intent.operationId !== operationId ||
        !old.controller ||
        !old.innerRuntimeCallHash
      )
        continue;
      const proposal = await connection.proposal(
        old.controller.account,
        hex(old.innerRuntimeCallHash, 32),
      );
      if (proposal) {
        if (old.intent.profileDigest !== chain.profile.digest)
          throw new Error("Чинна пропозиція належить іншому профілю runtime.");
        if (canonicalJson(old.intent.parameters) !== canonicalJson(parameters))
          throw new Error(
            "Чинна multisig-пропозиція має інший зміст. Звірте або скасуйте її перед новою.",
          );
        envelope = old;
        innerAction = nativeActionFromTree(old.callTree);
        innerTx = connection.transaction(innerAction);
        innerHash = hex(old.innerRuntimeCallHash, 32);
        break;
      }
    }
    let action = innerAction;
    let phase: PendingOperation["phase"] =
      operationId === "GRC-MULTISIG-CANCEL" ? "cancel" : "direct";
    let proposalDigest: string | null = null;
    if (plan.controller) {
      const proposal = await connection.proposal(
        plan.controller.account,
        innerHash,
      );
      const expected = proposal
        ? plan.requiredSigners[1]
        : plan.requiredSigners[0];
      if (selected.address !== expected)
        throw new Error(
          proposal
            ? "Завершальну дію має виконати другий визначений підписант."
            : "Першу дію має виконати визначений перший підписант.",
        );
      if (proposal) {
        if (
          proposal.depositor !== plan.requiredSigners[0] ||
          proposal.approvals.length !== 1 ||
          proposal.approvals[0] !== plan.requiredSigners[0]
        )
          throw new Error(
            "Пропозиція не підтверджує очікуване перше схвалення A.",
          );
        const record: NativeProposal = await sealRecord({
          schemaVersion: "2" as const,
          recordId: id(),
          digest: "",
          kind: "NativeProposal" as const,
          profileId: chain.profile.profileId,
          multisig: plan.controller.account,
          innerCallHash: innerHash,
          state: "present" as const,
          timepoint: {
            height: String(proposal.when.height),
            index: String(proposal.when.index),
            clockDomain: "native-block-number",
          },
          depositor: proposal.depositor,
          approvals: proposal.approvals,
          depositNative: String(proposal.deposit),
          anchor,
          evidence: [
            {
              kind: "native_chain" as const,
              locator: `${anchor.blockHash}:multisig:${plan.controller.account}:${innerHash}`,
              sourceId: null,
              contentSha256: await sha256(canonicalJson(json(proposal))),
            },
          ],
          derivedFromRecordDigest: null,
          profileDigest: chain.profile.digest,
          localContractRevision: "grc-v2-local-1" as const,
        });
        await this.journal!.appendRecord(record);
        proposalDigest = record.digest;
      }
      const amount = envelope?.resources.multisigInnerMaxWeight ?? null;
      const estimate = amount
        ? {
            refTime: BigInt(amount.refTime),
            proofSize: BigInt(amount.proofSize),
          }
        : await connection.dispatchWeight(innerTx);
      const limit = {
        refTime: estimate.refTime + 1n,
        proofSize: estimate.proofSize + 1n,
      };
      resources.multisigInnerMaxWeight = {
        refTime: String(limit.refTime),
        proofSize: String(limit.proofSize),
      };
      action = {
        kind: "multisig",
        threshold: 2,
        others: otherSignatories(plan.controller, selected.address),
        timepoint: proposal?.when,
        inner: innerAction,
        weight: amount ? estimate : limit,
      };
      phase = proposal ? "multisig_final" : "multisig_first";
    } else if (!plan.requiredSigners.includes(selected.address))
      throw new Error("Поточний акаунт не має потрібної ролі.");
    const tx = connection.transaction(action);
    const fee = await connection
      .transaction(action)
      .paymentInfo(selected.address);
    resources.outerFeeEstimateNative = String(fee.partialFee);
    resources.outerFeeLocalBudgetNative = String(fee.partialFee * 2n);
    const signerState =
      chain.accounts[selected.address] ??
      (await connection.readAccount(selected.address));
    if (
      signerState.free - signerState.frozen <
      fee.partialFee + BigInt(resources.valueNative)
    )
      throw new Error(
        "Недостатньо доступного балансу підписанта для суми й комісії.",
      );
    if (envelope) {
      const original = envelope;
      const refreshedIntent = {
        ...original.intent,
        expectedState: {
          ...original.intent.expectedState,
          snapshotDigest: snapshot.digest,
          localReviewExpiresAtUnixSeconds:
            intent.expectedState.localReviewExpiresAtUnixSeconds,
        },
      };
      const refreshed = await createFrozenEnvelope({
        intent: refreshedIntent,
        anchor,
        plan: {
          callTree: original.callTree,
          signingPath: original.signingPath,
          controller: original.controller,
          requiredSigners: original.requiredSigners,
        },
        innerRuntimeCallBytes: original.innerRuntimeCallBytes!,
        innerRuntimeCallHash: original.innerRuntimeCallHash,
        resources: {
          ...original.resources,
          outerFeeEstimateNative: resources.outerFeeEstimateNative,
          outerFeeLocalBudgetNative: resources.outerFeeLocalBudgetNative,
        },
        summaryText: original.summaryText,
        requiredGateIds: original.requiredGateIds,
        participants: original.participants,
        evidence: original.evidence,
      });
      if (refreshed.semanticIntentDigest !== original.semanticIntentDigest)
        throw new Error("Оновлення перегляду змінило незмінний намір.");
      envelope = await sealRecord({
        ...refreshed,
        derivedFromRecordDigest: original.digest,
      });
      await this.journal!.sealEnvelope(envelope);
    } else {
      envelope = await createFrozenEnvelope({
        intent,
        anchor,
        plan,
        innerRuntimeCallBytes: innerTx.callHex,
        innerRuntimeCallHash: plan.controller ? innerHash : null,
        resources,
        summaryText: view.title,
        requiredGateIds: [
          ...OPERATION_REQUIREMENTS[operationId].requiredGateIds,
        ],
        participants,
        evidence: chain.profile.sourceEvidence,
      });
      await this.journal!.sealEnvelope(envelope);
    }
    const prepared = await connection.prepareSigning(tx, selected.address);
    const context = await buildSigningContext(
      prepared,
      `${selected.source}:${this.wallets.find((s) => s.source === selected.source)?.version ?? "unknown"}`,
      phase,
      proposalDigest,
    );
    const qualification = await completePreparationSnapshot({
      profile: chain.profile,
      snapshot,
      envelope,
      freshInput: await this.operationInputs(
        {
          envelope,
          action,
          signer: selected.address,
          phase,
          actionId: operationId,
        },
        chain.fingerprint,
      ),
      signingContext: context,
      wallet:
        this.wallets.find((session) => session.source === selected.source) ??
        null,
    });
    if (qualification.blockers.length)
      throw new Error(
        qualification.blockers.map((blocker) => blocker.message).join("; "),
      );
    await this.journal!.appendRecord(qualification.snapshot);
    const qualifiedEnvelope = await createFrozenEnvelope({
      intent: {
        ...envelope.intent,
        expectedState: {
          ...envelope.intent.expectedState,
          snapshotDigest: qualification.snapshot.digest,
        },
      },
      anchor,
      plan: {
        callTree: envelope.callTree,
        signingPath: envelope.signingPath,
        controller: envelope.controller,
        requiredSigners: envelope.requiredSigners,
      },
      innerRuntimeCallBytes: envelope.innerRuntimeCallBytes!,
      innerRuntimeCallHash: envelope.innerRuntimeCallHash,
      resources: envelope.resources,
      summaryText: envelope.summaryText,
      requiredGateIds: envelope.requiredGateIds,
      participants: envelope.participants,
      evidence: envelope.evidence,
    });
    if (
      qualifiedEnvelope.semanticIntentDigest !== envelope.semanticIntentDigest
    )
      throw new Error("Кваліфікація змінила намір операції.");
    envelope = await sealRecord({
      ...qualifiedEnvelope,
      derivedFromRecordDigest: envelope.digest,
    });
    await this.journal!.sealEnvelope(envelope);
    const lease = await this.journal!.acquireLease(
      `operation:${w.id}`,
      this.tabId,
      300000,
    );
    if (!lease) throw new Error("Операцією керує інша вкладка.");
    this.pending = {
      id: id(),
      workspaceId: w.id,
      actionId: operationId,
      fields,
      stage: "prepared",
      title: view.title,
      description: view.description,
      action,
      innerAction,
      envelope,
      prepared,
      context,
      signedAttempt: null,
      signedBytes: null,
      receipt: null,
      lease,
      blockers: [],
      signer: selected.address,
      phase,
      runScope: chain.localDescriptor
        ? `${chain.localDescriptor.runId}:${chain.localDescriptor.generation}`
        : null,
      route:
        plan.signingPath === "direct"
          ? ["Підписант", "Native runtime"]
          : [
              "Підписант",
              "Multisig",
              ...(plan.signingPath === "multisig_proxy"
                ? ["Proxy → Pure"]
                : []),
              "Native runtime",
            ],
      resources: [
        {
          label: "Сума",
          amount: `${formatUnits(BigInt(resources.valueNative), chain.fingerprint.tokenDecimals)} ${chain.fingerprint.tokenSymbol}`,
          payer: selected.address,
        },
        {
          label: "Орієнтовна комісія",
          amount: `${formatUnits(fee.partialFee, chain.fingerprint.tokenDecimals)} ${chain.fingerprint.tokenSymbol}`,
          payer: selected.address,
        },
      ],
    };
    this.recovery = null;
    this.render();
  }
  private async accounting(
    f: NativeFingerprint,
    accounts: ChainView["accounts"],
  ): Promise<AccountingLedger | undefined> {
    const w = this.workspace();
    if (!w?.pure || !w.baseline || !this.chain || !this.connection)
      return undefined;
    const pure = accounts[w.pure];
    const creator = accounts[w.M0.account];
    if (!pure || !creator) return undefined;
    const holds = liabilities(pure.holds);
    const reserves = liabilities(pure.namedReserves ?? []);
    const increment = pure.proxyDeposit - w.baseline.account.proxyDeposit;
    const backed =
      holds.reduce((sum, r) => sum + BigInt(r.amountNative), 0n) +
      reserves.reduce((sum, r) => sum + BigInt(r.amountNative), 0n) +
      increment;
    const historical =
      this.connection.api.consts.proxy.proxyDepositBase +
      this.connection.api.consts.proxy.proxyDepositFactor;
    const difference = pure.reserved - backed;
    return {
      status:
        difference === 0n && increment >= 0n && creator.reserved >= historical
          ? "reconciled"
          : "conflicted",
      pure: w.pure,
      creator: w.M0.account,
      anchor: buildReadAnchor(this.chain.profile, f),
      proxyDepositRecordedNative: String(pure.proxyDeposit),
      creatorHistoricalDepositNative: String(historical),
      creatorCurrentAggregateReservedNative: String(creator.reserved),
      pureProxyIncrementNative: String(increment < 0n ? 0n : increment),
      pureFreeNative: String(pure.free),
      pureReservedNative: String(pure.reserved),
      pureFrozenNative: String(pure.frozen),
      pureReasonHolds: holds,
      pureNamedReserves: reserves,
      pureOtherTracedReservedLiabilitiesNative: "0",
      pureBackedLiabilitiesNative: String(backed < 0n ? 0n : backed),
      unexplainedReservedDeltaNative: String(difference),
      constantSetDigest: await sha256(
        canonicalJson({
          base: String(this.connection.api.consts.proxy.proxyDepositBase),
          factor: String(this.connection.api.consts.proxy.proxyDepositFactor),
        }),
      ),
      creationProvenance: w.creationEvidence,
      adjustmentProvenance: [],
      creatorDepositAutomaticallyRefunded: false,
      totalBalanceOnHoldAddedAgain: false,
    };
  }
  private async updateCertificate() {
    const w = this.workspace(),
      c = this.chain;
    if (!w?.baseline || !w.pure || !c || !this.connection || !this.journal)
      return;
    const records = await this.journal.listRecords();
    let accounting: AccountingLedger | null = null;
    try {
      accounting = (await this.accounting(c.fingerprint, c.accounts)) ?? null;
    } catch {
      /* The current assessment reports unavailable accounting. */
    }
    const trusted = w.continuityCertificate;
    const reusable =
      !!trusted &&
      certificateMatchesWorkspace(trusted, w, c.profile) &&
      certificateReferencesPresent(trusted, records) &&
      records.some(
        (record) =>
          record.kind === "ContinuityCertificate" &&
          record.recordId === trusted.recordId &&
          record.digest === trusted.digest,
      );
    if (!reusable) {
      // Restored workspace metadata is never trusted. Reconstruct a stored proof at its own
      // historical anchor, then assess today's state independently below.
      const historical = records
        .filter(
          (
            record,
          ): record is Extract<
            typeof record,
            { kind: "ContinuityCertificate" }
          > =>
            record.kind === "ContinuityCertificate" &&
            certificateMatchesWorkspace(record, w, c.profile) &&
            certificateReferencesPresent(record, records),
        )
        .sort((a, b) =>
          Number(BigInt(b.after.blockNumber) - BigInt(a.after.blockNumber)),
        )[0];
      let verified: Awaited<ReturnType<typeof buildWorkspaceCertificate>> =
        null;
      if (
        historical &&
        (await verifyRecordDigest(historical)) &&
        w.contract &&
        w.grantId !== null &&
        w.creationBlock !== undefined
      ) {
        const f = await this.connection.fingerprint(
          hex(historical.after.blockHash, 32),
        );
        const [pure, creator, grant, history] = await Promise.all([
          this.connection.readAccount(w.pure, f.anchor.hash),
          this.connection.readAccount(w.M0.account, f.anchor.hash),
          readGrant(
            this.connection,
            w.pure,
            w.contract,
            BigInt(w.grantId),
            f.anchor.hash,
          ),
          scanGrantHistory(this.connection, {
            contract: w.contract,
            grantId: w.grantId,
            fromBlock: w.creationBlock,
            toBlock: f.anchor.number,
          }),
        ]);
        const accounts = { [w.pure]: pure, [w.M0.account]: creator };
        const ledger = await this.accounting(f, accounts);
        if (ledger)
          verified = await buildWorkspaceCertificate({
            connection: this.connection,
            workspace: w,
            profile: c.profile,
            beforeFingerprint: await this.connection.fingerprint(
              w.baseline.blockHash,
            ),
            afterFingerprint: f,
            currentAccounts: accounts,
            currentGrant: grant,
            accounting: ledger,
            history,
            records,
          });
        if (verified) {
          const content = (certificate: typeof historical) =>
            canonicalJson({ ...certificate, recordId: "", digest: "" });
          if (content(verified.certificate) === content(historical)) {
            w.continuityCertificate = historical;
            verified = null;
          }
        }
      } else if (c.grant && accounting && this.grantHistory?.complete) {
        verified = await buildWorkspaceCertificate({
          connection: this.connection,
          workspace: w,
          profile: c.profile,
          beforeFingerprint: await this.connection.fingerprint(
            w.baseline.blockHash,
          ),
          afterFingerprint: c.fingerprint,
          currentAccounts: c.accounts,
          currentGrant: c.grant,
          accounting,
          history: this.grantHistory,
          records,
        });
      }
      if (verified) {
        await this.journal.appendRecord(verified.beforeSnapshot);
        await this.journal.appendRecord(verified.afterSnapshot);
        await this.journal.appendRecord(verified.certificate);
        w.continuityCertificate = verified.certificate;
      }
      if (w.continuityCertificate) await this.save();
    }
    c.currentContinuity = assessCurrentContinuity({
      workspace: w,
      chain: c,
      accounting,
      history: this.grantHistory,
    });
  }
  private async operationInputs(
    p: Pick<
      PendingOperation,
      "envelope" | "action" | "signer" | "phase" | "actionId"
    >,
    f: NativeFingerprint,
  ): Promise<FreshOperationInput & { accounts: ChainView["accounts"] }> {
    const connection = this.connection!,
      w = this.workspace()!;
    const wanted = new Set([
      ...Object.values(w.participants),
      w.M0.account,
      w.M1.account,
      p.signer,
      ...(w.pure ? [w.pure] : []),
    ]);
    const accounts = Object.fromEntries(
      await Promise.all(
        [...wanted].map(async (address) => [
          address,
          await connection.readAccount(address, f.anchor.hash),
        ]),
      ),
    );
    const grant =
      w.contract && w.grantId !== null && w.pure
        ? await readGrant(
            connection,
            w.pure,
            w.contract,
            BigInt(w.grantId),
            f.anchor.hash,
          )
        : null;
    const history =
      w.contract && w.grantId !== null && w.creationBlock !== undefined
        ? await scanGrantHistory(connection, {
            contract: w.contract,
            grantId: w.grantId,
            fromBlock: w.creationBlock,
            toBlock: f.anchor.number,
          })
        : null;
    const target =
      p.action.kind === "cancel"
        ? String(
            p.envelope.intent.parameters["targetController"] &&
              object(p.envelope.intent.parameters["targetController"])[
                "account"
              ],
          )
        : p.envelope.controller?.account;
    const hash =
      p.action.kind === "cancel"
        ? p.action.callHash
        : p.envelope.innerRuntimeCallHash;
    const proposal =
      target && hash
        ? await connection.proposal(target, hex(hash, 32), f.anchor.hash)
        : null;
    const expected =
      p.action.kind === "multisig"
        ? p.action.timepoint
        : p.action.kind === "cancel"
          ? p.action.timepoint
          : undefined;
    const ledger = await this.accounting(f, accounts);
    const pure = w.pure ? accounts[w.pure] : null;
    const reviewer =
      p.actionId === "GRC-GRANT-APPROVE" &&
      w.contract &&
      w.grantId !== null &&
      w.pure
        ? await isGrantReviewer(
            connection,
            w.pure,
            w.contract,
            BigInt(w.grantId),
            contractAddress(p.signer),
            f.anchor.hash,
          )
        : false;
    return {
      envelope: p.envelope,
      signer: p.signer,
      phase: p.phase,
      profileDigest: this.chain!.profile.digest,
      timeUnixSeconds:
        (await connection.currentBlockTime(f.anchor.hash)) / 1000n,
      authorityTuples: pure?.proxies ?? null,
      accounts,
      grant,
      grantScope: history?.scope ?? "Unverified",
      grantHistoryComplete: history?.complete ?? false,
      proposal: proposal ? { ...proposal, callHash: hash! } : null,
      ...(expected ? { expectedProposalTimepoint: expected } : {}),
      pure: w.pure,
      mappedPure: w.pure ? contractAddress(w.pure) : null,
      M0: w.M0.account,
      M1: w.M1.account,
      existentialDepositNative:
        connection.api.consts.balances.existentialDeposit,
      proposalDepositNative:
        connection.api.consts.multisig.depositBase +
        connection.api.consts.multisig.depositFactor * 2n,
      pureCreationDepositNative:
        connection.api.consts.proxy.proxyDepositBase +
        connection.api.consts.proxy.proxyDepositFactor,
      mappingDepositNative:
        connection.api.consts.revive.depositPerItem +
        connection.api.consts.revive.depositPerByte * 52n,
      proxyIncrementNative: connection.api.consts.proxy.proxyDepositFactor,
      ...(ledger ? { accounting: ledger } : {}),
      ...(w.baseline
        ? { baselineVesting: schedules(w.baseline.account.vesting) }
        : {}),
      ...(pure ? { currentVesting: schedules(pure.vesting) } : {}),
      vestingBlockNumber: BigInt(f.anchor.number),
      reviewerAuthorized: reviewer,
      continuityVerified:
        workspaceView(w, this.chain).continuity === "continued",
    };
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
      throw new Error("Операція недоступна");
    await this.journal.assertLease(p.lease);
    const f = await connection.fingerprint();
    if (
      f.genesis !== p.prepared.fingerprint.genesis ||
      f.runtimeCodeHash !== p.prepared.fingerprint.runtimeCodeHash ||
      f.metadataSha256 !== p.prepared.fingerprint.metadataSha256
    )
      throw new Error(
        "Runtime змінився після перегляду. Потрібна нова кваліфікація.",
      );
    if (this.selected()?.address !== p.signer)
      throw new Error("Підписант змінився");
    const selected = this.selected();
    const wallet = this.wallets.find(
      (session) => session.source === selected?.source,
    );
    if (
      !wallet ||
      `${wallet.source}:${wallet.version}` !== p.context.walletBuildId
    )
      throw new Error("Гаманець або його версія змінилися після перегляду.");
    const descriptor = await this.descriptor();
    if (
      p.runScope &&
      (!descriptor?.qualified ||
        `${descriptor.runId}:${descriptor.generation}` !== p.runScope)
    )
      throw new Error("LOCAL запуск змінено або скинуто.");
    const currentProfile = await this.profile(f, descriptor);
    if (currentProfile.digest !== p.envelope.intent.profileDigest)
      throw new Error("Кваліфікація мережі змінилася після перегляду.");
    const fresh = await this.operationInputs(p, f);
    if (String(fresh.accounts[p.signer]!.nonce) !== p.context.nonce)
      throw new Error("Nonce підписанта змінився. Потрібне звіряння.");
    const blockers = validateFreshOperation(fresh);
    blockers.push(
      ...assessCurrentWallet({
        profile: currentProfile,
        envelope: p.envelope,
        signer: p.signer,
        phase: p.phase,
        signingContext: p.context,
        wallet,
      }).blockers,
    );
    const snapshot = (await this.journal.listRecords("Snapshot")).find(
      (record) =>
        record.digest === p.envelope.intent.expectedState.snapshotDigest,
    );
    if (snapshot?.kind !== "Snapshot")
      throw new Error("Відсутня контрольна точка підготовки операції.");
    blockers.push(
      ...assessPreparation(
        currentProfile,
        snapshot,
        p.envelope.requiredGateIds,
      ),
    );
    if (blockers.length)
      throw new Error(blockers.map((b) => b.message).join("; "));
    return p;
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
    const p = await this.checkPending(idValue);
    if (p.stage !== "prepared") throw new Error("Повторний підпис заборонено");
    const selected = this.selected()!;
    const wallet = this.wallets.find((s) => s.source === selected.source);
    if (!wallet) throw new Error("Гаманець відключено");
    const progress = await createLocalProgress({
      envelope: p.envelope,
      context: p.context,
      atUnixSeconds: String(Math.floor(Date.now() / 1000)),
    });
    await this.journal!.appendProgress(progress, p.lease);
    p.stage = "wallet-requested";
    await this.saveRecovery(p);
    this.render();
    try {
      const signature = await requestSignature(
        wallet,
        selected,
        p.prepared.payload,
        p.prepared.rawPayload,
      );
      await this.checkPending(idValue);
      const bytes = this.connection!.attachSignature(p.prepared, signature);
      const attempt = await createSignedAttempt({
        envelope: p.envelope,
        context: p.context,
        bytes,
        hash: blake2AsHex(bytes),
      });
      await this.journal!.recordSignedAttempt(attempt, p.lease);
      p.signedBytes = bytes;
      p.signedAttempt = attempt;
      p.stage = "signed";
      await this.saveRecovery(p);
    } catch (error) {
      const rejected =
        error instanceof WalletRejectedError ||
        error instanceof WalletGuardError;
      p.stage = rejected ? "failed" : "unknown";
      p.blockers = [errorText(error)];
      await this.journal!.appendProgress(
        await createLocalProgress({
          envelope: p.envelope,
          context: p.context,
          phase:
            error instanceof WalletRejectedError
              ? "WalletRejected"
              : error instanceof WalletGuardError
                ? "GuardRefused"
                : "WalletOutcomeUnknown",
          atUnixSeconds: String(Math.floor(Date.now() / 1000)),
        }),
      );
      if (rejected) {
        await this.journal!.setPreference("recovery", null);
        this.recovery = null;
      } else await this.saveRecovery(p);
      throw error;
    }
  }
  private async send(idValue: string) {
    const p = await this.checkPending(idValue);
    if (p.stage !== "signed" || !p.signedBytes)
      throw new Error("Потрібний перевірений збережений підпис");
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
    if (!w || !this.connection || !this.chain || !p.signedAttempt)
      throw new Error("Контекст операції втрачено");
    p.receipt = receipt;
    const evidence: EvidenceRef = {
      kind: "native_chain",
      locator: `${receipt.blockHash}/${receipt.txIndex}`,
      sourceId: receipt.txHash,
      contentSha256: await sha256(canonicalJson(receipt)),
    };
    if (receipt.businessExecuted && p.actionId === "GRC-SETUP-CREATE-PURE") {
      const created = receipt.events.find(
        (e) => e.pallet === "Proxy" && e.name === "PureCreated",
      );
      if (!created) throw new Error("Немає події створення Pure");
      w.pure = account(String(created.data["pure"]));
      w.creationEvidence = [evidence];
      w.creationBlock = receipt.blockNumber;
    }
    if (receipt.businessExecuted && p.actionId === "GRC-GRANT-CREATE") {
      w.contract = hex(String(p.envelope.intent.parameters["contract"]), 20);
      const log = this.contractEvent(receipt, w.contract, "GrantCreated");
      w.grantId = String(log["grantId"]);
    }
    await this.save();
    await this.refresh();
    const f = await this.connection.fingerprint(receipt.blockHash);
    const anchor = buildReadAnchor(this.chain!.profile, f);
    const check = await this.postconditions(p, receipt);
    let history: GrantHistory | null = null;
    if (w.contract && w.grantId !== null && w.creationBlock !== undefined)
      history = await scanGrantHistory(this.connection, {
        contract: w.contract,
        grantId: w.grantId,
        fromBlock: w.creationBlock,
        toBlock: receipt.blockNumber,
      });
    const expectedName =
      p.actionId === "GRC-GRANT-CREATE"
        ? "GrantCreated"
        : p.actionId === "GRC-GRANT-APPROVE"
          ? "MilestoneApproved"
          : "MilestoneSubmitted";
    const intended = history?.entries.find(
      (e) =>
        e.blockHash === receipt.blockHash &&
        e.txIndex === receipt.txIndex &&
        e.eventName === expectedName,
    );
    const round =
      history?.complete && intended
        ? expectedName === "GrantCreated"
          ? 0
          : intended.roundBefore
        : null;
    const bundle = await buildReceipt(
      p.envelope,
      p.signedAttempt,
      receipt,
      anchor,
      p.phase,
      {
        postconditions: check,
        ...(p.phase === "cancel"
          ? {
              targetProposalAfter:
                check.find((item) => item.id === "cancel-target")?.result ===
                "passed"
                  ? ("cancelled" as const)
                  : ("unknown" as const),
            }
          : {}),
        ...(round !== null ? { roundAtIntendedEvent: String(round) } : {}),
        orderedHistoryComplete: history?.complete ?? false,
      },
    );
    await this.journal!.appendRecord(bundle);
    const verified =
      receipt.nestedSuccess &&
      check.every((c) => c.result === "passed") &&
      bundle.businessEffect === "historically_verified";
    receipt.businessExecuted = verified && receipt.businessExecuted;
    const historyRow = {
      id: id(),
      operationId: p.actionId,
      title: p.title,
      at: new Date().toISOString(),
      signer: p.signer,
      receipt,
      envelopeDigest: p.envelope.digest,
      attemptId: p.signedAttempt.recordId,
      grantId: w.grantId,
    };
    const previous = w.history.findIndex(
      (row) => row.attemptId === p.signedAttempt!.recordId,
    );
    if (previous < 0) w.history.push(historyRow);
    else w.history[previous] = { ...historyRow, id: w.history[previous]!.id };
    p.stage =
      bundle.status === "unresolved"
        ? "unknown"
        : bundle.status === "finalized_failure"
          ? "failed"
          : "finalized";
    p.blockers = check
      .filter((c) => c.result !== "passed")
      .map((c) => c.explanation);
    if (p.stage === "unknown") {
      await this.saveRecovery(p);
    } else {
      await this.journal!.setPreference("recovery", null);
      this.recovery = null;
      await this.journal!.releaseLease(p.lease);
    }
    await this.updateCertificate();
    await this.save();
    this.render();
  }
  private contractEvent(
    receipt: NativeReceipt,
    contract: Hex,
    name: string,
  ): Record<string, unknown> {
    for (const event of receipt.events) {
      if (
        event.pallet !== "Revive" ||
        event.name !== "ContractEmitted" ||
        String(event.data["contract"]).toLowerCase() !== contract.toLowerCase()
      )
        continue;
      const topics = event.data["topics"];
      if (!Array.isArray(topics)) continue;
      try {
        const value = object(
          decodeGrantEvent(
            hex(String(event.data["data"])),
            topics.map((t) => hex(String(t), 32)),
          ),
        );
        if (value["eventName"] === name) return object(value["args"]);
      } catch {
        /* Other events remain outside this exact ABI match. */
      }
    }
    throw new Error(`Немає точної події ${name} від очікуваного контракту`);
  }
  private async postconditions(
    p: PendingOperation,
    receipt: NativeReceipt,
  ): Promise<Postcondition[]> {
    const w = this.workspace()!;
    const c = this.chain!;
    const anchor = buildReadAnchor(
      c.profile,
      await this.connection!.fingerprint(receipt.blockHash),
    );
    let ok = receipt.nestedSuccess;
    let explanation = receipt.failure ?? "Вкладені native-виклики виконано";
    if (p.phase === "multisig_first") {
      const proposal =
        p.envelope.controller && p.envelope.innerRuntimeCallHash
          ? await this.connection!.proposal(
              p.envelope.controller.account,
              hex(p.envelope.innerRuntimeCallHash, 32),
              receipt.blockHash,
            )
          : null;
      ok =
        ok &&
        !!proposal &&
        proposal.depositor === p.envelope.requiredSigners[0] &&
        proposal.approvals.includes(p.envelope.requiredSigners[0]!);
      return [
        {
          id: "approval-recorded",
          result: ok ? "passed" : "unknown",
          anchor,
          observations: [],
          explanation:
            "Перше схвалення та його поточну пропозицію звірено; внутрішня дія ще не виконана.",
        },
      ];
    }
    if (p.phase === "cancel") {
      const params = p.envelope.intent.parameters;
      const target = object(params.targetController);
      const remaining = await this.connection!.proposal(
        String(target.account),
        hex(String(params.targetCallHash), 32),
        receipt.blockHash,
      );
      const eventMatched = cancellationMatches(p.envelope, receipt);
      const unreserved = receipt.events.some((event) => {
        if (event.pallet !== "Balances" || event.name !== "Unreserved")
          return false;
        try {
          return (
            account(String(event.data["who"])) === p.signer &&
            BigInt(String(event.data["amount"])) > 0n
          );
        } catch {
          return false;
        }
      });
      const cancelled =
        receipt.nestedSuccess &&
        eventMatched &&
        remaining === null &&
        unreserved;
      return [
        {
          id: "cancel-target",
          result: cancelled
            ? "passed"
            : receipt.nestedSuccess
              ? "unknown"
              : "failed",
          anchor,
          observations: [],
          explanation: cancelled
            ? "Точну пропозицію скасовано; подія, її відсутність і повернення резерву depositor підтверджені."
            : "Подію скасування, відсутність точної пропозиції або повернення резерву не підтверджено.",
        },
      ];
    }
    const pure = w.pure
      ? await this.connection!.readAccount(w.pure, receipt.blockHash)
      : null;
    if (
      p.actionId === "GRC-ROTATION-ADD-M1" ||
      p.actionId === "GRC-ROTATION-REMOVE-M0"
    ) {
      const desired =
        p.actionId === "GRC-ROTATION-ADD-M1" ? "DualControl" : "M1Only";
      const actual = pure
        ? classifyAuthority(
            pure.proxies
              .filter((t) => t.proxyType === "Any" && t.delay === 0)
              .map((t) => ({
                delegate: t.delegate,
                proxyType: "Any" as const,
                delay: "0" as const,
              })),
            w.M0.account,
            w.M1.account,
          )
        : "Unknown";
      ok =
        ok &&
        actual === desired &&
        !!pure?.proxies.every((t) => t.proxyType === "Any" && t.delay === 0) &&
        pure.mappedTo === w.pure;
      explanation = ok
        ? "Точний склад контролерів та mapping підтверджено."
        : "Кінцеві права або mapping відрізняються від очікуваних.";
    }
    if (p.actionId === "GRC-SETUP-MAP-P")
      ok = ok && !!pure && pure.mappedTo === w.pure;
    if (p.actionId === "GRC-SETUP-MAP-ACTOR") {
      const who = String(p.envelope.intent.parameters["account"]);
      ok =
        ok &&
        (await this.connection!.readAccount(who, receipt.blockHash))
          .mappedTo === who;
    }
    const result: Postcondition[] = [
      {
        id: "operation-poststate",
        result: ok ? "passed" : "failed",
        anchor,
        observations: [],
        explanation,
      },
    ];
    if (
      [
        "GRC-ROTATION-ADD-M1",
        "GRC-ROTATION-REMOVE-M0",
        "GRC-GRANT-SUBMIT-M1",
      ].includes(p.actionId)
    ) {
      if (!pure || !w.baseline || !w.contract || w.grantId === null) {
        result.push({
          id: "continuity-evidence",
          result: "unknown",
          anchor,
          observations: [],
          explanation: "Початкові докази неповні.",
        });
        return result;
      }
      const f = await this.connection!.fingerprint(receipt.blockHash);
      const creator = await this.connection!.readAccount(
        w.M0.account,
        receipt.blockHash,
      );
      const ledger = await this.accounting(f, {
        [w.pure!]: pure,
        [w.M0.account]: creator,
      });
      const backing =
        ledger?.status === "reconciled" &&
        ledger.unexplainedReservedDeltaNative === "0";
      const vesting =
        hasPreservedSchedule(
          schedules(w.baseline.account.vesting),
          schedules(pure.vesting),
        ) &&
        schedules(w.baseline.account.vesting).some(
          (s) => vestingRemaining(s, BigInt(receipt.blockNumber)) > 0n,
        );
      const grant = await readGrant(
        this.connection!,
        w.pure!,
        w.contract,
        BigInt(w.grantId),
        receipt.blockHash,
      );
      const binding =
        grant.grantee === contractAddress(w.pure!) &&
        grant.grantee === w.baseline.grant.grantee &&
        grant.funder === w.baseline.grant.funder;
      result.push(
        {
          id: "reserve-backing",
          result: backing ? "passed" : "failed",
          anchor,
          observations: [],
          explanation:
            "Резерви, mapping hold і резерв творця мають узгоджуватись.",
        },
        {
          id: "vesting-provenance",
          result: vesting ? "passed" : "failed",
          anchor,
          observations: [],
          explanation:
            "Початковий активний vesting schedule та кратність збережені.",
        },
        {
          id: "grant-beneficiary",
          result: binding ? "passed" : "failed",
          anchor,
          observations: [],
          explanation: "Бенефіціар, фонд і той самий грант збережені.",
        },
      );
    }
    return result;
  }
  private async reconcile(idValue: string) {
    if (!this.connection || !this.journal)
      throw new Error("Підключіть ту саму мережу.");
    const p = this.pending;
    if (p?.id === idValue && p.signedAttempt) {
      if (
        !this.chain ||
        this.workspace()?.id !== p.workspaceId ||
        p.envelope.intent.profileDigest !== this.chain.profile.digest
      )
        throw new Error(
          "Потрібен початковий простір та точний профіль runtime.",
        );
      const receipt = await this.connection.findReceipt(
        hex(p.signedAttempt.signedExtrinsicHash, 32),
      );
      if (!receipt)
        throw new Error(
          "Спробу не знайдено в доступній фіналізованій історії. Автоматичного повтору не буде.",
        );
      await this.finish(p, receipt);
      return;
    }
    const r = this.recovery;
    if (!r || r.id !== idValue)
      throw new Error(
        "Відповідь гаманця невідома; точні підписані байти не були збережені. Потрібне ручне звіряння.",
      );
    const envelope = await this.journal.getRecord(r.envelopeId);
    if (
      envelope?.kind !== "FrozenEnvelope" ||
      !this.chain ||
      this.workspace()?.id !== r.workspaceId ||
      envelope.intent.profileDigest !== this.chain.profile.digest
    )
      throw new Error("Потрібен початковий простір та точний профіль runtime.");
    let attempt = r.attemptId
      ? await this.journal.getRecord(r.attemptId)
      : undefined;
    if (!r.attemptId) {
      const accepted = (
        await this.journal.listProgress(r.context.requestId)
      ).filter(
        (progress) =>
          progress.phase === "SignedAttemptRecorded" &&
          progress.envelopeDigest === envelope.digest &&
          canonicalJson(progress.reviewedSigningContext) ===
            canonicalJson(r.context),
      );
      const ids = [
        ...new Set(
          accepted
            .map((progress) => progress.acceptedSignedAttemptId)
            .filter((value): value is string => value !== null),
        ),
      ];
      if (ids.length === 1) attempt = await this.journal.getRecord(ids[0]!);
    }
    if (
      attempt?.kind !== "SignedAttempt" ||
      attempt.recordScope !== "local_journal" ||
      !attempt.signedExtrinsicBytes
    )
      throw new Error(
        "Точні підписані байти не були збережені. Потрібне ручне звіряння.",
      );
    if (
      envelope?.kind !== "FrozenEnvelope" ||
      envelope.digest !== attempt.envelopeDigest ||
      canonicalJson(attempt.reviewedSigningContext) !== canonicalJson(r.context)
    )
      throw new Error(
        "Збережений контекст підпису не узгоджується зі спробою.",
      );
    const resumeSigned = r.stage === "signed";
    const receipt = resumeSigned
      ? null
      : await this.connection.findReceipt(hex(attempt.signedExtrinsicHash, 32));
    if (!receipt && !resumeSigned)
      throw new Error(
        "Точну транзакцію не знайдено; стан залишається невідомим.",
      );
    const payload = JSON.parse(r.context.originalSignPayloadJcsUtf8);
    const innerAction = nativeActionFromTree(envelope.callTree);
    let action = innerAction;
    if (resumeSigned) {
      if (
        blake2AsHex(hex(attempt.signedExtrinsicBytes)) !==
          attempt.signedExtrinsicHash ||
        blake2AsHex(hex(r.context.outerCallBytes)) !== r.context.outerCallHash
      )
        throw new Error(
          "Збережені підписані байти або RuntimeCall мають інший хеш.",
        );
      if (envelope.controller) {
        const weight = envelope.resources.multisigInnerMaxWeight;
        if (!weight) throw new Error("Відсутня збережена межа ваги multisig.");
        let timepoint: { height: number; index: number } | undefined;
        if (r.context.operationPhase === "multisig_final") {
          const proposal = r.context.nativeProposalDigest
            ? await this.journal.getRecordByDigest(
                r.context.nativeProposalDigest,
              )
            : undefined;
          if (
            proposal?.kind !== "NativeProposal" ||
            !proposal.timepoint ||
            proposal.multisig !== envelope.controller.account ||
            proposal.innerCallHash !== envelope.innerRuntimeCallHash ||
            proposal.profileDigest !== envelope.intent.profileDigest
          )
            throw new Error(
              "Відсутній точний збережений контекст native-пропозиції.",
            );
          timepoint = {
            height: Number(proposal.timepoint.height),
            index: Number(proposal.timepoint.index),
          };
          if (
            !Number.isSafeInteger(timepoint.height) ||
            !Number.isSafeInteger(timepoint.index)
          )
            throw new Error("Некоректний timepoint збереженої пропозиції.");
        }
        action = {
          kind: "multisig",
          threshold: 2,
          others: otherSignatories(envelope.controller, r.signer),
          timepoint,
          inner: innerAction,
          weight: {
            refTime: BigInt(weight.refTime),
            proofSize: BigInt(weight.proofSize),
          },
        };
      }
      if (
        this.connection.transaction(innerAction).callHex !==
          envelope.innerRuntimeCallBytes ||
        this.connection.transaction(action).callHex !== r.context.outerCallBytes
      )
        throw new Error(
          "Поточний native-декодер не відтворює точні збережені виклики.",
        );
    }
    const lease = await this.journal.acquireLease(
      `operation:${r.workspaceId}`,
      this.tabId,
      300000,
    );
    if (!lease) throw new Error("Звірянням керує інша вкладка.");
    const recovered: PendingOperation = {
      id: r.id,
      workspaceId: r.workspaceId,
      actionId: envelope.intent.operationId,
      fields: {},
      stage: resumeSigned ? "signed" : "unknown",
      title: r.title,
      description: resumeSigned
        ? "Відновлено ті самі підписані байти. Надсилання потребує окремої явної команди."
        : "Звіряння збереженої підписаної спроби.",
      action,
      innerAction,
      envelope,
      prepared: {
        payload,
        rawPayload: hex(
          r.context.outerCallBytes +
            r.context.encodedExtraPayloadBytes.slice(2) +
            r.context.additionalSignedPayloadBytes.slice(2),
        ),
        callHex: hex(r.context.outerCallBytes),
        callHash: hex(r.context.outerCallHash, 32),
        signer: account(r.signer),
        extra: [],
        encodedExtra: hex(r.context.encodedExtraPayloadBytes),
        additionalSigned: hex(r.context.additionalSignedPayloadBytes),
        createdAt: 0,
        fingerprint: this.chain.fingerprint,
      },
      context: r.context,
      signedAttempt: attempt,
      signedBytes: attempt.signedExtrinsicBytes
        ? hex(attempt.signedExtrinsicBytes)
        : null,
      receipt: null,
      lease,
      blockers: [],
      signer: r.signer,
      phase: r.context.operationPhase,
      route: [],
      resources: [],
      runScope: this.chain.localDescriptor
        ? `${this.chain.localDescriptor.runId}:${this.chain.localDescriptor.generation}`
        : null,
    };
    this.pending = recovered;
    if (resumeSigned) {
      try {
        await this.checkPending(recovered.id);
        await this.saveRecovery(recovered);
      } catch (error) {
        this.pending = null;
        await this.journal.releaseLease(lease);
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
        throw new Error("Підключіть відповідний LOCAL перед імпортом.");
      const descriptor = this.chain.localDescriptor;
      if (!descriptor) throw new Error("Немає кваліфікованого LOCAL manifest.");
      const verified = await validateLocalWorkspaceImport(
        raw,
        this.connection,
        descriptor,
      );
      await this.createWorkspace(verified.input);
      const w = this.workspace()!;
      w.creationBlock = verified.creationBlock;
      w.creationEvidence = verified.creationEvidence;
      await this.save();
      await this.refresh();
      this.notify(
        "LOCAL-простір імпортовано, походження Pure перевірено.",
        "positive",
      );
      return;
    }
    const result = await importPortable(contents);
    if (!this.chain || !this.journal)
      throw new Error("Спочатку відкрийте відповідний простір");
    for (const record of result.records) {
      if (
        record.kind === "ChainProfile" &&
        record.genesis !== this.chain.fingerprint.genesis
      )
        throw new Error("Інша мережа в пакеті");
      if (record.kind === "FrozenEnvelope")
        await this.journal.sealEnvelope(record);
      else await this.journal.appendRecord(record);
    }
    this.notify(
      "Пакет перевірено та збережено для звіряння. Імпорт не надає дозволу підписувати.",
      "positive",
    );
  }
  private async export(): Promise<CommandResult> {
    if (!this.journal) throw new Error("Відкрийте простір");
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
