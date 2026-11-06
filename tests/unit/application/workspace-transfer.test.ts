import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteDB } from "idb";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import {
  canonicalJson,
  createFrozenEnvelope,
  createReceiptBundle,
  createSignedAttempt,
  exportPortable,
  sealRecord,
  type CanonicalRecord,
  type ChainProfile,
  type Intent,
  type ResourceBounds,
} from "@account-handoff/contracts";
import { planOperation } from "@account-handoff/domain";
import {
  NativeConnection,
  type Hex,
  type NativeAction,
  type NativeFingerprint,
  type NativeReceipt,
  type NativeTx,
} from "@account-handoff/native-adapter";
import type { Journal } from "@account-handoff/local-store";
import * as wallets from "@account-handoff/wallet-adapter";
import { Application } from "../../../apps/web/src/application/application";
import { exportWorkspacePackage } from "../../../apps/web/src/application/workspace-package";
import { createWorkspaceRecord } from "../../../apps/web/src/application/workspace-state";
import {
  buildSigningContext,
  nativeActionFromTree,
} from "../../../apps/web/src/application/record-builders";
import type {
  ChainView,
  WorkspaceRecord,
} from "../../../apps/web/src/application/models";
import type {
  AppSnapshot,
  WorkspaceInput,
} from "../../../apps/web/src/ui-contract";
import {
  account,
  DIGEST,
  evidence,
  HASH,
  profile,
  signingContext,
  snapshot,
} from "../../fixtures/core";

const browser = vi.hoisted(() => ({ namespace: "" }));
const storage = vi.hoisted(() => ({
  afterImport: null as (() => void) | null,
}));
const handles = vi.hoisted(() => [] as Journal[]);
const reads = vi.hoisted(() => ({
  workspace: vi.fn(),
  descriptor: vi.fn(),
  profile: vi.fn(),
}));
vi.mock("../../../apps/web/src/config/deployment", async (original) => {
  const actual =
    await original<typeof import("../../../apps/web/src/config/deployment")>();
  return {
    ...actual,
    deployment: {
      ...actual.deployment,
      get journalName() {
        return browser.namespace;
      },
    },
  };
});
vi.mock("@account-handoff/local-store", async (original) => {
  const actual =
    await original<typeof import("@account-handoff/local-store")>();
  return {
    ...actual,
    openJournal: async (...args: Parameters<typeof actual.openJournal>) => {
      const journal = await actual.openJournal(...args);
      const importRecords = journal.importRecords;
      journal.importRecords = async (records) => {
        await importRecords(records);
        storage.afterImport?.();
      };
      handles.push(journal);
      return journal;
    },
  };
});
vi.mock(
  "../../../apps/web/src/application/network-state",
  async (original) => ({
    ...(await original<
      typeof import("../../../apps/web/src/application/network-state")
    >()),
    readWorkspaceState: reads.workspace,
  }),
);
vi.mock("../../../apps/web/src/application/network-profile", () => ({
  readNetworkDescriptor: reads.descriptor,
  qualifiedProfile: reads.profile,
}));

const endpoint = "wss://transfer-unit.invalid/";
const fingerprint: NativeFingerprint = {
  genesis: HASH as `0x${string}`,
  specName: "synthetic",
  specVersion: 1,
  transactionVersion: 1,
  metadataVersion: 14,
  metadataHash: HASH as `0x${string}`,
  metadataSha256: DIGEST,
  rawMetadata: "0x00",
  runtimeCodeHash: HASH as `0x${string}`,
  signedExtensions: [],
  runtimeApis: {},
  anchor: { hash: HASH as `0x${string}`, number: 10 },
  tokenDecimals: 12,
  tokenSymbol: "UNIT",
  ss58Prefix: 42,
};
const input: WorkspaceInput = {
  name: "Transferred public setup",
  oldMembers: [account(1), account(2), account(3)],
  threshold: 2,
  funder: account(4),
  reviewers: [account(5), account(6)],
};
interface Access {
  metadata: Journal;
  journal: Journal | null;
  chain: ChainView | null;
  workspaces: WorkspaceRecord[];
  currentId: string | null;
  state: AppSnapshot;
  render(): void;
  stopNetworkObservers(): void;
}
const applications: Access[] = [];
function encoded(action: NativeAction): Hex {
  // Deterministic mocked codec boundary, not a claim about real SCALE bytes.
  return u8aToHex(
    new TextEncoder().encode(
      JSON.stringify(action, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ),
  );
}
function native(genesis = HASH) {
  const f = { ...fingerprint, genesis: genesis as `0x${string}` };
  const callbacks = new Map<string, Set<(...args: unknown[]) => void>>();
  const result = {
    endpoint,
    mode: "DEMO",
    api: {
      status: "connected",
      rpc: { chain_getBlockHash: vi.fn().mockResolvedValue(genesis) },
      on: vi.fn((event: string, callback: (...args: unknown[]) => void) => {
        const handlers = callbacks.get(event) ?? new Set();
        callbacks.set(event, handlers);
        handlers.add(callback);
        return () => handlers.delete(callback);
      }),
    },
    fingerprint: vi.fn().mockResolvedValue(f),
    readAccount: vi.fn(),
    transaction: vi.fn(
      (action: NativeAction) => ({ callHex: encoded(action) }) as NativeTx,
    ),
    close: vi.fn().mockResolvedValue(undefined),
    send: vi.fn(),
    emit(event: string) {
      result.api.status = event;
      for (const callback of callbacks.get(event) ?? []) callback();
    },
  };
  return result as typeof result & NativeConnection;
}
async function qualified(genesis = HASH): Promise<ChainProfile> {
  const base = await profile();
  return sealRecord({
    ...base,
    status: "accepted" as const,
    genesis,
    specName: "synthetic",
    specVersion: "1",
    transactionVersion: "1",
    runtimeCodeHash: HASH,
    metadataSha256: DIGEST,
    metadataVersion: "14",
    bindingEvidence: {
      ...base.bindingEvidence,
      rawMetadataEvidence: evidence,
      rawRuntimeCodeEvidence: evidence,
      runtimeSourceBuildRelationship: evidence,
      generatedNativeTypesSha256: DIGEST,
    },
  });
}
async function application(freshBrowser = true) {
  if (freshBrowser)
    browser.namespace = `account-handoff:fixture:transfer-${crypto.randomUUID()}`;
  const app = await Application.create();
  const access = app as unknown as Access;
  applications.push(access);
  return { app, access };
}
async function connect(app: Application, connection = native()) {
  vi.spyOn(NativeConnection, "connect").mockResolvedValue(connection);
  await app.dispatch({ type: "connect-network", mode: "DEMO", endpoint });
  return connection;
}
async function idle(app: Application) {
  await vi.waitFor(() => expect(app.getSnapshot().busy).toBeNull());
}
async function inspect(app: Application, contents: string) {
  const result = await app.dispatch({ type: "inspect-package", contents });
  if (!result?.importPreview) throw new Error("Missing import preview");
  return result.importPreview;
}
async function packageContents(): Promise<string> {
  const workspace = createWorkspaceRecord(input, "DEMO", fingerprint.genesis);
  return canonicalJson(
    await exportWorkspacePackage(workspace, [await qualified()]),
  );
}
async function activeWorkspace(app: Application, access: Access) {
  const w = createWorkspaceRecord(
    {
      ...input,
      beneficiary: account(7),
      contract: `0x${"ab".repeat(20)}`,
      grantId: "0",
    },
    "DEMO",
    fingerprint.genesis,
  );
  w.creationEvidence = [
    {
      kind: "native_chain",
      locator: `${HASH}/0`,
      sourceId: HASH,
      contentSha256: DIGEST,
    },
  ];
  w.creationBlock = 1;
  access.workspaces = [w];
  access.currentId = w.id;
  const { openJournal } = await import("@account-handoff/local-store");
  access.journal = await openJournal(
    `account-handoff:demo:${w.genesis}:network:${w.id}`,
  );
  await access.journal.appendRecord(await qualified());
  await access.metadata.setPreferences({ workspaces: [w], currentId: w.id });
  access.render();
  expect(app.getSnapshot().workspace?.id).toBe(w.id);
  return { w, journal: access.journal };
}
async function fundingHistory(
  w: WorkspaceRecord,
  amount: string,
  prefix: string,
  txHash: Hex,
  extrinsicIndex = "0",
) {
  const p = await qualified();
  const s = await sealRecord({
    ...(await snapshot(p)),
    recordId: `${prefix}:snapshot`,
  });
  const intent: Intent = {
    intentId: `${prefix}:intent`,
    intentRevision: "1",
    operationId: "GRC-SETUP-FUND-M0",
    profileId: p.profileId,
    profileDigest: p.digest,
    authorActor: w.participants.S,
    parameters: { recipient: w.M0.account, valueNative: amount },
    expectedState: {
      snapshotDigest: s.digest,
      authority: "NotApplicable",
      grantContext: null,
      localReviewExpiresAtUnixSeconds: "1000",
      localExpiryRevokesNativeProposal: false,
    },
    supersedesIntentId: null,
  };
  const resources: ResourceBounds = {
    valueNative: amount,
    reviveWeight: null,
    storageDepositLimitNative: null,
    multisigInnerMaxWeight: null,
    outerFeeEstimateNative: "1",
    outerFeeLocalBudgetNative: "2",
    feeBudgetIsChainEnforcedCap: false,
    estimationEvidence: [],
  };
  const plan = planOperation(intent, {
    participants: w.participants,
    M0: w.M0,
    M1: w.M1,
    pure: w.pure,
    resources,
    sourceEvidence: [evidence],
    encodeAbi: () => {
      throw new Error("Unexpected ABI encoding");
    },
  });
  const call = encoded(nativeActionFromTree(plan.callTree));
  const e = await createFrozenEnvelope({
    intent,
    anchor: s.anchor,
    plan,
    innerRuntimeCallBytes: call,
    innerRuntimeCallHash: null,
    resources,
    summaryText: `Transfer ${amount} synthetic units`,
    requiredGateIds: ["Q-RUNTIME"],
    participants: w.participants,
    evidence: [evidence],
  });
  const base = await signingContext(e);
  const payload = JSON.parse(base.originalSignPayloadJcsUtf8);
  Object.assign(payload, { address: w.participants.S, method: call });
  const context = await buildSigningContext(
    {
      payload,
      signer: w.participants.S as Hex,
      callHex: call,
      callHash: blake2AsHex(call),
      rawPayload: "0x00",
      encodedExtra: "0x00",
      additionalSigned: "0x",
      extra: [],
      createdAt: 10,
      fingerprint,
    },
    "synthetic-wallet",
    "direct",
  );
  const a = await createSignedAttempt({
    envelope: e,
    context,
    bytes: "0x0400",
    hash: txHash,
  });
  const r = await createReceiptBundle({
    envelope: e,
    attempt: a,
    anchor: s.anchor,
    extrinsicIndex,
    layers: [
      {
        layer: "System",
        pathOrdinal: "0",
        result: "success",
        eventIndices: [],
        error: null,
        revertBytes: null,
      },
    ],
    events: [],
    postconditions: [],
    status: "finalized_success",
    businessEffect: "historically_verified",
    operationPhase: "direct",
    causalBusinessContext: {
      assessment: "not_applicable",
      grantId: null,
      milestoneIndex: null,
      roundAtIntendedEvent: null,
      intendedEvidenceSha256: null,
      nativeEventIndex: null,
      abiLogOrdinal: null,
      orderedHistoryComplete: false,
      eventOrderEvidence: [],
    },
    evidence: [evidence],
  });
  return { p, s, e, a, r, call, records: [p, s, e, a, r] };
}
beforeEach(async () => {
  storage.afterImport = null;
  reads.workspace.mockReset().mockResolvedValue({
    accounts: {},
    grant: null,
    history: null,
    baselineChanged: false,
  });
  reads.descriptor.mockReset().mockResolvedValue(null);
  reads.profile
    .mockReset()
    .mockImplementation(
      (_mode: unknown, _cache: unknown, f: NativeFingerprint) =>
        qualified(f.genesis),
    );
});
afterEach(async () => {
  for (const access of applications.splice(0)) access.stopNetworkObservers();
  const namespaces = new Set(handles.map((journal) => journal.namespace));
  handles.splice(0).forEach((journal) => journal.close());
  for (const namespace of namespaces) await deleteDB(namespace);
  vi.restoreAllMocks();
});

describe("workspace transfer through the actual application coordinator", () => {
  it("round trips a newly configured profile-only workspace into a fresh browser, reloads and imports again without duplicates", async () => {
    const discover = vi.spyOn(wallets, "connectWallets");
    const sign = vi.spyOn(wallets, "requestSignature");
    const source = await application();
    await connect(source.app);
    await source.app.dispatch({ type: "create-workspace", input });
    const sourceWorkspace = source.access.workspaces[0]!;
    expect(await source.access.journal!.listRecords()).toHaveLength(1);
    const exported = await source.app.dispatch({ type: "export-package" });
    expect(exported?.download?.name).toBe("account-handoff-workspace.json");
    const contents = exported!.download!.contents;
    const target = await application();
    expect(target.app.getSnapshot().workspaces).toEqual([]);
    const preview = await inspect(target.app, contents);
    expect(preview).toMatchObject({
      kind: "workspace",
      name: input.name,
      recordCount: 1,
      missingFields: [],
    });
    expect(target.access.workspaces).toEqual([]);
    const connection = await connect(target.app);
    await target.app.dispatch({
      type: "import-package",
      contents,
      previewDigest: preview.digest,
    });
    await idle(target.app);
    expect(target.access.workspaces).toHaveLength(1);
    const restored = target.access.workspaces[0]!;
    expect(restored.id).not.toBe(sourceWorkspace.id);
    expect(restored).toMatchObject({
      name: sourceWorkspace.name,
      mode: "DEMO",
      genesis: HASH,
      M0: sourceWorkspace.M0,
      M1: null,
      pure: null,
      contract: null,
      grantId: null,
      creationEvidence: [],
      continuityCertificate: null,
    });
    expect(restored.participants).toMatchObject({
      A: input.oldMembers[0],
      B: input.oldMembers[1],
      C: input.oldMembers[2],
      F: input.funder,
      R1: input.reviewers[0],
      R2: input.reviewers[1],
    });
    expect(await target.access.journal!.listRecords()).toHaveLength(1);
    await target.app.dispatch({
      type: "import-package",
      contents,
      previewDigest: preview.digest,
    });
    await idle(target.app);
    expect(target.access.workspaces).toHaveLength(1);
    expect(target.access.workspaces[0]!.id).toBe(restored.id);
    const reloaded = await application(false);
    expect(reloaded.app.getSnapshot().workspace).toMatchObject({
      id: restored.id,
      name: input.name,
    });
    expect(reloaded.app.getSnapshot().network.connected).toBe(false);
    expect(reloaded.app.getSnapshot().wallet.connected).toBe(false);
    expect(discover).not.toHaveBeenCalled();
    expect(sign).not.toHaveBeenCalled();
    expect(connection.send).not.toHaveBeenCalled();
    expect(connection.readAccount).not.toHaveBeenCalled();
  });

  it("inspects a local file while network connection is pending without modifying either context", async () => {
    const contents = await packageContents();
    const { app, access } = await application();
    const c = native();
    let finish!: (value: NativeConnection) => void;
    const connectCall = vi
      .spyOn(NativeConnection, "connect")
      .mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
    const connecting = app.dispatch({
      type: "connect-network",
      mode: "DEMO",
      endpoint,
    });
    await vi.waitFor(() => expect(connectCall).toHaveBeenCalledOnce());
    try {
      const preview = await inspect(app, contents);
      expect(preview.kind).toBe("workspace");
      expect(app.getSnapshot().busy).toBe("connect-network");
      expect(access.workspaces).toEqual([]);
      expect(access.journal).toBeNull();
      expect(await access.metadata.getPreference("workspaces")).toBeUndefined();
      expect(connectCall).toHaveBeenCalledOnce();
    } finally {
      finish(c);
      await connecting;
    }
  });

  it("restores evidence newer than the visible view using a fresh independently read finalized anchor", async () => {
    const { app, access } = await application();
    const connection = await connect(app);
    expect(access.chain?.fingerprint.anchor.number).toBe(10);
    const freshHash = `0x${"78".repeat(32)}` as `0x${string}`;
    const fresh: NativeFingerprint = {
      ...fingerprint,
      anchor: { hash: freshHash, number: 20 },
    };
    connection.fingerprint.mockResolvedValue(fresh);
    connection.api.rpc.chain_getBlockHash.mockImplementation(
      async (height: number) => (height === 0 ? HASH : freshHash),
    );
    const p = await qualified();
    const observation = await snapshot(p);
    observation.anchor.blockHash = freshHash;
    observation.anchor.blockNumber = "20";
    const s = await sealRecord(observation);
    const workspace = createWorkspaceRecord(input, "DEMO", fingerprint.genesis);
    const contents = canonicalJson(
      await exportWorkspacePackage(workspace, [p, s]),
    );
    const preview = await inspect(app, contents);

    await app.dispatch({
      type: "import-package",
      contents,
      previewDigest: preview.digest,
    });
    await idle(app);

    expect(access.chain?.fingerprint.anchor).toEqual(fresh.anchor);
    expect(reads.workspace).toHaveBeenCalledWith(
      connection,
      expect.objectContaining({ anchor: fresh.anchor }),
      expect.objectContaining({ name: input.name }),
      [],
    );
    expect(connection.api.rpc.chain_getBlockHash).toHaveBeenCalledWith(0);
    expect(connection.api.rpc.chain_getBlockHash).toHaveBeenCalledWith(20);
    expect(await access.journal!.getRecord(s.recordId)).toEqual(s);
  });

  it("does not publish a workspace if the transport is lost after its evidence transaction commits", async () => {
    const { app, access } = await application();
    const connection = await connect(app);
    const contents = await packageContents();
    const preview = await inspect(app, contents);
    const beforeNamespaces = (await indexedDB.databases())
      .map((entry) => entry.name)
      .sort();
    const publication = vi.spyOn(access.metadata, "setPreferences");
    let interruptedAfterWrite = false;
    storage.afterImport = () => {
      interruptedAfterWrite = true;
      connection.emit("disconnected");
    };

    await expect(
      app.dispatch({
        type: "import-package",
        contents,
        previewDigest: preview.digest,
      }),
    ).rejects.toThrow(/Connect and verify the matching network/);

    expect(interruptedAfterWrite).toBe(true);
    expect(publication).not.toHaveBeenCalled();
    expect(access.workspaces).toEqual([]);
    expect(access.currentId).toBeNull();
    expect(access.journal).toBeNull();
    expect(access.chain).toBeNull();
    expect(app.getSnapshot().network.connected).toBe(false);
    expect(await access.metadata.getPreference("workspaces")).toBeUndefined();
    expect(await access.metadata.getPreference("currentId")).toBeUndefined();
    expect(
      (await indexedDB.databases()).map((entry) => entry.name).sort(),
    ).toEqual(beforeNamespaces);
  });

  it("requires preview confirmation and a verified network before publishing a restored workspace", async () => {
    const contents = await packageContents();
    const { app, access } = await application();
    await expect(
      app.dispatch({ type: "import-package", contents }),
    ).rejects.toThrow(/Review.*before restoring/);
    const preview = await inspect(app, contents);
    await expect(
      app.dispatch({
        type: "import-package",
        contents,
        previewDigest: preview.digest,
      }),
    ).rejects.toThrow(/Connect and verify the matching network/);
    expect(access.workspaces).toEqual([]);
    expect(access.journal).toBeNull();
    expect(await access.metadata.getPreference("workspaces")).toBeUndefined();
  });

  it("rejects a file changed after inspection before any workspace or evidence is written", async () => {
    const contents = await packageContents();
    const { app, access } = await application();
    await connect(app);
    const preview = await inspect(app, contents);
    await expect(
      app.dispatch({
        type: "import-package",
        contents: contents + "\n",
        previewDigest: preview.digest,
      }),
    ).rejects.toThrow(/changed after review/);
    expect(access.workspaces).toEqual([]);
    expect(access.journal).toBeNull();
    expect(await access.metadata.getPreference("workspaces")).toBeUndefined();
  });

  it.each(["invalid-json", "imported-provider"] as const)(
    "rejects %s during offline inspection without installing any context or connecting a provider",
    async (failure) => {
      const { app, access } = await application();
      const connectCall = vi
        .spyOn(NativeConnection, "connect")
        .mockRejectedValue(new Error("Unexpected native connection"));
      const initialEndpoint = app.getSnapshot().network.endpoint;
      let contents = "{invalid JSON";
      if (failure === "imported-provider") {
        const packet = JSON.parse(await packageContents());
        packet.workspace.endpoint = "wss://untrusted-import.invalid/";
        contents = JSON.stringify(packet);
      }

      await expect(inspect(app, contents)).rejects.toThrow();

      expect(connectCall).not.toHaveBeenCalled();
      expect(app.getSnapshot().network.endpoint).toBe(initialEndpoint);
      expect(access.workspaces).toEqual([]);
      expect(access.journal).toBeNull();
      expect(await access.metadata.getPreference("workspaces")).toBeUndefined();
    },
  );

  it("rejects a different network before creating a workspace journal", async () => {
    const contents = await packageContents();
    const { app, access } = await application();
    await connect(app, native(`0x${"56".repeat(32)}`));
    const preview = await inspect(app, contents);
    const before = handles.length;
    await expect(
      app.dispatch({
        type: "import-package",
        contents,
        previewDigest: preview.digest,
      }),
    ).rejects.toThrow(/another network/);
    expect(handles).toHaveLength(before);
    expect(access.workspaces).toEqual([]);
    expect(await access.metadata.getPreference("workspaces")).toBeUndefined();
  });

  it("keeps an existing workspace selected if durable publication of a restored configuration fails", async () => {
    const { app, access } = await application();
    await connect(app);
    await app.dispatch({ type: "create-workspace", input });
    const original = access.workspaces[0]!;
    const incoming = createWorkspaceRecord(
      {
        ...input,
        name: "Another setup",
        oldMembers: [account(1), account(2), account(9)],
      },
      "DEMO",
      fingerprint.genesis,
    );
    const contents = canonicalJson(
      await exportWorkspacePackage(incoming, [await qualified()]),
    );
    const preview = await inspect(app, contents);
    const beforeRecords = await access.journal!.listRecords();
    const beforeMetadata = await access.metadata.getPreference("workspaces");
    const beforeNamespaces = (await indexedDB.databases())
      .map((database) => database.name)
      .sort();
    vi.spyOn(access.metadata, "setPreferences").mockRejectedValueOnce(
      new DOMException("Synthetic publication failure", "QuotaExceededError"),
    );
    await expect(
      app.dispatch({
        type: "import-package",
        contents,
        previewDigest: preview.digest,
      }),
    ).rejects.toThrow("Synthetic publication failure");
    expect(access.currentId).toBe(original.id);
    expect(access.workspaces).toHaveLength(1);
    expect(app.getSnapshot().workspace?.id).toBe(original.id);
    expect(await access.journal!.listRecords()).toEqual(beforeRecords);
    expect(await access.metadata.getPreference("workspaces")).toEqual(
      beforeMetadata,
    );
    expect(await access.metadata.getPreference("currentId")).toBe(original.id);
    expect(
      (await indexedDB.databases()).map((database) => database.name).sort(),
    ).toEqual(beforeNamespaces);
  });

  it.each(["pure", "grant"] as const)(
    "refuses same-network evidence for another %s before storing records in the selected workspace",
    async (scope) => {
      const { app, access } = await application();
      await connect(app);
      const { w, journal } = await activeWorkspace(app, access);
      const p = await qualified();
      const candidate = await snapshot(p);
      candidate.pure = scope === "pure" ? account(8) : w.pure;
      candidate.grantScope.grantId = scope === "grant" ? "1" : "0";
      const s = await sealRecord(candidate);
      const contents = canonicalJson(await exportPortable([p, s]));
      const store = vi.spyOn(journal, "importRecords");
      const before = await journal.listRecords();
      await expect(
        app.dispatch({ type: "import-package", contents }),
      ).rejects.toThrow(/different workspace/);
      expect(store).not.toHaveBeenCalled();
      expect(await journal.listRecords()).toEqual(before);
      expect(access.currentId).toBe(w.id);
    },
  );

  it("does not silently create a workspace from a legacy profile-only evidence package", async () => {
    const { app, access } = await application();
    await connect(app);
    const contents = canonicalJson(await exportPortable([await qualified()]));
    const preview = await inspect(app, contents);
    expect(preview.kind).toBe("evidence");
    expect(preview.missingFields.length).toBeGreaterThan(0);
    await expect(
      app.dispatch({
        type: "import-package",
        contents,
        previewDigest: preview.digest,
      }),
    ).rejects.toThrow(/Complete the missing details/);
    expect(access.workspaces).toEqual([]);
    expect(await access.metadata.getPreference("workspaces")).toBeUndefined();
  });

  it("restores a legacy evidence package after the user supplies and confirms missing public configuration", async () => {
    const { app, access } = await application();
    await connect(app);
    const contents = canonicalJson(await exportPortable([await qualified()]));
    const preview = await inspect(app, contents);

    await app.dispatch({
      type: "import-package",
      contents,
      previewDigest: preview.digest,
      workspaceInput: {
        ...input,
        name: "Explicit legacy configuration",
        beneficiary: "",
        contract: "",
        newMembers: [],
      },
    });
    await idle(app);

    expect(access.workspaces).toHaveLength(1);
    expect(app.getSnapshot().workspace?.name).toBe(
      "Explicit legacy configuration",
    );
    expect(access.workspaces[0]).toMatchObject({ pure: null, M1: null });
  });

  it.each(["funder", "replacement"] as const)(
    "does not merge a restored setup into another setup with a different %s configuration",
    async (change) => {
      const { app, access } = await application();
      await connect(app);
      await app.dispatch({ type: "create-workspace", input });
      const original = access.workspaces[0]!;
      const incoming = createWorkspaceRecord(
        {
          ...input,
          name: "Different public configuration",
          ...(change === "funder"
            ? { funder: account(9) }
            : { newMembers: [account(1), account(2), account(9)] }),
        },
        "DEMO",
        fingerprint.genesis,
      );
      const contents = canonicalJson(
        await exportWorkspacePackage(incoming, [await qualified()]),
      );
      const preview = await inspect(app, contents);
      expect(preview.matchingWorkspaces).toEqual([]);

      await app.dispatch({
        type: "import-package",
        contents,
        previewDigest: preview.digest,
      });
      await idle(app);

      expect(access.workspaces).toHaveLength(2);
      expect(
        access.workspaces.find((w) => w.id === original.id)?.participants.F,
      ).toBe(input.funder);
      const restored = access.workspaces.find((w) => w.id !== original.id)!;
      if (change === "funder") expect(restored.participants.F).toBe(account(9));
      else {
        expect(restored.M1?.members).toContain(account(9));
        expect(restored.participants.D).toBe(account(9));
        expect(
          access.workspaces.find((w) => w.id === original.id)?.M1,
        ).toBeNull();
      }
    },
  );

  it("publishes newly observed checkpoint metadata when importing into an existing workspace", async () => {
    const { app, access } = await application();
    await connect(app);
    const { w } = await activeWorkspace(app, access);
    const contents = canonicalJson(await exportPortable([await qualified()]));
    const baseline: NonNullable<WorkspaceRecord["baseline"]> = {
      account: {
        address: w.pure as `0x${string}`,
        free: 11n,
        reserved: 12n,
        frozen: 0n,
        nonce: 0,
        proxies: [],
        proxyDeposit: 0n,
        mappedAddress: `0x${"ab".repeat(20)}`,
        mappedTo: w.pure as `0x${string}`,
        holds: [],
        vesting: [],
      },
      grant: {
        funder: `0x${"aa".repeat(20)}`,
        grantee: `0x${"ab".repeat(20)}`,
        token: `0x${"00".repeat(20)}`,
        threshold: 2,
        milestoneCount: 0,
        milestones: [],
      },
      blockHash: HASH as `0x${string}`,
      creatorReserved: "0",
    };
    let finishFollowup: (() => void) | undefined;
    reads.workspace
      .mockImplementationOnce(
        async (
          _connection: NativeConnection,
          _fingerprint: NativeFingerprint,
          observed: WorkspaceRecord,
        ) => {
          observed.baseline = baseline;
          return {
            accounts: {},
            grant: null,
            history: null,
            baselineChanged: true,
          };
        },
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishFollowup = () =>
              resolve({
                accounts: {},
                grant: null,
                history: null,
                baselineChanged: false,
              });
          }),
      );
    try {
      await app.dispatch({ type: "import-package", contents });
      await vi.waitFor(() => expect(finishFollowup).toBeDefined());
      const persisted =
        await access.metadata.getPreference<Array<Record<string, unknown>>>(
          "workspaces",
        );
      expect(persisted?.[0]).toMatchObject({
        id: w.id,
        baseline: { blockHash: HASH, account: { free: "11", reserved: "12" } },
      });
      expect(access.workspaces[0]?.baseline?.account.free).toBe(11n);
    } finally {
      finishFollowup?.();
      await idle(app);
    }
  });

  it.each([
    "existing-history-call",
    "same-package-call",
    "existing-history-index",
    "existing-history-repeat",
  ] as const)(
    "independently checks transaction evidence for %s before merging",
    async (scenario) => {
      const { app, access } = await application();
      const connection = await connect(app);
      await app.dispatch({ type: "create-workspace", input });
      const w = access.workspaces[0]!;
      const journal = access.journal!;
      const txHash = blake2AsHex("0x0400");
      const original = await fundingHistory(w, "10", "original", txHash);
      const forged = await fundingHistory(
        w,
        scenario === "existing-history-index" ? "10" : "20",
        "forged",
        txHash,
        scenario === "existing-history-index" ? "1" : "0",
      );
      const receipt: NativeReceipt = {
        txHash,
        blockHash: HASH as Hex,
        blockNumber: 10,
        txIndex: 0,
        outerSuccess: true,
        nestedSuccess: true,
        businessExecuted: true,
        failure: null,
        events: [
          { pallet: "System", name: "ExtrinsicSuccess", data: {}, index: 0 },
        ],
      };
      const receiptAt = vi.fn().mockResolvedValue(receipt);
      const inspectExtrinsic = vi.fn().mockResolvedValue({
        bytes: "0x0400",
        signer: w.participants.S,
        call: {},
        callHex: original.call,
      });
      connection.receiptAt = receiptAt;
      connection.inspectExtrinsic = inspectExtrinsic;
      connection.currentBlockTime = vi.fn().mockResolvedValue(10_000n);
      let known: Awaited<ReturnType<typeof exportPortable>> | undefined;
      if (scenario !== "same-package-call") {
        known = await exportPortable(original.records);
        await journal.importRecords(known.records);
        w.history.push({
          id: "already-verified-history",
          operationId: original.e.intent.operationId,
          title: original.e.summaryText,
          at: new Date(10_000).toISOString(),
          signer: w.participants.S,
          receipt,
          envelopeDigest: original.e.digest,
          attemptId: known.records.find(
            (record) => record.kind === "SignedAttempt",
          )!.recordId,
          grantId: null,
          handoffId: w.handoffId ?? "initial",
        });
        access.render();
      }
      const incoming: CanonicalRecord[] =
        scenario === "same-package-call"
          ? [
              ...new Map(
                [...original.records, ...forged.records].map((record) => [
                  record.recordId,
                  record,
                ]),
              ).values(),
            ]
          : forged.records;
      const contents = canonicalJson(
        scenario === "existing-history-repeat"
          ? known!
          : await exportPortable(incoming),
      );
      const beforeRecords = await journal.listRecords();
      const beforeHistory = structuredClone(w.history);

      if (scenario === "existing-history-repeat") {
        await app.dispatch({ type: "import-package", contents });
        await idle(app);
      } else
        await expect(
          app.dispatch({ type: "import-package", contents }),
        ).rejects.toThrow(/actual native transaction/);

      expect(inspectExtrinsic).toHaveBeenCalledWith(HASH, 0);
      expect(inspectExtrinsic).toHaveBeenCalledTimes(
        scenario === "same-package-call" ? 2 : 1,
      );
      expect(await access.journal!.listRecords()).toEqual(beforeRecords);
      expect(access.workspaces[0]?.history).toEqual(beforeHistory);
      expect(access.currentId).toBe(w.id);
    },
  );
});
