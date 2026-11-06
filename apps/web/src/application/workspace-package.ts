import {
  canonicalJson,
  assertUnicode,
  exportPortable,
  importPortable,
  parseBoundedJson,
  type CanonicalRecord,
  type EvidenceRef,
  type PortablePackage,
} from "@account-handoff/contracts";
import {
  account,
  hex,
  object,
  type Hex,
} from "@account-handoff/native-adapter";
import type { RuntimeMode } from "../ui-contract";
import type { WorkspaceRecord } from "./models";

export interface PublicController {
  members: string[];
  threshold: 2;
}
export type PublicParticipants = Pick<
  WorkspaceRecord["participants"],
  "A" | "B" | "C" | "D" | "F" | "R1" | "R2"
>;
export interface WorkspaceDescriptor {
  name: string;
  mode: RuntimeMode;
  genesis: Hex;
  M0: PublicController;
  M1: PublicController | null;
  participants: PublicParticipants;
  pure: string | null;
  contract: Hex | null;
  grantId: string | null;
  creation: { blockHash: Hex; transactionHash: Hex } | null;
  /** Historical read hints only; uploaded amounts and proof flags are never restored. */
  baselineBlockHash: Hex | null;
  handoffBaselineBlockHash: Hex | null;
}
export interface WorkspacePackage {
  format: "account-handoff-workspace-package";
  version: 1;
  workspace: WorkspaceDescriptor;
  evidence: PortablePackage;
}
export type WorkspaceImportDraft = Partial<
  Omit<WorkspaceDescriptor, "participants">
> & { participants?: Partial<PublicParticipants> };
export interface WorkspaceImportCandidate {
  source: "workspace-package" | "legacy-evidence";
  workspace: WorkspaceImportDraft;
  evidence: PortablePackage;
  missingFields: string[];
  warnings: string[];
}

const descriptorFields = [
  "name",
  "mode",
  "genesis",
  "M0",
  "M1",
  "participants",
  "pure",
  "contract",
  "grantId",
  "creation",
  "baselineBlockHash",
  "handoffBaselineBlockHash",
] as const;
const participantFields = ["A", "B", "C", "D", "F", "R1", "R2"] as const;
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function fields(value: unknown, names: readonly string[], label: string) {
  const record = object(value);
  requireValue(
    Object.keys(record).every((key) => names.includes(key)),
    `${label} contains unsupported fields`,
  );
  requireValue(
    names.every((key) => Object.hasOwn(record, key)),
    `${label} is missing required fields`,
  );
  return record;
}
function text(value: unknown, label: string): string {
  requireValue(typeof value === "string", `${label} must be text`);
  assertUnicode(value);
  return value;
}
function native(value: unknown, label: string): string {
  return account(text(value, label));
}
function controller(value: unknown): PublicController {
  const record = fields(
    value,
    ["members", "threshold"],
    "Controller definition",
  );
  requireValue(
    record["threshold"] === 2,
    "The supported controller threshold is two",
  );
  const input = record["members"];
  requireValue(
    Array.isArray(input) && input.length === 3,
    "A controller requires three members",
  );
  const members = input.map((member) => native(member, "Controller member"));
  requireValue(
    new Set(members).size === 3,
    "Controller members must be distinct",
  );
  return { members, threshold: 2 };
}
function sameMembers(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((member) => right.includes(member))
  );
}
function grantId(value: unknown): string {
  const result = text(value, "Grant ID");
  requireValue(
    /^(0|[1-9]\d*)$/.test(result) && result.length <= 78,
    "Grant ID must be a bounded nonnegative decimal string",
  );
  requireValue(BigInt(result) < 1n << 256n, "Grant ID exceeds uint256");
  return result;
}

/** Validates public configuration, without establishing network facts or authority. */
export function validateWorkspaceDescriptor(
  value: unknown,
): WorkspaceDescriptor {
  const record = fields(value, descriptorFields, "Workspace descriptor");
  const name = text(record["name"], "Workspace name").trim();
  requireValue(
    name.length > 0 && name.length <= 80,
    "Workspace name must contain 1–80 characters",
  );
  const mode = record["mode"];
  requireValue(
    mode === "LOCAL" || mode === "DEMO" || mode === "LIVE",
    "Unsupported workspace environment",
  );
  const M0 = controller(record["M0"]);
  const M1 = record["M1"] === null ? null : controller(record["M1"]);
  const roles = fields(
    record["participants"],
    participantFields,
    "Workspace participants",
  );
  const participants: PublicParticipants = {
    A: native(roles["A"], "Participant A"),
    B: native(roles["B"], "Participant B"),
    C: native(roles["C"], "Participant C"),
    D: roles["D"] === null ? null : native(roles["D"], "Participant D"),
    F: native(roles["F"], "Funder"),
    R1: native(roles["R1"], "Reviewer R1"),
    R2: native(roles["R2"], "Reviewer R2"),
  };
  requireValue(
    new Set([participants.A, participants.B, participants.C]).size === 3 &&
      sameMembers(M0.members, [participants.A, participants.B, participants.C]),
    "Current participant roles differ from the current controller members",
  );
  requireValue(
    participants.R1 !== participants.R2,
    "Reviewers must be distinct",
  );
  if (M1) {
    requireValue(
      participants.D !== null &&
        !M0.members.includes(participants.D) &&
        sameMembers(M1.members, [
          participants.A,
          participants.B,
          participants.D,
        ]),
      "The replacement must retain A and B and replace C with D",
    );
  } else
    requireValue(
      participants.D === null,
      "Participant D requires a planned replacement controller",
    );
  const pure =
    record["pure"] === null ? null : native(record["pure"], "Pure beneficiary");
  const contract =
    record["contract"] === null ? null : hex(record["contract"], 20);
  const grant = record["grantId"] === null ? null : grantId(record["grantId"]);
  const rawCreation =
    record["creation"] === null
      ? null
      : fields(
          record["creation"],
          ["blockHash", "transactionHash"],
          "Pure creation locator",
        );
  const creation = rawCreation
    ? {
        blockHash: hex(rawCreation["blockHash"], 32),
        transactionHash: hex(rawCreation["transactionHash"], 32),
      }
    : null;
  requireValue(
    (pure === null) === (creation === null),
    "A Pure beneficiary requires its exact creation locator",
  );
  requireValue(
    !contract || pure !== null,
    "A grant deployment requires a Pure beneficiary",
  );
  requireValue(
    grant === null || contract !== null,
    "A grant ID requires its contract deployment",
  );
  const baselineBlockHash =
    record["baselineBlockHash"] === null
      ? null
      : hex(record["baselineBlockHash"], 32);
  const handoffBaselineBlockHash =
    record["handoffBaselineBlockHash"] === null
      ? null
      : hex(record["handoffBaselineBlockHash"], 32);
  requireValue(
    pure !== null ||
      (baselineBlockHash === null && handoffBaselineBlockHash === null),
    "Historical checkpoint hints require a Pure beneficiary",
  );
  return {
    name,
    mode,
    genesis: hex(record["genesis"], 32),
    M0,
    M1,
    participants,
    pure,
    contract,
    grantId: grant,
    creation,
    baselineBlockHash,
    handoffBaselineBlockHash,
  };
}

function creationLocator(
  evidence: EvidenceRef,
): WorkspaceDescriptor["creation"] {
  const match = /^(0x[0-9a-fA-F]{64})\/(?:0|[1-9]\d*)$/.exec(evidence.locator);
  if (
    evidence.kind !== "native_chain" ||
    !match ||
    !evidence.sourceId ||
    !/^0x[0-9a-fA-F]{64}$/.test(evidence.sourceId)
  )
    return null;
  return {
    blockHash: hex(match[1], 32),
    transactionHash: hex(evidence.sourceId, 32),
  };
}

/** Explicit allowlist: never serialize the local workspace object or its receipts. */
export function describeWorkspace(
  workspace: WorkspaceRecord,
): WorkspaceDescriptor {
  const locators = workspace.creationEvidence.flatMap((evidence) => {
    const locator = creationLocator(evidence);
    return locator ? [locator] : [];
  });
  const distinct = new Map(
    locators.map((locator) => [canonicalJson(locator), locator]),
  );
  requireValue(
    !workspace.pure || distinct.size === 1,
    "The Pure creation locator is missing or ambiguous; reconnect it before exporting the workspace",
  );
  const roles = workspace.participants;
  return validateWorkspaceDescriptor({
    name: workspace.name,
    mode: workspace.mode,
    genesis: workspace.genesis,
    M0: {
      members: [...workspace.M0.members],
      threshold: Number(workspace.M0.threshold),
    },
    M1: workspace.M1
      ? {
          members: [...workspace.M1.members],
          threshold: Number(workspace.M1.threshold),
        }
      : null,
    participants: {
      A: roles.A,
      B: roles.B,
      C: roles.C,
      D: roles.D,
      F: roles.F,
      R1: roles.R1,
      R2: roles.R2,
    },
    pure: workspace.pure,
    contract: workspace.contract,
    grantId: workspace.grantId,
    creation: workspace.pure ? [...distinct.values()][0] : null,
    baselineBlockHash: workspace.baseline?.blockHash ?? null,
    handoffBaselineBlockHash: workspace.handoffBaseline?.blockHash ?? null,
  });
}

export async function exportWorkspacePackage(
  workspace: WorkspaceRecord,
  records: readonly CanonicalRecord[],
): Promise<WorkspacePackage> {
  const result: WorkspacePackage = {
    format: "account-handoff-workspace-package",
    version: 1,
    workspace: describeWorkspace(workspace),
    evidence: await exportPortable(records),
  };
  // The 5 MiB boundary applies to the complete container, including its descriptor.
  parseBoundedJson(canonicalJson(result));
  return result;
}

/** Legacy evidence is a set of untrusted hints, never a guessed current workspace. */
function legacyCandidate(evidence: PortablePackage): WorkspaceImportCandidate {
  const workspace: WorkspaceImportDraft = {
    baselineBlockHash: null,
    handoffBaselineBlockHash: null,
  };
  const warnings = [
    "This evidence-only file does not contain a complete workspace configuration. Complete and confirm the missing fields before network verification.",
  ];
  const values = new Map<string, Map<string, unknown>>();
  const add = (key: string, value: unknown) => {
    if (value === undefined) return;
    const entries = values.get(key) ?? new Map();
    entries.set(canonicalJson(value), value);
    values.set(key, entries);
  };
  const controllers = new Map<string, PublicController>();
  const addController = (value: { members: string[]; threshold: string }) => {
    const definition = controller({
      members: value.members,
      threshold: Number(value.threshold),
    });
    controllers.set(canonicalJson([...definition.members].sort()), definition);
  };
  for (const record of evidence.records) {
    if (record.kind === "ChainProfile" && record.genesis)
      add("genesis", hex(record.genesis, 32));
    if ("anchor" in record && record.anchor)
      add("genesis", hex(record.anchor.contextBindings.postState.genesis, 32));
    if (record.kind === "Snapshot") {
      if (record.pure) add("pure", native(record.pure, "Pure beneficiary"));
      if (record.grantScope.grantId !== null)
        add("grantId", grantId(record.grantScope.grantId));
      if (record.pure && record.accounting?.pure === record.pure)
        for (const evidence of record.accounting.creationProvenance) {
          const locator = creationLocator(evidence);
          if (locator) add("creation", locator);
        }
    }
    if (record.kind === "FrozenEnvelope") {
      for (const role of participantFields)
        add(`participants.${role}`, record.participants[role]);
      if (record.controller) addController(record.controller);
      const parameters = record.intent.parameters;
      if (typeof parameters["pure"] === "string")
        add("pure", native(parameters["pure"], "Pure beneficiary"));
      if (typeof parameters["targetPure"] === "string")
        add("pure", native(parameters["targetPure"], "Pure beneficiary"));
      if (typeof parameters["contract"] === "string")
        add("contract", hex(parameters["contract"], 20));
      if (typeof parameters["grantId"] === "string")
        add("grantId", grantId(parameters["grantId"]));
    }
    if (record.kind === "ContinuityCertificate") {
      addController(record.M0);
      addController(record.M1);
      add("pure", native(record.identity.P, "Pure beneficiary"));
      add("contract", hex(record.identity.contractAddress, 20));
      add("grantId", grantId(record.identity.grantId));
      add("genesis", hex(record.after.contextBindings.postState.genesis, 32));
      const locator = creationLocator(record.identity.creationReceipt);
      if (locator) add("creation", locator);
    }
    if (
      record.kind === "ReceiptBundle" &&
      record.operationId === "GRC-SETUP-CREATE-PURE"
    ) {
      const creations = record.events.filter(
        (event) => event.pallet === "Proxy" && event.event === "PureCreated",
      );
      if (creations.length === 1) {
        const decoded = creations[0]!.decoded;
        if (
          decoded &&
          !Array.isArray(decoded) &&
          typeof decoded === "object" &&
          typeof decoded["pure"] === "string"
        ) {
          add("pure", native(decoded["pure"], "Pure beneficiary"));
          add("creation", {
            blockHash: hex(record.blockHash, 32),
            transactionHash: hex(record.extrinsicHash, 32),
          });
        }
      }
    }
  }
  for (const [key, entries] of values) {
    if (entries.size !== 1) {
      warnings.push(
        `Conflicting ${key} values require manual selection; no historical timestamp was used to choose one.`,
      );
      continue;
    }
    const value = [...entries.values()][0];
    if (key.startsWith("participants.")) {
      workspace.participants ??= {};
      const role = key.slice(
        "participants.".length,
      ) as keyof PublicParticipants;
      if (role === "D") workspace.participants.D = value as string | null;
      else workspace.participants[role] = value as string;
    } else Object.assign(workspace, { [key]: value });
  }
  if ((values.get("pure")?.size ?? 0) !== 1 && workspace.creation) {
    delete workspace.creation;
    warnings.push(
      "Select the Pure beneficiary before completing its creation locator; several identities cannot share an inferred locator.",
    );
  }
  const roles = workspace.participants;
  if (roles?.A && roles.B && roles.C) {
    const definition = controller({
      members: [roles.A, roles.B, roles.C],
      threshold: 2,
    });
    controllers.set(canonicalJson([...definition.members].sort()), definition);
    if (roles.D) {
      const replacement = controller({
        members: [roles.A, roles.B, roles.D],
        threshold: 2,
      });
      controllers.set(
        canonicalJson([...replacement.members].sort()),
        replacement,
      );
    }
  }
  if (
    controllers.size === 1 &&
    roles?.D === null &&
    roles.A &&
    roles.B &&
    roles.C
  ) {
    const definition = [...controllers.values()][0]!;
    if (sameMembers(definition.members, [roles.A, roles.B, roles.C])) {
      workspace.M0 = definition;
      workspace.M1 = null;
    }
  } else if (controllers.size > 1)
    warnings.push(
      "Several historical controllers are present. Select the current and planned controller explicitly; the latest timestamp is not authority.",
    );
  const missingFields: string[] = [];
  for (const field of descriptorFields) {
    if (field === "participants") {
      for (const role of participantFields)
        if (!Object.hasOwn(workspace.participants ?? {}, role))
          missingFields.push(`participants.${role}`);
    } else if (!Object.hasOwn(workspace, field)) missingFields.push(field);
  }
  return {
    source: "legacy-evidence",
    workspace,
    evidence,
    missingFields,
    warnings,
  };
}

/** Offline preview only: no RPC, persistence, wallet, or activation occurs here. */
export async function parseWorkspacePackage(
  contents: string,
): Promise<WorkspaceImportCandidate> {
  const raw = object(parseBoundedJson(contents));
  if (raw["format"] !== "account-handoff-workspace-package")
    return legacyCandidate((await importPortable(contents)).package);
  const container = fields(
    raw,
    ["format", "version", "workspace", "evidence"],
    "Workspace package",
  );
  requireValue(
    container["version"] === 1,
    "Unsupported workspace package version",
  );
  const workspace = validateWorkspaceDescriptor(container["workspace"]);
  const evidence = (await importPortable(canonicalJson(container["evidence"])))
    .package;
  return {
    source: "workspace-package",
    workspace,
    evidence,
    missingFields: [],
    warnings: [
      "Configuration and evidence remain unverified until checked against the selected network. Imported review or success flags never authorize signing.",
    ],
  };
}
