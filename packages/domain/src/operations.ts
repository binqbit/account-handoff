import {
  validateCallTree,
  validateIntentStructure,
} from "@account-handoff/contracts";
import type {
  AccountId32,
  CallTree,
  Controller,
  EnabledOperationId,
  EvidenceRef,
  Intent,
  ParticipantBindings,
  ResourceBounds,
} from "@account-handoff/contracts";
import { DomainError, type Blocker, type Result } from "./result.js";
import {
  isNormalAccount,
  normalizeIdentity,
  otherSignatories,
} from "./identity.js";
import { integer } from "./units.js";

export const OPERATION_IDS = [
  "GRC-SETUP-FUND-M0",
  "GRC-SETUP-FUND-ACTOR",
  "GRC-SETUP-CREATE-PURE",
  "GRC-SETUP-FUND-P",
  "GRC-SETUP-MAP-P",
  "GRC-SETUP-MAP-ACTOR",
  "GRC-GRANT-CREATE",
  "GRC-GRANT-SUBMIT-M0",
  "GRC-GRANT-SUBMIT-M1",
  "GRC-GRANT-APPROVE",
  "GRC-ROTATION-ADD-M1",
  "GRC-ROTATION-REMOVE-M0",
  "GRC-VESTING-VEST-OTHER",
  "GRC-MULTISIG-CANCEL",
] as const satisfies readonly EnabledOperationId[];
export type OperationId = (typeof OPERATION_IDS)[number];

export interface PlanContext {
  participants: ParticipantBindings;
  M0: Controller;
  M1: Controller;
  pure: AccountId32 | null;
  resources: ResourceBounds;
  sourceEvidence: EvidenceRef[];
  encodeAbi: (tree: CallTree) => `0x${string}`;
  mappedPure?: string;
  nativeToAbiRatio?: bigint;
}
export interface OperationPlan {
  callTree: CallTree;
  signingPath: "direct" | "multisig_proxy" | "multisig_direct";
  controller: Controller | null;
  requiredSigners: AccountId32[];
}

export function validateIntent(input: unknown): Result<Intent> {
  const structural = validateIntentStructure(input);
  if (!structural.ok)
    return {
      ok: false,
      blockers: structural.errors.map((message) => ({
        code: "InvalidIntent",
        message,
        guardIds: ["SG-03"],
      })),
    };
  const intent = structural.value;
  const issues: Blocker[] = [];
  const fail = (
    code: string,
    message: string,
    guardIds: string[] = ["SG-03"],
  ): void => {
    issues.push({ code, message, guardIds });
  };
  for (const [key, value] of Object.entries(intent.parameters)) {
    if (
      typeof value === "string" &&
      (key.endsWith("Native") ||
        ["grantId", "pureIndex", "index"].includes(key))
    ) {
      try {
        integer(value, key === "grantId" ? 256 : 128);
      } catch (error) {
        fail("InvalidInteger", String(error));
      }
    }
  }
  const evidence = intent.parameters.evidence;
  if (
    typeof evidence === "string" &&
    new TextEncoder().encode(evidence).byteLength > 1024
  )
    fail("EvidenceTooLong", "Milestone evidence exceeds 1,024 UTF-8 bytes", [
      "SG-01",
    ]);
  if (intent.expectedState.localExpiryRevokesNativeProposal !== false)
    fail(
      "InvalidExpiryClaim",
      "A local review expiry cannot revoke native proposals",
    );
  if (
    intent.parameters.pure &&
    (typeof intent.parameters.pure !== "string" ||
      !isNormalAccount(intent.parameters.pure))
  )
    fail(
      "UnsupportedMappingBranch",
      "Only normal persisted mapping is supported",
      ["SG-08"],
    );
  if (intent.operationId === "GRC-GRANT-CREATE") {
    const p = intent.parameters;
    if (
      !Array.isArray(p.milestones) ||
      p.milestones.length !== 2 ||
      !Array.isArray(p.reviewers) ||
      p.reviewers.length !== 2
    )
      fail(
        "UnsupportedGrantScope",
        "The selected grant has two milestones and two reviewers",
        ["SG-15"],
      );
  }
  return issues.length
    ? { ok: false, blockers: issues }
    : { ok: true, value: intent };
}

/** Build only catalogued trees. The schema checks this internal construction before native encoding. */
export function planOperation(
  intent: Intent,
  context: PlanContext,
): OperationPlan {
  const checked = validateIntent(intent);
  if (!checked.ok)
    throw new DomainError(
      "InvalidIntent",
      checked.blockers.map((x) => x.message).join("; "),
    );
  if (!context.sourceEvidence.length)
    throw new DomainError(
      "MissingSourceBinding",
      "A call requires source-bound evidence",
    );
  const p = intent.parameters;
  const readString = (name: string): string => {
    const value = p[name];
    if (typeof value !== "string")
      throw new DomainError(
        "InvalidParameter",
        `Missing string parameter ${name}`,
      );
    return value;
  };
  const node = (
    palletOrContract: string,
    method: string,
    parameters: object,
    children: unknown[] = [],
    kind = "native_call",
  ): object => ({
    kind,
    palletOrContract,
    method,
    parameters,
    children,
    sourceEvidence: context.sourceEvidence,
  });
  const checkedTree = (raw: unknown): CallTree => {
    const result = validateCallTree(raw);
    if (!result.ok)
      throw new DomainError("InvalidCallTree", result.errors.join("; "));
    return result.value;
  };
  const proxied = (pure: string, child: object): object =>
    node(
      "Proxy",
      "proxy",
      { real: pure, forceProxyType: { variant: "Some", value: "Any" } },
      [child],
    );
  const revive = (dest: string, child: object): object =>
    node(
      "Revive",
      "call",
      {
        dest,
        valueNative: context.resources.valueNative,
        weightLimit: context.resources.reviveWeight,
        storageDepositLimitNative: context.resources.storageDepositLimitNative,
        data: context.encodeAbi(checkedTree(child)),
      },
      [child],
    );
  let raw: object;
  let controller: Controller | null = null;
  let requiredSigners: AccountId32[];
  let signingPath: OperationPlan["signingPath"] = "direct";
  const oldSigners = [context.participants.A, context.participants.B];
  const newSigners = [context.participants.A, context.participants.D];
  if (
    new Set([
      context.participants.A,
      context.participants.B,
      context.participants.C,
      context.participants.D,
    ]).size !== 4
  )
    throw new DomainError(
      "DuplicateParticipant",
      "A, B, C and D must be distinct",
    );
  const assertPure = (value: string): void => {
    if (!context.pure || value !== context.pure)
      throw new DomainError(
        "BeneficiaryMismatch",
        "Operation must use the established beneficiary",
      );
  };
  const transfer = [
    "GRC-SETUP-FUND-M0",
    "GRC-SETUP-FUND-ACTOR",
    "GRC-SETUP-FUND-P",
  ].includes(intent.operationId);
  if (
    transfer &&
    (integer(readString("valueNative")) === 0n ||
      context.resources.valueNative !== readString("valueNative"))
  )
    throw new DomainError(
      "ResourceMismatch",
      "Funding amount must be positive and match the reviewed resource value",
    );
  if (
    !transfer &&
    intent.operationId !== "GRC-GRANT-CREATE" &&
    context.resources.valueNative !== "0"
  )
    throw new DomainError(
      "ResourceMismatch",
      "This operation transfers no native value",
    );
  switch (intent.operationId) {
    case "GRC-SETUP-FUND-M0":
      if (readString("recipient") !== context.M0.account)
        throw new DomainError(
          "RecipientMismatch",
          "M0 funding must target the exact original controller",
        );
      raw = node("Balances", "transfer_keep_alive", {
        dest: readString("recipient"),
        valueNative: readString("valueNative"),
      });
      requiredSigners = [context.participants.S];
      break;
    case "GRC-SETUP-FUND-ACTOR":
      if (
        context.participants[
          readString("recipientRole") as keyof ParticipantBindings
        ] !== readString("recipient")
      )
        throw new DomainError(
          "RecipientMismatch",
          "Funding recipient does not match its declared role",
        );
      raw = node("Balances", "transfer_keep_alive", {
        dest: readString("recipient"),
        valueNative: readString("valueNative"),
      });
      requiredSigners = [context.participants.S];
      break;
    case "GRC-SETUP-FUND-P":
      assertPure(readString("pure"));
      raw = node("Balances", "transfer_keep_alive", {
        dest: readString("pure"),
        valueNative: readString("valueNative"),
      });
      requiredSigners = [context.participants.S];
      break;
    case "GRC-SETUP-CREATE-PURE":
      integer(readString("pureIndex"), 16);
      raw = node("Proxy", "create_pure", {
        proxyType: "Any",
        delay: "0",
        index: readString("pureIndex"),
      });
      controller = context.M0;
      requiredSigners = oldSigners;
      signingPath = "multisig_direct";
      break;
    case "GRC-SETUP-MAP-ACTOR":
      if (
        context.participants[
          readString("actorRole") as keyof ParticipantBindings
        ] !== readString("account")
      )
        throw new DomainError(
          "ActorMismatch",
          "Mapping account does not match its declared direct role",
        );
      raw = node("Revive", "map_account", {});
      requiredSigners = [normalizeIdentity(readString("account"))];
      break;
    case "GRC-SETUP-MAP-P":
      assertPure(readString("pure"));
      raw = proxied(readString("pure"), node("Revive", "map_account", {}));
      controller = context.M0;
      requiredSigners = oldSigners;
      signingPath = "multisig_proxy";
      break;
    case "GRC-ROTATION-ADD-M1":
    case "GRC-ROTATION-REMOVE-M0": {
      const adding = intent.operationId === "GRC-ROTATION-ADD-M1";
      assertPure(readString("pure"));
      if (
        readString("oldController") !== context.M0.account ||
        readString("newController") !== context.M1.account
      )
        throw new DomainError(
          "ControllerMismatch",
          "Controller identities differ from the canonical workspace",
        );
      raw = proxied(
        readString("pure"),
        node("Proxy", adding ? "add_proxy" : "remove_proxy", {
          delegate: adding ? context.M1.account : context.M0.account,
          proxyType: "Any",
          delay: "0",
        }),
      );
      controller = adding ? context.M0 : context.M1;
      requiredSigners = adding ? oldSigners : newSigners;
      signingPath = "multisig_proxy";
      break;
    }
    case "GRC-GRANT-CREATE": {
      if (
        !context.mappedPure ||
        readString("granteeH160") !== context.mappedPure
      )
        throw new DomainError(
          "GranteeMismatch",
          "Grant must be created for the verified beneficiary mapping",
        );
      if (!context.nativeToAbiRatio || context.nativeToAbiRatio <= 0n)
        throw new DomainError(
          "UnqualifiedRatio",
          "Grant creation requires the qualified conversion ratio",
        );
      const milestones = p.milestones as Array<{ amount: string }>;
      const total = milestones.reduce(
        (sum, value) => sum + integer(value.amount),
        0n,
      );
      if (
        total === 0n ||
        total % context.nativeToAbiRatio !== 0n ||
        total / context.nativeToAbiRatio !==
          BigInt(context.resources.valueNative)
      )
        throw new DomainError(
          "ResourceMismatch",
          "Grant native funding must equal exact ABI milestone principal",
        );
      raw = revive(
        readString("contract"),
        node(
          "VESTRY",
          "createGrant(address,address,address[],uint8,(uint128,uint64,uint32,address,bytes4,uint64)[])",
          {
            grantee: p.granteeH160,
            token: p.token,
            reviewers: p.reviewers,
            threshold: p.threshold,
            inputs: p.milestones,
          },
          [],
          "abi_call",
        ),
      );
      requiredSigners = [context.participants.F];
      break;
    }
    case "GRC-GRANT-SUBMIT-M0":
    case "GRC-GRANT-SUBMIT-M1": {
      if (context.pure === null)
        throw new DomainError(
          "MissingPure",
          "A beneficiary must be established before submitting",
        );
      raw = proxied(
        context.pure,
        revive(
          readString("contract"),
          node(
            "VESTRY",
            "submitMilestone(uint256,uint256,string)",
            { grantId: p.grantId, index: p.index, evidence: p.evidence },
            [],
            "abi_call",
          ),
        ),
      );
      const newGroup = intent.operationId === "GRC-GRANT-SUBMIT-M1";
      controller = newGroup ? context.M1 : context.M0;
      requiredSigners = newGroup ? newSigners : oldSigners;
      signingPath = "multisig_proxy";
      break;
    }
    case "GRC-GRANT-APPROVE": {
      raw = revive(
        readString("contract"),
        node(
          "VESTRY",
          "approveMilestone(uint256,uint256)",
          { grantId: p.grantId, index: p.index },
          [],
          "abi_call",
        ),
      );
      const author = normalizeIdentity(intent.authorActor);
      if (![context.participants.R1, context.participants.R2].includes(author))
        throw new DomainError(
          "NotReviewer",
          "Only the selected direct reviewer can approve",
        );
      requiredSigners = [author];
      break;
    }
    case "GRC-VESTING-VEST-OTHER":
      assertPure(readString("targetPure"));
      raw = node("Vesting", "vest_other", { target: readString("targetPure") });
      requiredSigners = [context.participants.S];
      break;
    case "GRC-MULTISIG-CANCEL": {
      const target = p.targetController as Controller;
      const signer = normalizeIdentity(readString("originalDepositor"));
      raw = node("Multisig", "cancel_as_multi", {
        threshold: target.threshold,
        otherSignatories: otherSignatories(target, signer),
        timepoint: p.targetTimepoint,
        callHash: p.targetCallHash,
      });
      requiredSigners = [signer];
      break;
    }
    default:
      throw new DomainError(
        "UnsupportedOperation",
        "Operation is outside the authoring allowlist",
      );
  }
  return {
    callTree: checkedTree(raw),
    signingPath,
    controller,
    requiredSigners,
  };
}
