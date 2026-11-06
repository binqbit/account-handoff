import { describe, expect, it, vi } from "vitest";
import { createKeyMulti } from "@polkadot/util-crypto";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import {
  createFrozenEnvelope,
  createSignedAttempt,
  exportPortable,
  sealRecord,
  semanticIntentDigest,
  type CanonicalRecord,
  type CallTree,
  type DataValue,
  type Intent,
  type NativeProposal,
  type ParticipantBindings,
  type ResourceBounds,
} from "@account-handoff/contracts";
import { planOperation } from "@account-handoff/domain";
import {
  encodeApproval,
  encodeCreateGrant,
  encodeSubmission,
} from "@account-handoff/grant-adapter";
import {
  contractAddress,
  object,
  type Hex,
  type NativeAction,
  type NativeConnection,
  type NativeFingerprint,
  type NativeAccountState,
  type NativeTx,
  type PreparedSigning,
} from "@account-handoff/native-adapter";
import { verifyWorkspaceEvidence } from "../../../apps/web/src/application/workspace-evidence";
import {
  createWorkspaceRecord,
  planHandoff,
} from "../../../apps/web/src/application/workspace-state";
import {
  nativeActionFromTree,
  buildSigningContext,
} from "../../../apps/web/src/application/record-builders";
import {
  account,
  HASH,
  DIGEST,
  evidence,
  profile,
  snapshot,
  signingContext,
} from "../../fixtures/core";

const P = account(7),
  V = `0x${"ab".repeat(20)}` as Hex;
const review = HASH as Hex,
  later = `0x${"56".repeat(32)}` as Hex;
function encoded(action: NativeAction): Hex {
  // Deterministic codec boundary. Real SCALE encoding belongs to adapter qualification.
  return u8aToHex(
    new TextEncoder().encode(
      JSON.stringify(action, (_key, value: unknown) =>
        typeof value === "bigint" ? value.toString() : value,
      ),
    ),
  );
}
function abi(tree: CallTree): Hex {
  const p = object(tree.parameters);
  if (tree.method.startsWith("submitMilestone"))
    return encodeSubmission(
      BigInt(String(p["grantId"])),
      Number(p["index"]),
      String(p["evidence"]),
    );
  if (tree.method.startsWith("approveMilestone"))
    return encodeApproval(BigInt(String(p["grantId"])), Number(p["index"]));
  return encodeCreateGrant(
    String(p["grantee"]) as Hex,
    p["reviewers"] as Hex[],
    (p["inputs"] as Record<string, string>[]).map((row) => ({
      amount: BigInt(row["amount"]!),
      deadline: BigInt(row["deadline"]!),
      vestingBlocks: Number(row["vestingBlocks"]),
      metricTarget: row["metricTarget"] as Hex,
      metricSelector: row["metricSelector"] as Hex,
      metricMin: BigInt(row["metricMin"]!),
    })),
  );
}
async function harness(hasPure = false) {
  const w = createWorkspaceRecord(
    {
      name: "Evidence context",
      oldMembers: [account(1), account(2), account(3)],
      threshold: 2,
      funder: account(4),
      reviewers: [account(5), account(6)],
    },
    "DEMO",
    HASH as Hex,
  );
  if (hasPure) {
    w.pure = P;
    w.contract = V;
    w.grantId = "0";
  }
  const p = await sealRecord({ ...(await profile()), genesis: HASH });
  const s = await snapshot(p);
  const fingerprint: NativeFingerprint = {
    genesis: HASH as Hex,
    specName: "fixture",
    specVersion: 1,
    transactionVersion: 1,
    metadataVersion: 14,
    metadataHash: HASH as Hex,
    metadataSha256: DIGEST,
    rawMetadata: "0x00",
    runtimeCodeHash: HASH as Hex,
    signedExtensions: [],
    runtimeApis: {},
    anchor: { hash: review, number: 10 },
    tokenDecimals: 14,
    tokenSymbol: "UNIT",
    ss58Prefix: 42,
  };
  const connection = {
    fingerprint: vi.fn(async (hash: Hex = review) => ({
      ...fingerprint,
      anchor: { hash, number: hash === later ? 11 : 10 },
    })),
    api: {
      rpc: {
        chain_getBlockHash: vi.fn(async (number: number) =>
          number === 11 ? later : review,
        ),
      },
    },
    readAccount: vi.fn(
      async (
        _address: string,
        _hash?: Hex,
      ): Promise<Pick<NativeAccountState, "proxies">> => ({
        proxies: [],
      }),
    ),
    transaction: vi.fn(
      (action: NativeAction) => ({ callHex: encoded(action) }) as NativeTx,
    ),
  };
  const native = connection as unknown as NativeConnection;
  const current = { ...fingerprint, anchor: { hash: later, number: 11 } };
  async function operation(
    operationId: Intent["operationId"] = "GRC-SETUP-FUND-M0",
    parameters: Record<string, DataValue> = {
      recipient: w.M0.account,
      valueNative: "10",
    },
    participants: ParticipantBindings = { ...w.participants, S: account(9) },
    resources: ResourceBounds = {
      valueNative: "10",
      reviveWeight: null,
      storageDepositLimitNative: null,
      multisigInnerMaxWeight: null,
      outerFeeEstimateNative: "1",
      outerFeeLocalBudgetNative: "2",
      feeBudgetIsChainEnforcedCap: false,
      estimationEvidence: [],
    },
  ) {
    const M0 = {
      ...w.M0,
      account: u8aToHex(
        createKeyMulti([participants.A, participants.B, participants.C], 2),
      ),
      members: [participants.A, participants.B, participants.C].sort(),
    };
    const M1 = participants.D
      ? {
          ...M0,
          account: u8aToHex(
            createKeyMulti([participants.A, participants.B, participants.D], 2),
          ),
          members: [participants.A, participants.B, participants.D].sort(),
          role: "M1" as const,
        }
      : null;
    const intent: Intent = {
      intentId: crypto.randomUUID(),
      intentRevision: "1",
      operationId,
      profileId: p.profileId,
      profileDigest: p.digest,
      authorActor:
        operationId.startsWith("GRC-SETUP-FUND") ||
        operationId === "GRC-VESTING-VEST-OTHER"
          ? participants.S
          : operationId === "GRC-GRANT-CREATE"
            ? participants.F
            : operationId === "GRC-SETUP-MAP-ACTOR"
              ? String(parameters["account"])
              : operationId === "GRC-GRANT-APPROVE"
                ? participants.R1
                : operationId === "GRC-MULTISIG-CANCEL"
                  ? String(parameters["originalDepositor"])
                  : participants.A,
      parameters,
      expectedState: {
        snapshotDigest: s.digest,
        authority: "NotApplicable",
        grantContext: null,
        localReviewExpiresAtUnixSeconds: "1000",
        localExpiryRevokesNativeProposal: false,
      },
      supersedesIntentId: null,
    };
    const plan = planOperation(intent, {
      participants,
      M0,
      M1,
      pure: w.pure,
      resources,
      sourceEvidence: [evidence],
      encodeAbi: abi,
      ...(w.pure ? { mappedPure: contractAddress(w.pure) } : {}),
      nativeToAbiRatio: 10000n,
    });
    const inner = nativeActionFromTree(plan.callTree),
      innerBytes = encoded(inner);
    const e = await createFrozenEnvelope({
      intent,
      anchor: s.anchor,
      plan,
      innerRuntimeCallBytes: innerBytes,
      innerRuntimeCallHash: plan.controller ? blake2AsHex(innerBytes) : null,
      resources,
      summaryText: "Declared operation",
      requiredGateIds: ["Q-RUNTIME"],
      participants,
      evidence: [evidence],
    });
    return { e, inner, participants, plan };
  }
  async function attempt(
    op: Awaited<ReturnType<typeof operation>>,
    phase: "direct" | "cancel" | "multisig_first" | "multisig_final" = "direct",
    proposal?: NativeProposal,
    genesis = HASH,
    signerOverride?: string,
  ) {
    const signer =
      signerOverride ??
      (phase === "multisig_final"
        ? op.plan.requiredSigners[1]!
        : op.plan.requiredSigners[0]!);
    let action = op.inner;
    if (op.plan.controller) {
      const weight = op.e.resources.multisigInnerMaxWeight!;
      action = {
        kind: "multisig",
        threshold: 2,
        others: op.plan.controller.members.filter(
          (member) => member !== signer,
        ),
        timepoint: proposal?.timepoint
          ? {
              height: Number(proposal.timepoint.height),
              index: Number(proposal.timepoint.index),
            }
          : undefined,
        inner: op.inner,
        weight: {
          refTime: BigInt(weight.refTime),
          proofSize: BigInt(weight.proofSize),
        },
      };
    }
    const outer = encoded(action);
    const base = await signingContext(op.e);
    const payload = JSON.parse(
      base.originalSignPayloadJcsUtf8,
    ) as PreparedSigning["payload"];
    Object.assign(payload, {
      address: signer,
      method: outer,
      genesisHash: genesis,
    });
    const context = await buildSigningContext(
      {
        payload,
        signer: signer as Hex,
        callHex: outer,
        callHash: blake2AsHex(outer),
        rawPayload: "0x00",
        encodedExtra: "0x00",
        additionalSigned: "0x",
        extra: [],
        createdAt: 10,
        fingerprint: { ...fingerprint, genesis: genesis as Hex },
      },
      "fixture-wallet",
      phase,
      proposal?.digest ?? null,
    );
    return createSignedAttempt({
      envelope: op.e,
      context,
      bytes: "0x0400",
      hash: blake2AsHex("0x0400"),
    });
  }
  async function verify(records: CanonicalRecord[]) {
    const portable = await exportPortable(records);
    await verifyWorkspaceEvidence(portable.records, w, native, current);
  }
  return { w, p, s, connection, native, current, operation, attempt, verify };
}
const multisigResources: ResourceBounds = {
  valueNative: "0",
  reviveWeight: null,
  storageDepositLimitNative: null,
  multisigInnerMaxWeight: { refTime: "4", proofSize: "2" },
  outerFeeEstimateNative: "1",
  outerFeeLocalBudgetNative: "2",
  feeBudgetIsChainEnforcedCap: false,
  estimationEvidence: [],
};

describe("independent workspace evidence context", () => {
  it("accepts profile-only restoration without fabricating any chain action", async () => {
    const h = await harness();
    await h.verify([h.p]);
    expect(h.connection.transaction).not.toHaveBeenCalled();
  });
  it("reconstructs a direct setup transfer and exact outer call while allowing an explicit sponsor", async () => {
    const h = await harness(),
      op = await h.operation();
    const a = await h.attempt(op);
    await h.verify([h.p, h.s, op.e, a]);
    expect(h.connection.transaction).toHaveBeenCalledWith({
      kind: "transfer",
      destination: h.w.M0.account,
      amount: 10n,
    });
  });
  it("keeps precreation null-Pure snapshots importable after a Pure exists", async () => {
    const h = await harness(true),
      op = await h.operation();
    expect(h.s.pure).toBeNull();
    await h.verify([h.p, h.s, op.e]);
  });
  it("rejects self-consistent foreign setup members and same-network sponsor transfers", async () => {
    const h = await harness();
    const participants = {
      ...h.w.participants,
      A: account(10),
      B: account(11),
      C: account(12),
      S: account(9),
    };
    const recipient = u8aToHex(
      createKeyMulti([participants.A, participants.B, participants.C], 2),
    );
    const op = await h.operation(
      "GRC-SETUP-FUND-M0",
      { recipient, valueNative: "10" },
      participants,
    );
    await expect(h.verify([h.p, h.s, op.e])).rejects.toThrow(
      "controller differs",
    );
  });
  it("rejects an actor-role declaration changed to a foreign funder", async () => {
    const h = await harness();
    const participants = { ...h.w.participants, F: account(10), S: account(9) };
    const op = await h.operation(
      "GRC-SETUP-FUND-ACTOR",
      { recipientRole: "F", recipient: participants.F, valueNative: "10" },
      participants,
    );
    await expect(h.verify([h.p, h.s, op.e])).rejects.toThrow(
      "funder or reviewer",
    );
  });
  it("rejects a foreign vesting target even with valid structural integrity", async () => {
    const h = await harness(true),
      own = h.w.pure;
    h.w.pure = account(10);
    const op = await h.operation(
      "GRC-VESTING-VEST-OTHER",
      { targetPure: account(10) },
      undefined,
      { ...multisigResources, multisigInnerMaxWeight: null },
    );
    h.w.pure = own;
    await expect(h.verify([h.p, h.s, op.e])).rejects.toThrow(
      "another beneficiary",
    );
  });
  it("rejects valid intent bytes replaced with another native call", async () => {
    const h = await harness(),
      op = await h.operation();
    const changed = {
      ...op.e,
      innerRuntimeCallBytes: "0xdead",
    };
    changed.semanticIntentDigest = await semanticIntentDigest(changed);
    await expect(
      h.verify([h.p, h.s, await sealRecord(changed)]),
    ).rejects.toThrow("native inner bytes");
  });
  it("rejects an exact signing context for a different network", async () => {
    const h = await harness(),
      op = await h.operation();
    const a = await h.attempt(op, "direct", undefined, `0x${"ff".repeat(32)}`);
    await expect(h.verify([h.p, h.s, op.e, a])).rejects.toThrow(
      "another network or signer",
    );
  });
  it("rejects a noncanonical historical checkpoint before decoding its operation", async () => {
    const h = await harness(),
      op = await h.operation();
    h.connection.api.rpc.chain_getBlockHash.mockResolvedValue(later);
    await expect(h.verify([h.p, h.s, op.e])).rejects.toThrow(
      "canonical and finalized",
    );
  });
  it("reconstructs a first multisig approval using its declared inner weight", async () => {
    const h = await harness(),
      op = await h.operation(
        "GRC-SETUP-CREATE-PURE",
        { pureIndex: "0", proxyType: "Any", delay: "0" },
        undefined,
        multisigResources,
      );
    const a = await h.attempt(op, "multisig_first");
    await h.verify([h.p, h.s, op.e, a]);
  });
  it("binds the exact final multisig incarnation to its envelope and reconstructs the final wrapper", async () => {
    const h = await harness(),
      op = await h.operation(
        "GRC-SETUP-CREATE-PURE",
        { pureIndex: "0", proxyType: "Any", delay: "0" },
        undefined,
        multisigResources,
      );
    const proposal = await sealRecord<NativeProposal>({
      schemaVersion: "2",
      kind: "NativeProposal",
      recordId: "proposal",
      digest: "",
      profileId: h.p.profileId,
      profileDigest: h.p.digest,
      multisig: op.plan.controller!.account,
      innerCallHash: op.e.innerRuntimeCallHash!,
      state: "present",
      timepoint: {
        height: "9",
        index: "1",
        clockDomain: "native-block-number",
      },
      depositor: op.plan.requiredSigners[0]!,
      approvals: [op.plan.requiredSigners[0]!],
      depositNative: "1",
      anchor: h.s.anchor,
      evidence: [evidence],
      derivedFromRecordDigest: null,
      localContractRevision: "grc-v2-local-1",
    });
    const a = await h.attempt(op, "multisig_final", proposal);
    await h.verify([h.p, h.s, op.e, proposal, a]);
  });
  it("rejects a proposal with no associated workspace call preimage", async () => {
    const h = await harness();
    const proposal = await sealRecord<NativeProposal>({
      schemaVersion: "2",
      kind: "NativeProposal",
      recordId: "orphan",
      digest: "",
      profileId: h.p.profileId,
      profileDigest: h.p.digest,
      multisig: h.w.M0.account,
      innerCallHash: HASH,
      state: "present",
      timepoint: {
        height: "9",
        index: "1",
        clockDomain: "native-block-number",
      },
      depositor: account(1),
      approvals: [account(1)],
      depositNative: "1",
      anchor: h.s.anchor,
      evidence: [evidence],
      derivedFromRecordDigest: null,
      localContractRevision: "grc-v2-local-1",
    });
    await expect(h.verify([h.p, proposal])).rejects.toThrow(
      "no associated workspace call",
    );
  });

  it("rejects a native call tree that disagrees with a self-consistent declared intent", async () => {
    const h = await harness(),
      op = await h.operation();
    const callTree = structuredClone(op.e.callTree);
    Object.assign(callTree.parameters, { dest: account(10) });
    const changed = {
      ...op.e,
      callTree,
      innerRuntimeCallBytes: encoded({
        kind: "transfer",
        destination: account(10),
        amount: 10n,
      }),
    };
    changed.semanticIntentDigest = await semanticIntentDigest(changed);
    await expect(
      h.verify([h.p, h.s, await sealRecord(changed)]),
    ).rejects.toThrow("call tree differs");
  });

  it("rejects funding another controller while retaining the workspace's declared members", async () => {
    const h = await harness(),
      op = await h.operation();
    const callTree = structuredClone(op.e.callTree);
    Object.assign(callTree.parameters, { dest: account(10) });
    const changed = {
      ...op.e,
      intent: {
        ...op.e.intent,
        parameters: { ...op.e.intent.parameters, recipient: account(10) },
      },
      callTree,
      innerRuntimeCallBytes: encoded({
        kind: "transfer",
        destination: account(10),
        amount: 10n,
      }),
    };
    changed.semanticIntentDigest = await semanticIntentDigest(changed);
    await expect(
      h.verify([h.p, h.s, await sealRecord(changed)]),
    ).rejects.toThrow("exact original controller");
  });

  it("rejects a different signed outer call even when its context is internally consistent", async () => {
    const h = await harness(),
      op = await h.operation();
    const a = await h.attempt({
      ...op,
      inner: { kind: "transfer", destination: account(10), amount: 10n },
    });
    await expect(h.verify([h.p, h.s, op.e, a])).rejects.toThrow(
      "signed outer call differs",
    );
  });

  it("keeps the designated first signer distinct from another valid group member", async () => {
    const h = await harness(),
      op = await h.operation(
        "GRC-SETUP-CREATE-PURE",
        { pureIndex: "0", proxyType: "Any", delay: "0" },
        undefined,
        multisigResources,
      );
    const a = await h.attempt(
      op,
      "multisig_first",
      undefined,
      HASH,
      op.plan.requiredSigners[1],
    );
    await expect(h.verify([h.p, h.s, op.e, a])).rejects.toThrow(
      "designated phase signer",
    );
  });

  it("reconstructs the original grant creation ABI using the independently selected deployment", async () => {
    const h = await harness(true);
    h.w.grantId = null;
    const milestones = [
      {
        amount: "10000",
        deadline: "1900000000",
        vestingBlocks: "20",
        metricTarget: `0x${"00".repeat(20)}`,
        metricSelector: "0x00000000",
        metricMin: "0",
      },
      {
        amount: "20000",
        deadline: "1900001000",
        vestingBlocks: "0",
        metricTarget: `0x${"00".repeat(20)}`,
        metricSelector: "0x00000000",
        metricMin: "0",
      },
    ];
    const op = await h.operation(
      "GRC-GRANT-CREATE",
      {
        contract: V,
        granteeH160: contractAddress(P),
        token: `0x${"00".repeat(20)}`,
        reviewers: [
          contractAddress(h.w.participants.R1),
          contractAddress(h.w.participants.R2),
        ],
        threshold: "2",
        milestones,
      },
      undefined,
      {
        ...multisigResources,
        valueNative: "3",
        reviveWeight: { refTime: "10", proofSize: "10" },
        storageDepositLimitNative: "0",
        multisigInnerMaxWeight: null,
      },
    );
    await h.verify([h.p, h.s, op.e]);
    const foreign = {
      ...op.e,
      intent: {
        ...op.e.intent,
        parameters: {
          ...op.e.intent.parameters,
          contract: `0x${"cd".repeat(20)}`,
        },
      },
    };
    foreign.semanticIntentDigest = await semanticIntentDigest(foreign);
    await expect(
      h.verify([h.p, h.s, await sealRecord(foreign)]),
    ).rejects.toThrow("another contract deployment");
  });

  it("requires historical groups to be actual Any/0 proxies at a canonical associated checkpoint", async () => {
    const h = await harness(true);
    const currentGroup = createWorkspaceRecord(
      {
        name: "Current group",
        oldMembers: [account(1), account(2), account(10)],
        threshold: 2,
        funder: account(4),
        reviewers: [account(5), account(6)],
      },
      "DEMO",
      HASH as Hex,
    );
    h.w.M0 = currentGroup.M0;
    const participants = { ...h.w.participants, C: account(11), S: account(9) };
    const historical = u8aToHex(
      createKeyMulti([participants.A, participants.B, participants.C], 2),
    );
    const op = await h.operation(
      "GRC-SETUP-FUND-M0",
      { recipient: historical, valueNative: "10" },
      participants,
    );
    h.connection.readAccount.mockResolvedValue({
      proxies: [{ delegate: historical, proxyType: "Any", delay: 0 }],
    });
    await h.verify([h.p, h.s, op.e]);
    expect(h.connection.readAccount).toHaveBeenCalledWith(P, review);
  });

  it.each([
    ["absent", []],
    [
      "delayed",
      [
        {
          delegate: u8aToHex(
            createKeyMulti([account(1), account(2), account(11)], 2),
          ),
          proxyType: "Any",
          delay: 1,
        },
      ],
    ],
    [
      "restricted",
      [
        {
          delegate: u8aToHex(
            createKeyMulti([account(1), account(2), account(11)], 2),
          ),
          proxyType: "NonTransfer",
          delay: 0,
        },
      ],
    ],
  ] as const)(
    "rejects a claimed historical controller whose actual proxy is %s",
    async (_label, proxies) => {
      const h = await harness(true);
      const participants = {
        ...h.w.participants,
        C: account(11),
        S: account(9),
      };
      const historical = u8aToHex(
        createKeyMulti([participants.A, participants.B, participants.C], 2),
      );
      const op = await h.operation(
        "GRC-SETUP-FUND-M0",
        { recipient: historical, valueNative: "10" },
        participants,
      );
      h.connection.readAccount.mockResolvedValue({ proxies: [...proxies] });
      await expect(h.verify([h.p, h.s, op.e])).rejects.toThrow(
        "no independently verified authority",
      );
    },
  );

  it("proves a former planned group at the later actual proxy checkpoint without trusting record timestamps", async () => {
    const h = await harness(true);
    const participants = { ...h.w.participants, D: account(11), S: account(9) };
    const historical = u8aToHex(
      createKeyMulti([participants.A, participants.B, participants.D], 2),
    );
    const op = await h.operation(
      "GRC-ROTATION-ADD-M1",
      {
        pure: P,
        oldController: h.w.M0.account,
        newController: historical,
        proxyType: "Any",
        delay: "0",
      },
      participants,
      multisigResources,
    );
    const after = await sealRecord({
      ...h.s,
      recordId: "after-historical-add",
      pure: P,
      anchor: { ...h.s.anchor, blockHash: later, blockNumber: "11" },
      authority: {
        ...h.s.authority,
        state: "DualControl" as const,
        tuples: [
          {
            delegate: h.w.M0.account,
            proxyType: "Any" as const,
            delay: "0" as const,
          },
          {
            delegate: historical,
            proxyType: "Any" as const,
            delay: "0" as const,
          },
        ],
      },
    });
    h.connection.readAccount.mockImplementation(async (_address, hash) => ({
      proxies:
        hash === later
          ? [{ delegate: historical, proxyType: "Any", delay: 0 }]
          : [],
    }));
    await h.verify([h.p, h.s, after, op.e]);
    expect(h.connection.readAccount).toHaveBeenCalledWith(P, later);
  });

  it.each([
    "GRC-SETUP-FUND-P",
    "GRC-SETUP-MAP-P",
    "GRC-SETUP-MAP-ACTOR",
    "GRC-ROTATION-REMOVE-M0",
    "GRC-GRANT-SUBMIT-M0",
    "GRC-GRANT-SUBMIT-M1",
    "GRC-GRANT-APPROVE",
    "GRC-MULTISIG-CANCEL",
  ] as const)(
    "reconstructs the supported %s route without restoring an approval",
    async (operationId) => {
      const h = await harness(true);
      Object.assign(
        h.w,
        planHandoff(h.w, [account(1), account(2), account(8)]),
      );
      let parameters: Record<string, DataValue>;
      let resources: ResourceBounds = {
        ...multisigResources,
        multisigInnerMaxWeight: null,
      };
      if (operationId === "GRC-SETUP-FUND-P") {
        parameters = { pure: P, valueNative: "10" };
        resources.valueNative = "10";
      } else if (operationId === "GRC-SETUP-MAP-P") {
        parameters = { pure: P };
        resources = multisigResources;
      } else if (operationId === "GRC-SETUP-MAP-ACTOR") {
        parameters = { actorRole: "R1", account: h.w.participants.R1 };
      } else if (operationId === "GRC-ROTATION-REMOVE-M0") {
        parameters = {
          pure: P,
          oldController: h.w.M0.account,
          newController: h.w.M1!.account,
          proxyType: "Any",
          delay: "0",
        };
        resources = multisigResources;
      } else if (operationId === "GRC-MULTISIG-CANCEL") {
        parameters = {
          targetController: { ...h.w.M0 } as unknown as DataValue,
          targetCallHash: HASH,
          targetTimepoint: {
            height: "9",
            index: "1",
            clockDomain: "native-block-number",
          },
          originalDepositor: h.w.participants.A,
          targetEnvelopeDigest: null,
          originalTargetCallBytes: null,
        };
      } else {
        parameters = {
          contract: V,
          grantId: "0",
          index: operationId === "GRC-GRANT-SUBMIT-M1" ? "1" : "0",
          ...(operationId === "GRC-GRANT-APPROVE"
            ? {}
            : { evidence: "Public work evidence" }),
        };
        resources = {
          ...multisigResources,
          reviveWeight: { refTime: "10", proofSize: "10" },
          storageDepositLimitNative: "0",
          multisigInnerMaxWeight:
            operationId === "GRC-GRANT-APPROVE"
              ? null
              : multisigResources.multisigInnerMaxWeight,
        };
      }
      const op = await h.operation(
        operationId,
        parameters,
        undefined,
        resources,
      );
      await h.verify([h.p, h.s, op.e]);
    },
  );

  it("does not let an unrelated cancellation controller hide behind different declared member roles", async () => {
    const h = await harness(true);
    const previous = h.w.creator!;
    const next = createWorkspaceRecord(
      {
        name: "New controller",
        oldMembers: [account(1), account(2), account(10)],
        threshold: 2,
        funder: account(4),
        reviewers: [account(5), account(6)],
      },
      "DEMO",
      HASH as Hex,
    );
    h.w.M0 = next.M0;
    h.w.participants = next.participants;
    const op = await h.operation(
      "GRC-MULTISIG-CANCEL",
      {
        targetController: { ...previous } as unknown as DataValue,
        targetCallHash: HASH,
        targetTimepoint: {
          height: "9",
          index: "1",
          clockDomain: "native-block-number",
        },
        originalDepositor: account(1),
        targetEnvelopeDigest: null,
        originalTargetCallBytes: null,
      },
      undefined,
      { ...multisigResources, multisigInnerMaxWeight: null },
    );
    await expect(h.verify([h.p, h.s, op.e])).rejects.toThrow(
      "declared controller roles",
    );
  });
});
