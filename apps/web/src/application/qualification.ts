import {
  canonicalJson,
  createSnapshot,
  hexBytes,
  OPERATION_REQUIREMENTS,
  sha256,
  verifyReviewedSigningContext,
} from "@account-handoff/contracts";
import type {
  ApiBinding,
  BindingEvidence,
  ChainProfile,
  EvidenceRef,
  FrozenEnvelope,
  GateId,
  GateRecord,
  ReviewedSigningContext,
  Snapshot,
} from "@account-handoff/contracts";
import {
  assessPreparation,
  validateFreshOperation,
} from "@account-handoff/domain";
import type { Blocker, FreshOperationInput } from "@account-handoff/domain";
import type { NativeFingerprint } from "@account-handoff/native-adapter";
import type { WalletSession } from "@account-handoff/wallet-adapter";
import { $Metadata } from "dedot/codecs";
import { blake2AsHex } from "dedot/utils";
import type { LocalDescriptor } from "./models";

/** Emitted only by the LOCAL source/probe runner, never by an imported evidence package. */
export interface LocalCapabilityManifest {
  format: "account-handoff-local-capabilities-v1";
  runId: string;
  generation: number;
  genesisHash: string;
  metadataSha256: string;
  runtimeCodeHash: string;
  generatedNativeTypesSha256: string;
  apiSource?: { trait: EvidenceRef[]; implementation: EvidenceRef[] };
  currency?: {
    composition: "shared-balances-with-reason-holds";
    nativeToEthRatio: "10000";
    nativeDecimals: number;
    evidence: EvidenceRef[];
  };
  mapping?: {
    algorithm: "keccak256-last20";
    autoMap: false;
    originalAccount: "persisted-native-account";
    evidence: EvidenceRef[];
  };
  vesting?: {
    clock: "native-block-number";
    precompile: "0x0000000000000000000000000000000009020000";
    sourceEvidence: EvidenceRef[];
    nativeReleaseEvidence: EvidenceRef[];
  };
  adapter?: {
    dedot: "1.4.0";
    viem: "2.40.3";
    transport: "legacy";
    packageLockSha256: string;
    packageEvidence: EvidenceRef[];
    verificationEvidence: EvidenceRef[];
  };
  receipts?: {
    correlation: "finalized-block-extrinsic-index-and-whole-byte-hash";
    nestedFailures: "proxy-and-multisig-inspected";
    successEvidence: EvidenceRef[];
    failureEvidence: EvidenceRef[];
  };
}
export interface LocalQualificationResult {
  status: ChainProfile["status"];
  apiBindings: ApiBinding[];
  gateRecords: GateRecord[];
  sourceEvidence: EvidenceRef[];
  bindingEvidence: Partial<BindingEvidence>;
  mappingConfigurationEvidence: EvidenceRef[];
}
const SHA = /^[0-9a-f]{64}$/;
const COMMIT = /^[0-9a-f]{40}$/;
function evidenced(value: EvidenceRef[] | undefined): value is EvidenceRef[] {
  return (
    !!value?.length &&
    value.every(
      (entry) => !!entry.locator && SHA.test(entry.contentSha256 ?? ""),
    )
  );
}
function sourceBound(
  value: EvidenceRef[] | undefined,
  commit: string,
): value is EvidenceRef[] {
  return evidenced(value) && value.every((entry) => entry.sourceId === commit);
}
function gate(
  id: GateId,
  accepted: boolean,
  evidence: EvidenceRef[],
  reason: string,
): GateRecord {
  return {
    id,
    status: accepted ? "accepted" : "not_qualified",
    stage: "profile_capability",
    subject: "qualified LOCAL runtime",
    anchor: null,
    evidence: accepted ? evidence : [],
    reason,
  };
}

/** Fingerprint equality qualifies identity only; every capability has its own source/probe evidence. */
export async function buildLocalQualification(input: {
  descriptor: LocalDescriptor | null;
  fingerprint: NativeFingerprint;
}): Promise<LocalQualificationResult> {
  const { descriptor: d, fingerprint: f } = input;
  const identity =
    !!d &&
    d.mode === "LOCAL" &&
    d.status === "running" &&
    d.qualified === true &&
    d.genesisHash === f.genesis &&
    d.runtimeCodeHash === f.runtimeCodeHash &&
    d.metadataSha256 === f.metadataSha256 &&
    d.runtime.specName === "account-handoff-local" &&
    f.specName === d.runtime.specName &&
    d.runtime.specVersion === f.specVersion &&
    d.runtime.nativeDecimals === f.tokenDecimals &&
    d.runtime.nativeToEthRatio === "10000" &&
    d.runtime.autoMap === false &&
    f.metadataBinding === "pinned-runtime-code" &&
    !!f.metadataSourceAnchor &&
    !!d.nativeMetadataBinding &&
    d.nativeMetadataBinding.metadataSha256 === f.metadataSha256 &&
    d.nativeMetadataBinding.rawMetadata === f.rawMetadata &&
    d.nativeMetadataBinding.specVersion === f.specVersion &&
    d.nativeMetadataBinding.runtimeCodeHash === f.runtimeCodeHash &&
    d.nativeMetadataBinding.genesis === f.genesis &&
    d.nativeMetadataBinding.sourceAnchor.blockHash ===
      f.metadataSourceAnchor.blockHash &&
    d.nativeMetadataBinding.sourceAnchor.blockNumber ===
      f.metadataSourceAnchor.blockNumber &&
    SHA.test(d.generatedNativeTypesSha256 ?? "") &&
    SHA.test(d.buildHash ?? "") &&
    COMMIT.test(d.sourceCommit ?? "") &&
    (await sha256(hexBytes(f.rawMetadata))) === f.metadataSha256;
  const build: EvidenceRef = {
    kind: "local_artifact",
    locator: d ? `local:${d.runId}:${d.generation}:build` : "unqualified-local",
    sourceId: d?.sourceCommit ?? null,
    contentSha256: d?.buildHash ?? null,
  };
  const result: LocalQualificationResult = {
    status: identity ? "accepted" : "candidate",
    apiBindings: [],
    gateRecords: [
      gate(
        "Q-RUNTIME",
        identity,
        [build],
        identity
          ? "Exact LOCAL build, raw metadata, runtime and generated types match."
          : "LOCAL identity or raw artifacts are not qualified.",
      ),
    ],
    sourceEvidence: [build],
    mappingConfigurationEvidence: [],
    bindingEvidence: {
      rawMetadataEvidence: {
        kind: "native_chain",
        locator: `native:${f.genesis}:${f.metadataSourceAnchor?.blockHash ?? "unbound"}:metadata:${f.metadataSha256}`,
        sourceId: f.metadataSha256,
        contentSha256: f.metadataSha256,
      },
      rawRuntimeCodeEvidence: {
        kind: "native_chain",
        locator: `native:${f.genesis}:code:${f.runtimeCodeHash}`,
        sourceId: f.runtimeCodeHash,
        contentSha256: null,
      },
      runtimeSourceBuildRelationship: identity ? build : null,
      generatedNativeTypesSha256: d?.generatedNativeTypesSha256 ?? null,
      abiSha256: d?.contract?.abiSha256 ?? null,
      contractAddress: d?.contract?.address ?? null,
      contractRuntimeCodeHash: d?.contract?.runtimeCodeHash ?? null,
      contractSourceBuildRelationship: d?.contract ? build : null,
    },
  };
  const manifest = d?.capabilities;
  const bound =
    identity &&
    manifest?.format === "account-handoff-local-capabilities-v1" &&
    manifest.runId === d.runId &&
    manifest.generation === d.generation &&
    manifest.genesisHash === f.genesis &&
    manifest.metadataSha256 === f.metadataSha256 &&
    manifest.runtimeCodeHash === f.runtimeCodeHash &&
    manifest.generatedNativeTypesSha256 === d.generatedNativeTypesSha256;
  const c = bound ? manifest : undefined;
  const commit = d?.sourceCommit ?? "";
  const nativeProbes = (
    items: EvidenceRef[] | undefined,
  ): items is EvidenceRef[] =>
    evidenced(items) &&
    items.every(
      (item) =>
        item.kind === "native_chain" &&
        item.sourceId === `${f.genesis}:${d?.runId}:${d?.generation}`,
    );
  const currency = c?.currency;
  const currencyOk =
    currency?.composition === "shared-balances-with-reason-holds" &&
    currency.nativeToEthRatio === "10000" &&
    currency.nativeDecimals === f.tokenDecimals &&
    sourceBound(currency.evidence, commit);
  result.gateRecords.push(
    gate(
      "Q-CURRENCY",
      currencyOk === true,
      currency?.evidence ?? [],
      "Source-bound shared balance, reserve and hold composition is required.",
    ),
  );
  const mapping = c?.mapping;
  const mappingOk =
    mapping?.algorithm === "keccak256-last20" &&
    mapping.autoMap === false &&
    mapping.originalAccount === "persisted-native-account" &&
    sourceBound(mapping.evidence, commit);
  if (mappingOk) result.mappingConfigurationEvidence = mapping!.evidence;
  result.gateRecords.push(
    gate(
      "Q-MAPPING",
      mappingOk === true,
      mapping?.evidence ?? [],
      "Explicit normal-account mapping source configuration is required; account mapping itself is checked per action.",
    ),
  );
  const vesting = c?.vesting;
  const vestingOk =
    vesting?.clock === "native-block-number" &&
    vesting.precompile === "0x0000000000000000000000000000000009020000" &&
    sourceBound(vesting.sourceEvidence, commit) &&
    nativeProbes(vesting.nativeReleaseEvidence);
  result.gateRecords.push(
    gate(
      "Q-VESTING",
      vestingOk === true,
      [
        ...(vesting?.sourceEvidence ?? []),
        ...(vesting?.nativeReleaseEvidence ?? []),
      ],
      "The configured vesting clock/precompile and actual native release probe are required.",
    ),
  );
  const adapter = c?.adapter;
  const adapterOk =
    adapter?.dedot === "1.4.0" &&
    adapter.viem === "2.40.3" &&
    adapter.transport === "legacy" &&
    SHA.test(adapter.packageLockSha256) &&
    evidenced(adapter.packageEvidence) &&
    nativeProbes(adapter.verificationEvidence);
  if (adapterOk) {
    result.bindingEvidence.packageLockSha256 = adapter!.packageLockSha256;
    result.bindingEvidence.packageArtifactEvidence = adapter!.packageEvidence;
  }
  result.gateRecords.push(
    gate(
      "Q-ADAPTER",
      adapterOk === true,
      [
        ...(adapter?.packageEvidence ?? []),
        ...(adapter?.verificationEvidence ?? []),
      ],
      "Pinned package artifacts and executed adapter checks must be retained.",
    ),
  );
  const receipts = c?.receipts;
  const receiptsOk =
    receipts?.correlation ===
      "finalized-block-extrinsic-index-and-whole-byte-hash" &&
    receipts.nestedFailures === "proxy-and-multisig-inspected" &&
    nativeProbes(receipts.successEvidence) &&
    nativeProbes(receipts.failureEvidence);
  result.gateRecords.push(
    gate(
      "Q-RECEIPTS",
      receiptsOk === true,
      [
        ...(receipts?.successEvidence ?? []),
        ...(receipts?.failureEvidence ?? []),
      ],
      "Executed success and nested-failure probes must establish exact finalized native correlation.",
    ),
  );
  const contractOk =
    identity &&
    !!d?.contract &&
    SHA.test(d.contract.sourceSha256) &&
    SHA.test(d.contract.abiSha256) &&
    /^0x[0-9a-f]{64}$/.test(d.contract.runtimeCodeHash);
  result.gateRecords.push(
    gate(
      "Q-CONTRACT",
      contractOk,
      contractOk
        ? [
            build,
            {
              kind: "local_artifact",
              locator: `local:${d!.runId}:${d!.generation}:Vestry:${d!.contract!.address}`,
              sourceId: d!.contract!.sourceSha256,
              contentSha256: d!.contract!.abiSha256,
            },
          ]
        : [],
      "Unchanged Vestry source, ABI and verified deployment are required.",
    ),
  );
  const apiSource = c?.apiSource;
  if (
    identity &&
    apiSource &&
    sourceBound(apiSource.trait, commit) &&
    sourceBound(apiSource.implementation, commit)
  ) {
    const metadata = $Metadata.tryDecode(f.rawMetadata).metadataVersioned;
    const api =
      metadata.type === "V15" || metadata.type === "V16"
        ? metadata.value.apis.find((entry) => entry.name === "ReviveApi")
        : undefined;
    const id = blake2AsHex(new TextEncoder().encode("ReviveApi"), 64);
    if (
      api &&
      api.methods.some((method) => method.name === "call") &&
      f.runtimeApis[id] === 2 &&
      (f.metadataVersion !== 16 || ("version" in api && api.version === 2))
    ) {
      const methods = api.methods.map((method) => ({
        methodName: method.name,
        rpcMethodName: `ReviveApi_${method.name}`,
        canonicalSignature: `ReviveApi.${method.name}(${method.inputs.map((arg) => `${arg.name}:scaleType(${arg.typeId})`).join(",")})->scaleType(${method.output})@${f.metadataSha256}`,
        inputCodecArtifactSha256: d!.generatedNativeTypesSha256!,
        outputCodecArtifactSha256: d!.generatedNativeTypesSha256!,
        typeRegistrySha256: f.metadataSha256,
        sourceEvidence: apiSource.trait,
      }));
      result.apiBindings.push({
        name: "ReviveApi",
        version: "2",
        status: "qualified",
        codecArtifactSha256: d!.generatedNativeTypesSha256!,
        sourceEvidence: [build, ...apiSource.trait],
        boundRuntimeCodeHash: f.runtimeCodeHash,
        boundMetadataSha256: f.metadataSha256,
        methodManifestSha256: await sha256(canonicalJson(methods)),
        traitSourceEvidence: apiSource.trait,
        runtimeImplementationEvidence: apiSource.implementation,
        methods,
      });
    }
  }
  result.gateRecords.push(
    gate(
      "Q-REVIVE-API",
      result.apiBindings.length === 1,
      result.apiBindings[0]?.sourceEvidence ?? [],
      "Version 2 advertisement, exact metadata method/type IDs, source trait and runtime implementation must all bind.",
    ),
  );
  return result;
}

export interface PreparationSnapshotInput {
  profile: ChainProfile;
  snapshot: Snapshot;
  envelope: FrozenEnvelope;
  freshInput: FreshOperationInput;
  signingContext: ReviewedSigningContext;
  wallet: Pick<WalletSession, "source" | "version" | "accounts"> | null;
}
/** Pure current-session checks; they neither create a checkpoint nor claim a signature occurred. */
export function assessCurrentWallet(input: {
  profile: ChainProfile;
  envelope: FrozenEnvelope;
  signer: string;
  phase: FreshOperationInput["phase"];
  signingContext: ReviewedSigningContext;
  wallet: PreparationSnapshotInput["wallet"];
}): {
  walletAccepted: boolean;
  readinessAccepted: boolean;
  blockers: Blocker[];
} {
  const {
    profile,
    envelope,
    signer,
    phase,
    signingContext: context,
    wallet,
  } = input;
  const selected = wallet?.accounts.find((entry) => entry.address === signer);
  const supported = (type: string | undefined) =>
    ["ed25519", "sr25519", "ecdsa"].includes(type ?? "");
  const walletAccepted =
    !!wallet?.source &&
    !!wallet.version &&
    wallet.version !== "unknown" &&
    !!selected &&
    supported(selected.type) &&
    context.walletBuildId === `${wallet.source}:${wallet.version}` &&
    context.signer === signer &&
    context.operationPhase === phase &&
    context.genesis === profile.genesis &&
    context.metadataSha256 === profile.metadataSha256 &&
    context.runtimeCodeHash === profile.runtimeCodeHash;
  const roles = envelope.participants;
  const readinessAccepted =
    walletAccepted &&
    [roles.A, roles.B, roles.C, roles.D].every(
      (address, index, all) => all.indexOf(address) === index,
    ) &&
    [roles.A, roles.D].every((address) =>
      wallet?.accounts.some(
        (entry) => entry.address === address && supported(entry.type),
      ),
    );
  const blockers: Blocker[] = [];
  if (!walletAccepted)
    blockers.push({
      code: "WalletChanged",
      message:
        "The selected supported account and exact signature-only wallet session must remain available.",
      guardIds: ["Q-WALLET"],
    });
  if (
    OPERATION_REQUIREMENTS[
      envelope.intent.operationId
    ].requiredGateIds.includes("Q-READINESS") &&
    !readinessAccepted
  )
    blockers.push({
      code: "ReadinessChanged",
      message:
        "The required distinct A and D signer capabilities are no longer available in the reviewed wallet session.",
      guardIds: ["Q-READINESS"],
    });
  return { walletAccepted, readinessAccepted, blockers };
}
/** Complete only the observations needed for this operation, without inventing its future outputs. */
export async function completePreparationSnapshot(
  input: PreparationSnapshotInput,
): Promise<{ snapshot: Snapshot; blockers: Blocker[] }> {
  const {
    profile,
    snapshot: initial,
    envelope,
    freshInput: fresh,
    signingContext: context,
    wallet,
  } = input;
  const blockers = validateFreshOperation(fresh);
  if (
    fresh.envelope.digest !== envelope.digest ||
    initial.profileDigest !== profile.digest ||
    fresh.profileDigest !== profile.digest ||
    initial.anchor.blockHash !== envelope.anchor.blockHash
  )
    blockers.push({
      code: "PreparationContextMismatch",
      message:
        "Preparation inputs are not bound to the same profile and reviewed anchor",
      guardIds: ["SG-05", "SG-06"],
    });
  const facts = JSON.parse(
    JSON.stringify(
      {
        accounts: fresh.accounts,
        authority: fresh.authorityTuples,
        proposal: fresh.proposal,
        grant: fresh.grant,
        timeUnixSeconds: fresh.timeUnixSeconds,
      },
      (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
    ),
  );
  const evidence: EvidenceRef = {
    kind: "native_chain",
    locator: `${initial.anchor.blockHash}:preparation:${envelope.intent.operationId}`,
    sourceId: profile.profileId,
    contentSha256: await sha256(canonicalJson(facts)),
  };
  const currentWallet = assessCurrentWallet({
    profile,
    envelope,
    signer: fresh.signer,
    phase: fresh.phase,
    signingContext: context,
    wallet,
  });
  let walletOk = currentWallet.walletAccepted;
  try {
    await verifyReviewedSigningContext(context);
  } catch {
    walletOk = false;
  }
  const walletEvidence: EvidenceRef = {
    kind: "local_artifact",
    locator: `wallet:${wallet?.source ?? "missing"}:${wallet?.version ?? "unknown"}:native-signPayload-capability`,
    sourceId: context.walletBuildId,
    contentSha256: await sha256(
      canonicalJson({
        source: wallet?.source ?? null,
        version: wallet?.version ?? null,
        accounts: wallet?.accounts ?? [],
        signer: context.signer,
        requestDigest: context.signPayloadSha256,
      }),
    ),
  };
  const assessments: GateRecord[] = [];
  const actionGate = (
    id: GateId,
    accepted: boolean,
    reason: string,
    refs = [evidence],
  ) =>
    assessments.push({
      id,
      status: accepted ? "accepted" : "not_qualified",
      stage: "action_input",
      subject: envelope.intent.operationId,
      anchor: initial.anchor,
      evidence: accepted ? refs : [],
      reason,
    });
  actionGate(
    "Q-WALLET",
    walletOk,
    "An explicit supported account and unchanged signature-only wallet request are required.",
    [walletEvidence],
  );
  const fundingCodes = new Set([
    "UnknownResourceRequirement",
    "BalanceUnavailable",
    "InsufficientLiquidity",
  ]);
  actionGate(
    "Q-FUNDING",
    !blockers.some((b) => fundingCodes.has(b.code)),
    "Every actual payer must cover value, deposits, fee budget and existential minimum.",
  );
  const inventoryOk =
    fresh.authorityTuples !== null &&
    !!fresh.pure &&
    !blockers.some((b) =>
      ["AuthorityUnavailable", "AuthorityChanged"].includes(b.code),
    );
  actionGate(
    "Q-INVENTORY",
    inventoryOk,
    "Full current native delegate inventory, including unsupported entries, is required.",
  );
  const scopeOk =
    envelope.intent.operationId === "GRC-GRANT-CREATE"
      ? fresh.grant === null
      : fresh.grantHistoryComplete &&
        fresh.grantScope === "EligibleSingleRound";
  actionGate(
    "Q-GRANT-SCOPE",
    scopeOk &&
      !blockers.some((b) =>
        [
          "GrantBindingChanged",
          "GrantScopeChanged",
          "MilestoneChanged",
          "ContinuationUnavailable",
        ].includes(b.code),
      ),
    "Creation policy or complete original-round grant history must match this action.",
  );
  actionGate(
    "Q-READINESS",
    walletOk && currentWallet.readinessAccepted,
    "Distinct controller roles and available supported A/D wallet accounts establish pre-sign readiness; custody and future signatures remain unproven.",
    [walletEvidence],
  );
  const required =
    OPERATION_REQUIREMENTS[envelope.intent.operationId].requiredGateIds;
  for (const assessment of assessments) {
    if (required.includes(assessment.id) && assessment.status !== "accepted")
      blockers.push({
        code: "MissingActionInput",
        message: `${assessment.id}: ${assessment.reason}`,
        guardIds: [assessment.id],
      });
  }
  const missing = required.some(
    (id) =>
      ![...profile.gateRecords, ...assessments].some(
        (item) =>
          item.id === id &&
          item.status === "accepted" &&
          item.stage !== "finalized_output",
      ),
  );
  const completed = await createSnapshot({
    profile,
    anchor: initial.anchor,
    pure: initial.pure,
    authority: initial.authority,
    mapping: initial.mapping,
    accounting: fresh.accounting ?? initial.accounting,
    grantScope: initial.grantScope,
    observations: {
      ...initial.observations,
      preparation: {
        availability: "observed",
        value: facts,
        anchor: initial.anchor,
        decoderId:
          profile.bindingEvidence.generatedNativeTypesSha256 ?? "unqualified",
        evidence: [evidence],
        errorCode: null,
      },
    },
    gateAssessments: assessments,
    sourceEvidence: [...initial.sourceEvidence, evidence],
    completeness: blockers.length === 0 && !missing ? "complete" : "incomplete",
  });
  blockers.push(...assessPreparation(profile, completed, required));
  return { snapshot: completed, blockers };
}
