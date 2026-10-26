import type {
  AccountingLedger,
  FrozenEnvelope,
  VestingTuple,
} from "@account-handoff/contracts";
import {
  assessBacking,
  hasPreservedSchedule,
  spendable,
} from "./accounting.js";
import type { Blocker } from "./result.js";

export interface FreshAccount {
  free: bigint;
  reserved: bigint;
  frozen: bigint;
  mappedTo: string | null;
}
export interface FreshProposal {
  depositor: string;
  approvals: readonly string[];
  when: { height: number; index: number };
  callHash?: string;
}
export interface FreshGrant {
  grantee: string;
  funder: string;
  threshold: number;
  milestoneCount: number;
  token: string;
  milestones: readonly {
    state: number;
    round: number;
    deadline: bigint;
    vestingBlocks: number;
    metricTarget: string;
    metricSelector: string;
    metricMin: bigint;
  }[];
}
export interface FreshOperationInput {
  envelope: FrozenEnvelope;
  signer: string;
  phase: "direct" | "multisig_first" | "multisig_final" | "cancel";
  profileDigest: string;
  timeUnixSeconds: bigint;
  authorityTuples:
    | readonly { delegate: string; proxyType: string; delay: string | number }[]
    | null;
  accounts: Readonly<Record<string, FreshAccount>>;
  grant: FreshGrant | null;
  grantScope:
    | "Unverified"
    | "EligibleSingleRound"
    | "ReconciliationRequired"
    | "ScopeBreached"
    | "Closed";
  grantHistoryComplete: boolean;
  proposal: FreshProposal | null;
  expectedProposalTimepoint?: { height: number; index: number };
  pure: string | null;
  mappedPure: string | null;
  M0: string;
  M1: string | null;
  existentialDepositNative: bigint;
  proposalDepositNative?: bigint;
  pureCreationDepositNative?: bigint;
  mappingDepositNative?: bigint;
  proxyIncrementNative?: bigint;
  accounting?: AccountingLedger;
  baselineVesting?: readonly VestingTuple[];
  currentVesting?: readonly VestingTuple[];
  vestingBlockNumber?: bigint;
  continuityVerified?: boolean;
  reviewerAuthorized?: boolean;
}

export interface OperationResourceRequirement {
  kind:
    | "outer_fee"
    | "value"
    | "proposal_deposit"
    | "pure_deposit"
    | "mapping_hold"
    | "proxy_increment"
    | "storage_limit";
  payer: string | null;
  amountNative: bigint | undefined;
  reason: string;
  source:
    | "reviewed_fee_budget"
    | "reviewed_value"
    | "runtime_multisig_deposit"
    | "runtime_pure_deposit"
    | "runtime_mapping_hold"
    | "runtime_proxy_factor"
    | "reviewed_storage_limit";
}

/** The same disjoint requirements drive affordability guards and the review's payer split. */
export function operationResourceRequirements(
  input: FreshOperationInput,
): OperationResourceRequirement[] {
  const { envelope, signer, phase } = input;
  const operation = envelope.intent.operationId;
  const required: OperationResourceRequirement[] = [];
  const add = (
    kind: OperationResourceRequirement["kind"],
    payer: string | null,
    amountNative: bigint | undefined,
    reason: string,
    source: OperationResourceRequirement["source"],
  ) => required.push({ kind, payer, amountNative, reason, source });
  add(
    "outer_fee",
    signer,
    envelope.resources.outerFeeLocalBudgetNative === null
      ? undefined
      : BigInt(envelope.resources.outerFeeLocalBudgetNative),
    "Outer fee",
    "reviewed_fee_budget",
  );
  if (envelope.signingPath === "direct")
    add(
      "value",
      signer,
      BigInt(envelope.resources.valueNative),
      "Transferred value",
      "reviewed_value",
    );
  if (phase === "multisig_first")
    add(
      "proposal_deposit",
      signer,
      input.proposalDepositNative,
      "Multisig proposal deposit",
      "runtime_multisig_deposit",
    );
  if (operation === "GRC-SETUP-CREATE-PURE")
    add(
      "pure_deposit",
      input.M0,
      input.pureCreationDepositNative,
      "Pure creation reserve",
      "runtime_pure_deposit",
    );
  if (operation === "GRC-SETUP-MAP-P")
    add(
      "mapping_hold",
      input.pure,
      input.mappingDepositNative,
      "Mapping hold",
      "runtime_mapping_hold",
    );
  if (operation === "GRC-SETUP-MAP-ACTOR")
    add(
      "mapping_hold",
      signer,
      input.mappingDepositNative,
      "Mapping hold",
      "runtime_mapping_hold",
    );
  if (operation === "GRC-ROTATION-ADD-M1")
    add(
      "proxy_increment",
      input.pure,
      input.proxyIncrementNative,
      "Additional controller reserve",
      "runtime_proxy_factor",
    );
  if (operation.startsWith("GRC-GRANT-"))
    add(
      "storage_limit",
      operation === "GRC-GRANT-SUBMIT-M0" || operation === "GRC-GRANT-SUBMIT-M1"
        ? input.pure
        : signer,
      envelope.resources.storageDepositLimitNative === null
        ? undefined
        : BigInt(envelope.resources.storageDepositLimitNative),
      "Contract storage budget",
      "reviewed_storage_limit",
    );
  return required;
}

const ZERO_ADDRESS = `0x${"00".repeat(20)}`;
const proxyOperations = new Set([
  "GRC-SETUP-MAP-P",
  "GRC-GRANT-SUBMIT-M0",
  "GRC-GRANT-SUBMIT-M1",
  "GRC-ROTATION-ADD-M1",
  "GRC-ROTATION-REMOVE-M0",
]);
const continuityOperations = new Set([
  "GRC-ROTATION-ADD-M1",
  "GRC-ROTATION-REMOVE-M0",
  "GRC-GRANT-SUBMIT-M1",
]);

/** Reevaluate immediately before every wallet request and send using fresh, same-anchor facts. */
export function validateFreshOperation(input: FreshOperationInput): Blocker[] {
  const { envelope, signer, phase } = input;
  const operationId = envelope.intent.operationId;
  const blockers: Blocker[] = [];
  const add = (
    code: string,
    message: string,
    guardIds: string[] = [],
  ): void => {
    blockers.push({ code, message, guardIds });
  };
  if (input.profileDigest !== envelope.intent.profileDigest)
    add("ProfileChanged", "The exact profile revision changed after review", [
      "SG-04",
    ]);
  if (
    input.timeUnixSeconds >
    BigInt(envelope.intent.expectedState.localReviewExpiresAtUnixSeconds)
  )
    add(
      "ReviewExpired",
      "The reviewed request has expired; refresh the immutable review",
      ["SG-19"],
    );
  if (envelope.status !== "frozen" && envelope.status !== "approved")
    add(
      "UnsealedEnvelope",
      "Only sealed immutable plans can request a signature",
      ["SG-29"],
    );
  if (!envelope.semanticIntentDigest)
    add("UnsealedEnvelope", "Semantic identity is missing", ["SG-29"]);
  const expectedSigner =
    envelope.requiredSigners[phase === "multisig_final" ? 1 : 0];
  if (signer !== expectedSigner)
    add(
      "SignerChanged",
      "The selected human is not the required signer for this phase",
      ["SG-07"],
    );
  if (
    envelope.signingPath === "direct" &&
    !["direct", "cancel"].includes(phase)
  )
    add(
      "WrongExecutionPhase",
      "Direct operations cannot use a multisig wrapper",
    );
  if (
    envelope.signingPath !== "direct" &&
    !["multisig_first", "multisig_final"].includes(phase)
  )
    add(
      "WrongExecutionPhase",
      "Multisig operations require their explicit approval phase",
    );

  const rotation = ["GRC-ROTATION-ADD-M1", "GRC-ROTATION-REMOVE-M0"].includes(
    operationId,
  );
  const tuples = input.authorityTuples;
  const expectedDelegates =
    operationId === "GRC-ROTATION-REMOVE-M0"
      ? [input.M0, input.M1]
      : operationId === "GRC-GRANT-SUBMIT-M1"
        ? [input.M1]
        : [input.M0];
  if (proxyOperations.has(operationId)) {
    if (!tuples)
      add(
        "AuthorityUnavailable",
        "Full current authority inventory is unavailable",
        ["SG-12"],
      );
    else if (
      tuples.length !== expectedDelegates.length ||
      tuples.some(
        (tuple) => tuple.proxyType !== "Any" || String(tuple.delay) !== "0",
      ) ||
      new Set(tuples.map((tuple) => tuple.delegate)).size !== tuples.length ||
      expectedDelegates.some(
        (delegate) => !tuples.some((tuple) => tuple.delegate === delegate),
      )
    )
      add(
        "AuthorityChanged",
        "Full authority inventory differs from the exact supported controller set",
        ["SG-12"],
      );
  }
  if (operationId === "GRC-SETUP-CREATE-PURE" && input.pure !== null)
    add(
      "PureAlreadyCreated",
      "A beneficiary already exists; creation cannot be retried as a new account",
    );
  if (operationId === "GRC-GRANT-CREATE" && input.grant !== null)
    add(
      "GrantAlreadyCreated",
      "The existing grant must be reconciled before another creation",
    );
  if (
    operationId === "GRC-VESTING-VEST-OTHER" &&
    input.continuityVerified !== true
  )
    add(
      "ContinuityProofRequired",
      "Optional vesting refresh is available only after the completed continuity proof",
      ["SG-24"],
    );
  if (operationId === "GRC-GRANT-APPROVE" && input.reviewerAuthorized !== true)
    add(
      "ReviewerMembershipUnknown",
      "Current reviewer membership must be verified from the grant contract",
      ["SG-17"],
    );

  if (phase === "multisig_first" && input.proposal !== null)
    add(
      "ProposalAlreadyExists",
      "A native proposal already exists; reconcile its exact incarnation",
      ["SG-20"],
    );
  if (phase === "multisig_final") {
    const proposal = input.proposal;
    if (!proposal)
      add("ProposalMissing", "The reviewed native proposal no longer exists", [
        "SG-20",
      ]);
    else {
      if (
        proposal.depositor !== envelope.requiredSigners[0] ||
        proposal.approvals.length !== 1 ||
        proposal.approvals[0] !== envelope.requiredSigners[0]
      )
        add(
          "FirstApprovalMismatch",
          "The proposal does not contain the required first signer/depositor",
          ["SG-07", "SG-20"],
        );
      if (
        proposal.callHash !== undefined &&
        proposal.callHash !== envelope.innerRuntimeCallHash
      )
        add(
          "CallHashChanged",
          "The proposal commits to different inner bytes",
          ["SG-13"],
        );
      const expected = input.expectedProposalTimepoint;
      if (
        !expected ||
        expected.height !== proposal.when.height ||
        expected.index !== proposal.when.index
      )
        add(
          "ProposalIncarnationChanged",
          "Native timepoint changed since this final request was reviewed",
          ["SG-20"],
        );
    }
  }
  if (operationId === "GRC-MULTISIG-CANCEL") {
    const proposal = input.proposal;
    const expected = envelope.intent.parameters.targetTimepoint;
    if (
      !proposal ||
      proposal.depositor !== signer ||
      typeof expected !== "object" ||
      expected === null ||
      Array.isArray(expected) ||
      String(proposal.when.height) !== expected.height ||
      String(proposal.when.index) !== expected.index
    )
      add(
        "CancellationMismatch",
        "Cancellation requires the actual depositor and exact proposal timepoint",
        ["SG-21"],
      );
  }

  const requireMapped = (who: string | null): void => {
    if (
      !who ||
      !input.accounts[who] ||
      input.accounts[who]!.mappedTo !== who ||
      who.endsWith("ee".repeat(12))
    )
      add(
        "MappingUnavailable",
        "Required origin lacks the supported persisted reverse mapping",
        ["SG-08"],
      );
  };
  if (operationId.startsWith("GRC-GRANT-")) {
    requireMapped(input.pure);
    if (
      operationId === "GRC-GRANT-CREATE" ||
      operationId === "GRC-GRANT-APPROVE"
    )
      requireMapped(signer);
  }
  if (continuityOperations.has(operationId)) {
    requireMapped(input.pure);
    if (!input.accounting || !assessBacking(input.accounting).backed)
      add(
        "AccountingUnreconciled",
        "Source-bound reserve and hold backing must reconcile before continuity operations",
        ["SG-10", "SG-11"],
      );
    if (
      !input.baselineVesting ||
      !input.currentVesting ||
      !hasPreservedSchedule(input.baselineVesting, input.currentVesting)
    )
      add(
        "VestingContinuityUnknown",
        "Original vesting tuple and multiplicity are not preserved",
        ["SG-24"],
      );
    if (input.vestingBlockNumber === undefined)
      add(
        "VestingClockUnavailable",
        "The qualified native vesting clock must be read at the fresh anchor",
        ["SG-24"],
      );
    else if (!rotation && !input.baselineVesting?.length)
      add(
        "BaselineVestingMissing",
        "Continuation requires the original source-bound vesting schedule",
        ["SG-24"],
      );
  }
  if (
    (operationId.startsWith("GRC-GRANT-") &&
      operationId !== "GRC-GRANT-CREATE") ||
    continuityOperations.has(operationId)
  ) {
    if (
      !input.grantHistoryComplete ||
      (input.grantScope !== "EligibleSingleRound" &&
        !(rotation && input.grantScope === "Closed"))
    )
      add(
        "GrantScopeUnavailable",
        "Complete original-round history is required",
        ["SG-15", "SG-26"],
      );
    const grant = input.grant;
    if (
      !grant ||
      grant.grantee !== input.mappedPure ||
      grant.threshold !== 2 ||
      grant.milestoneCount !== 2 ||
      grant.token !== ZERO_ADDRESS ||
      grant.milestones.length !== 2
    )
      add(
        "GrantBindingChanged",
        "Grant no longer matches the supported beneficiary and policy",
        ["SG-15"],
      );
    if (grant) {
      if (
        grant.milestones.some(
          (milestone) =>
            milestone.round !== 0 ||
            milestone.metricTarget !== ZERO_ADDRESS ||
            milestone.metricSelector !== "0x00000000" ||
            milestone.metricMin !== 0n,
        )
      )
        add(
          "GrantScopeChanged",
          "A review round or unsupported metric policy changed",
          ["SG-15", "SG-26"],
        );
      if (
        operationId === "GRC-GRANT-SUBMIT-M0" ||
        operationId === "GRC-GRANT-SUBMIT-M1" ||
        operationId === "GRC-GRANT-APPROVE"
      ) {
        const index = Number(envelope.intent.parameters.index);
        const milestone = grant.milestones[index];
        if (
          !milestone ||
          milestone.state !== (operationId === "GRC-GRANT-APPROVE" ? 1 : 0) ||
          milestone.deadline < input.timeUnixSeconds
        )
          add(
            "MilestoneChanged",
            "Milestone state or deadline changed since review",
            ["SG-16", "SG-17"],
          );
      }
      if (
        continuityOperations.has(operationId) &&
        !rotation &&
        (grant.milestones[0]?.state !== 2 ||
          grant.milestones[1]?.state !== 0 ||
          grant.milestones[1].deadline < input.timeUnixSeconds)
      )
        add(
          "ContinuationUnavailable",
          "The released first milestone and open next milestone must still support the intended continuity proof",
          ["SG-15", "SG-24"],
        );
    }
  }

  const balances = new Map<string, bigint>();
  const requireFunds = (
    who: string | null,
    amount: bigint | undefined,
    reason: string,
  ): void => {
    if (!who || amount === undefined || amount < 0n) {
      add(
        "UnknownResourceRequirement",
        `${reason} requirement has not been established`,
        ["SG-14"],
      );
      return;
    }
    balances.set(who, (balances.get(who) ?? 0n) + amount);
  };
  for (const requirement of operationResourceRequirements(input))
    requireFunds(
      requirement.payer,
      requirement.amountNative,
      requirement.reason,
    );
  for (const [who, needed] of balances) {
    const state = input.accounts[who];
    if (!state)
      add("BalanceUnavailable", `Required payer ${who} has no fresh balance`, [
        "SG-14",
      ]);
    else if (
      spendable({
        ...state,
        existentialDeposit: input.existentialDepositNative,
      }) < needed
    )
      add(
        "InsufficientLiquidity",
        `Required payer ${who} lacks liquid funds for value, fees and deposits`,
        ["SG-14"],
      );
  }
  return blockers;
}
