import {
  canonicalJson,
  createReadAnchor,
  createReceiptBundle,
  hexBytes,
  newRecordId,
  sha256,
  validateCallTree,
  verifyReviewedSigningContext,
} from "@account-handoff/contracts";
import type {
  CallTree,
  ChainProfile,
  DataValue,
  EventRecord,
  EvidenceRef,
  FrozenEnvelope,
  LayerResult,
  Postcondition,
  ReadAnchor,
  ReceiptBundle,
  CausalBusinessContext,
  ReviewedSigningContext,
  SignedAttempt,
} from "@account-handoff/contracts";
import { classifyNativeOutcome } from "@account-handoff/evidence";
import {
  decodeGrantEvent,
  encodeApproval,
  encodeCreateGrant,
  encodeSubmission,
} from "@account-handoff/grant-adapter";
import { account, hex, integer, number } from "@account-handoff/native-adapter";
import type {
  Hex,
  NativeAction,
  NativeFingerprint,
  NativeReceipt,
  PreparedSigning,
} from "@account-handoff/native-adapter";

export function buildReadAnchor(
  profile: ChainProfile,
  fingerprint: NativeFingerprint,
): ReadAnchor {
  const contextId = `${fingerprint.specVersion}:${fingerprint.runtimeCodeHash.slice(2, 18)}:${fingerprint.metadataSha256.slice(0, 16)}`;
  const context = {
    contextId,
    genesis: fingerprint.genesis,
    runtimeCodeHash: fingerprint.runtimeCodeHash,
    metadataSha256: fingerprint.metadataSha256,
    specVersion: String(fingerprint.specVersion),
    transactionVersion: String(fingerprint.transactionVersion),
    metadataVersion: String(fingerprint.metadataVersion),
    apiCodecArtifactSha256:
      profile.apiBindings.find((binding) => binding.status === "qualified")
        ?.codecArtifactSha256 ?? null,
    rawEvidence: profile.sourceEvidence,
  };
  return createReadAnchor({
    blockHash: fingerprint.anchor.hash,
    blockNumber: String(fingerprint.anchor.number),
    providerId: `${profile.profileId}:native`,
    context,
  });
}

export async function buildSigningContext(
  prepared: PreparedSigning,
  walletBuildId: string,
  phase: ReviewedSigningContext["operationPhase"],
  nativeProposalDigest: string | null = null,
): Promise<ReviewedSigningContext> {
  const payload = prepared.payload;
  const context: ReviewedSigningContext = {
    requestId: newRecordId("request"),
    walletBuildId,
    signer: prepared.signer,
    genesis: prepared.fingerprint.genesis,
    specVersion: String(prepared.fingerprint.specVersion),
    transactionVersion: String(prepared.fingerprint.transactionVersion),
    runtimeCodeHash: prepared.fingerprint.runtimeCodeHash,
    metadataSha256: prepared.fingerprint.metadataSha256,
    signedExtensions: payload.signedExtensions,
    nonce: BigInt(payload.nonce).toString(),
    era: payload.era,
    mortalityBlockHash: payload.blockHash,
    outerCallBytes: prepared.callHex,
    outerCallHash: prepared.callHash,
    extrinsicVersion: String(payload.version),
    encodedExtraPayloadBytes: prepared.encodedExtra,
    tipNative: BigInt(payload.tip).toString(),
    feeAssetId: null,
    metadataHashExtensionValue: payload.metadataHash ?? null,
    originalSignPayloadJcsUtf8: canonicalJson(payload),
    additionalSignedPayloadBytes: prepared.additionalSigned,
    signPayloadSha256: await sha256(canonicalJson(payload)),
    additionalSignedContextSha256: await sha256(
      hexBytes(prepared.additionalSigned),
    ),
    withSignedTransactionRequested: false,
    walletReturnedSignedTransactionAccepted: false,
    operationPhase: phase,
    nativeProposalDigest,
  };
  await verifyReviewedSigningContext(context);
  return context;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected a structured call value");
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Expected a text call parameter");
  return value;
}
function childAt(tree: CallTree): CallTree {
  if (tree.children.length !== 1)
    throw new Error("A wrapper must contain exactly one child");
  return tree.children[0]!;
}
function abiData(tree: CallTree): Hex {
  const parameters = object(tree.parameters);
  if (tree.kind !== "abi_call" || tree.palletOrContract !== "VESTRY")
    throw new Error("Expected an allowed Vestry ABI leaf");
  if (tree.method === "submitMilestone(uint256,uint256,string)")
    return encodeSubmission(
      BigInt(text(parameters.grantId)),
      Number(parameters.index),
      text(parameters.evidence),
    );
  if (tree.method === "approveMilestone(uint256,uint256)")
    return encodeApproval(
      BigInt(text(parameters.grantId)),
      Number(parameters.index),
    );
  if (
    tree.method ===
    "createGrant(address,address,address[],uint8,(uint128,uint64,uint32,address,bytes4,uint64)[])"
  ) {
    if (
      !Array.isArray(parameters.reviewers) ||
      !Array.isArray(parameters.inputs)
    )
      throw new Error("Invalid grant arrays");
    return encodeCreateGrant(
      hex(text(parameters.grantee), 20),
      parameters.reviewers.map((value) => hex(text(value), 20)),
      parameters.inputs.map((input) => {
        const item = object(input);
        return {
          amount: BigInt(text(item.amount)),
          deadline: BigInt(text(item.deadline)),
          vestingBlocks: Number(item.vestingBlocks),
          metricTarget: hex(text(item.metricTarget), 20),
          metricSelector: hex(text(item.metricSelector), 4),
          metricMin: BigInt(text(item.metricMin)),
        };
      }),
    );
  }
  throw new Error("ABI method is outside the authoring allowlist");
}

/** Converts only a schema-valid, closed application tree. ABI bytes are independently reconstructed. */
export function nativeActionFromTree(input: CallTree): NativeAction {
  const validated = validateCallTree(input);
  if (!validated.ok)
    throw new Error(`Invalid native call tree: ${validated.errors.join("; ")}`);
  const tree = validated.value;
  const p = object(tree.parameters);
  if (tree.kind !== "native_call")
    throw new Error("ABI leaves cannot be executed as native root calls");
  if (
    tree.palletOrContract === "Balances" &&
    tree.method === "transfer_keep_alive"
  )
    return {
      kind: "transfer",
      destination: account(text(p.dest)),
      amount: BigInt(text(p.valueNative)),
    };
  if (tree.palletOrContract === "Proxy" && tree.method === "create_pure")
    return { kind: "create-pure", index: number(text(p.index)) };
  if (tree.palletOrContract === "Proxy" && tree.method === "proxy")
    return {
      kind: "proxy",
      beneficiary: account(text(p.real)),
      inner: nativeActionFromTree(childAt(tree)),
    };
  if (
    tree.palletOrContract === "Proxy" &&
    ["add_proxy", "remove_proxy"].includes(tree.method)
  )
    return {
      kind: tree.method === "add_proxy" ? "add-proxy" : "remove-proxy",
      delegate: account(text(p.delegate)),
    };
  if (tree.palletOrContract === "Revive" && tree.method === "map_account")
    return { kind: "map-account" };
  if (tree.palletOrContract === "Revive" && tree.method === "call") {
    const data = hex(text(p.data));
    if (data !== abiData(childAt(tree)))
      throw new Error(
        "Revive data differs from its independently encoded ABI intent",
      );
    const limit = object(p.weightLimit);
    return {
      kind: "revive-call",
      destination: hex(text(p.dest), 20),
      value: BigInt(text(p.valueNative)),
      weight: {
        refTime: BigInt(text(limit.refTime)),
        proofSize: BigInt(text(limit.proofSize)),
      },
      storage: BigInt(text(p.storageDepositLimitNative)),
      data,
    };
  }
  if (tree.palletOrContract === "Vesting" && tree.method === "vest_other")
    return { kind: "vest-other", beneficiary: account(text(p.target)) };
  if (
    tree.palletOrContract === "Multisig" &&
    tree.method === "cancel_as_multi"
  ) {
    const time = object(p.timepoint);
    if (!Array.isArray(p.otherSignatories))
      throw new Error("Invalid signatories");
    return {
      kind: "cancel",
      threshold: number(text(p.threshold)),
      others: p.otherSignatories.map((value) => account(text(value))),
      timepoint: {
        height: number(text(time.height)),
        index: number(text(time.index)),
      },
      callHash: hex(text(p.callHash), 32),
    };
  }
  throw new Error("Native operation is outside the authoring allowlist");
}

function dataValue(value: unknown): DataValue {
  if (value === null || typeof value === "boolean" || typeof value === "string")
    return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value))
      throw new Error("Imprecise numeric evidence");
    return String(value);
  }
  if (Array.isArray(value)) return value.map(dataValue);
  const output: Record<string, DataValue> = {};
  for (const [key, item] of Object.entries(object(value)))
    if (item !== undefined) output[key] = dataValue(item);
  return output;
}
function normalizedResult(
  value: unknown,
): "success" | "failure" | "unavailable" {
  if (!value || typeof value !== "object") return "unavailable";
  const result = object(value);
  if (result.type === "Ok" || result.isOk === true || "Ok" in result)
    return "success";
  if (result.type === "Err" || result.isErr === true || "Err" in result)
    return "failure";
  return "unavailable";
}

export interface ReceiptContext {
  postconditions?: Postcondition[];
  /** Must come from complete ordered chain history, not only the current getter or submitted intent. */
  roundAtIntendedEvent?: string;
  orderedHistoryComplete?: boolean;
}

export async function buildReceipt(
  envelope: FrozenEnvelope,
  attempt: SignedAttempt,
  native: NativeReceipt,
  anchor: ReadAnchor,
  phase: ReceiptBundle["operationPhase"],
  context: ReceiptContext = {},
): Promise<ReceiptBundle> {
  if (
    anchor.blockHash !== native.blockHash ||
    anchor.blockNumber !== String(native.blockNumber)
  )
    throw new Error("Receipt must use its actual finalized block context");
  const evidence: EvidenceRef = {
    kind: "native_chain",
    locator: `${native.blockHash}/${native.txIndex}`,
    sourceId: anchor.providerId,
    contentSha256: await sha256(canonicalJson(dataValue(native))),
  };
  const events: EventRecord[] = [];
  let ordinal = 0;
  for (const raw of native.events) {
    let decoded = object(dataValue(raw.data));
    let emitter: string | null = null;
    let logOrdinal: string | null = null;
    if (["ProxyExecuted", "MultisigExecuted"].includes(raw.name))
      decoded = { ...decoded, result: normalizedResult(raw.data.result) };
    if (raw.pallet === "Revive" && raw.name === "ContractEmitted") {
      emitter = hex(text(raw.data.contract), 20);
      logOrdinal = String(ordinal++);
      try {
        if (!Array.isArray(raw.data.topics))
          throw new Error("Missing contract topics");
        const log = object(
          decodeGrantEvent(
            hex(text(raw.data.data)),
            raw.data.topics.map((topic) => hex(text(topic), 32)),
          ),
        );
        decoded = {
          ...decoded,
          eventName: text(log.eventName),
          args: dataValue(log.args),
        };
      } catch (error) {
        decoded = {
          ...decoded,
          decodeError:
            error instanceof Error ? error.message : "ABI decode failed",
        };
      }
    }
    events.push({
      nativeEventIndex: String(raw.index),
      extrinsicIndex: String(native.txIndex),
      pallet: raw.pallet,
      event: raw.name,
      contractEmitter: emitter,
      abiLogOrdinal: logOrdinal,
      rawEvidence: evidence,
      decoded: dataValue(decoded),
    });
  }
  const assessment = classifyNativeOutcome(
    events,
    envelope.signingPath,
    String(native.txIndex),
  );
  const postconditions = [...(context.postconditions ?? [])];
  postconditions.push({
    id: "nested-dispatch",
    result:
      assessment.businessEffect === "failed"
        ? "failed"
        : assessment.businessEffect === "unknown"
          ? "unknown"
          : "passed",
    anchor,
    observations: [evidence],
    explanation:
      assessment.reasons.join("; ") ||
      "All expected native dispatch layers were correlated",
  });
  const grantAction = envelope.intent.operationId.startsWith("GRC-GRANT-");
  const expectedContract = envelope.intent.parameters.contract;
  const expectedName =
    envelope.intent.operationId === "GRC-GRANT-CREATE"
      ? "GrantCreated"
      : envelope.intent.operationId === "GRC-GRANT-APPROVE"
        ? "MilestoneApproved"
        : "MilestoneSubmitted";
  const expected = events.filter((event) => {
    const value = object(event.decoded);
    if (
      event.contractEmitter !== expectedContract ||
      value.eventName !== expectedName
    )
      return false;
    const args = object(value.args);
    return (
      (envelope.intent.operationId === "GRC-GRANT-CREATE" ||
        (String(args.grantId) === envelope.intent.parameters.grantId &&
          String(args.index) === envelope.intent.parameters.index)) &&
      (expectedName !== "MilestoneSubmitted" ||
        args.evidence === envelope.intent.parameters.evidence)
    );
  });
  const intended = expected.length === 1 ? expected[0]! : undefined;
  const causal: CausalBusinessContext = {
    assessment: !grantAction
      ? ("not_applicable" as const)
      : intended &&
          context.orderedHistoryComplete &&
          context.roundAtIntendedEvent === "0"
        ? ("matched" as const)
        : ("unresolved" as const),
    grantId:
      typeof envelope.intent.parameters.grantId === "string"
        ? envelope.intent.parameters.grantId
        : null,
    milestoneIndex:
      envelope.intent.parameters.index === "0" ||
      envelope.intent.parameters.index === "1"
        ? envelope.intent.parameters.index
        : null,
    roundAtIntendedEvent: context.roundAtIntendedEvent ?? null,
    intendedEvidenceSha256:
      typeof envelope.intent.parameters.evidence === "string"
        ? await sha256(envelope.intent.parameters.evidence)
        : null,
    nativeEventIndex: intended?.nativeEventIndex ?? null,
    abiLogOrdinal: intended?.abiLogOrdinal ?? null,
    orderedHistoryComplete: context.orderedHistoryComplete ?? false,
    eventOrderEvidence: context.orderedHistoryComplete ? [evidence] : [],
  };
  let status = assessment.status;
  let businessEffect = assessment.businessEffect;
  if (
    grantAction &&
    phase !== "multisig_first" &&
    (causal.assessment !== "matched" || !intended)
  ) {
    status = "unresolved";
    businessEffect = "unknown";
  }
  if (postconditions.some((condition) => condition.result === "failed")) {
    status = "finalized_failure";
    businessEffect = "configuration_diverged";
  } else if (
    postconditions.some((condition) => condition.result === "unknown") &&
    phase !== "multisig_first"
  ) {
    status = "unresolved";
    businessEffect = "unknown";
  }
  return createReceiptBundle({
    envelope,
    attempt,
    anchor,
    extrinsicIndex: String(native.txIndex),
    layers: assessment.layers as LayerResult[],
    events,
    postconditions,
    status,
    businessEffect,
    operationPhase: phase,
    causalBusinessContext: causal,
    proposalAfter:
      assessment.proposalConsumed === true
        ? "consumed"
        : assessment.proposalConsumed === false
          ? "present"
          : null,
    evidence: [evidence],
  });
}
