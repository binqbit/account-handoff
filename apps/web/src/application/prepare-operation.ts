import { blake2AsHex } from "dedot/utils";
import {
  createSnapshot,
  createFrozenEnvelope,
  canonicalJson,
  sha256,
  sealRecord,
  OPERATION_REQUIREMENTS,
} from "@account-handoff/contracts";
import type {
  Intent,
  GrantFlowScope,
  FrozenEnvelope,
  NativeProposal,
  GrantContext,
} from "@account-handoff/contracts";
import {
  planOperation,
  classifyAuthority,
  otherSignatories,
  OPERATION_IDS,
} from "@account-handoff/domain";
import {
  NativeConnection,
  hex,
  contractAddress,
} from "@account-handoff/native-adapter";
import { type WalletSession } from "@account-handoff/wallet-adapter";
import { type GrantHistory } from "@account-handoff/grant-adapter";
import { type Journal } from "@account-handoff/local-store";
import type { ChainView, WorkspaceRecord, PendingOperation } from "./models";
import { actionViews } from "./presentation";
import {
  buildReadAnchor,
  buildSigningContext,
  nativeActionFromTree,
} from "./record-builders";
import { buildResourceReview } from "./resources";
import { completePreparationSnapshot } from "./qualification";
import { id, json } from "./values";
import { operationParameters } from "./operation-parameters";
import { loadOperationInputs } from "./operation-inputs";
import { accountingLedger } from "./accounting";
export interface PreparationContext {
  selected: { address: string; source: string };
  chain: ChainView;
  connection: NativeConnection;
  journal: Journal;
  workspace: WorkspaceRecord;
  wallets: WalletSession[];
  tabId: string;
  grantHistory: GrantHistory | null;
}
export async function prepareOperation(
  {
    selected,
    chain,
    connection,
    journal,
    workspace: w,
    wallets,
    tabId,
    grantHistory,
  }: PreparationContext,
  actionId: string,
  fields: Record<string, string>,
): Promise<PendingOperation> {
  if (chain.profile.status !== "accepted")
    throw new Error(
      "A qualified LOCAL build with exact native types is required.",
    );
  const view = actionViews(w, chain, selected.address).find(
    (a) => a.id === actionId,
  );
  if (!view?.enabled)
    throw new Error(view?.blockers.join("; ") ?? "Operation unavailable");
  if (!(OPERATION_IDS as readonly string[]).includes(actionId))
    throw new Error("Unsupported operation");
  const operationId = actionId as Intent["operationId"];
  const { parameters, resources, abi } = await operationParameters(
    { chain, connection },
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
      "The Pure account has unexpected permissions. Reconcile the full delegate inventory.",
    );
  if (
    operationId.startsWith("GRC-GRANT-") &&
    operationId !== "GRC-GRANT-CREATE" &&
    (!grantHistory?.complete || grantHistory.scope !== "EligibleSingleRound")
  )
    throw new Error(
      "Complete history of the original grant round is required.",
    );
  const scope: GrantFlowScope = {
    policyId: "vestry-single-round-demo-v1",
    status: grantHistory?.scope ?? "Unverified",
    grantId: w.grantId,
    observedRounds: grantHistory?.rounds.map(String) ?? [],
    historyComplete: grantHistory?.complete ?? false,
    blockingReasons: grantHistory?.blockers ?? [],
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
  await journal.appendRecord(snapshot);
  let grantContext: GrantContext | null = null;
  if (
    operationId.startsWith("GRC-GRANT-") &&
    operationId !== "GRC-GRANT-CREATE"
  ) {
    const index = String(parameters["index"]);
    const milestone = chain.grant?.milestones[Number(index)];
    if (!milestone || !w.grantId || !["0", "1"].includes(index))
      throw new Error("Current grant milestone context is unavailable");
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
  const oldEnvelopes = (await journal.listRecords(
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
        throw new Error(
          "The active proposal belongs to a different runtime profile.",
        );
      if (canonicalJson(old.intent.parameters) !== canonicalJson(parameters))
        throw new Error(
          "The active multisig proposal has different contents. Reconcile or cancel it before creating another.",
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
          ? "The designated second signer must perform the final action."
          : "The designated first signer must perform the first action.",
      );
    if (proposal) {
      if (
        proposal.depositor !== plan.requiredSigners[0] ||
        proposal.approvals.length !== 1 ||
        proposal.approvals[0] !== plan.requiredSigners[0]
      )
        throw new Error(
          "The proposal does not confirm the expected first approval by A.",
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
      await journal.appendRecord(record);
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
    throw new Error("The current account does not have the required role.");
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
      "The signer has insufficient available balance for the value and fee.",
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
      throw new Error("Refreshing the review changed the immutable intent.");
    envelope = await sealRecord({
      ...refreshed,
      derivedFromRecordDigest: original.digest,
    });
    await journal.sealEnvelope(envelope);
  } else {
    envelope = await createFrozenEnvelope({
      intent,
      anchor,
      plan,
      innerRuntimeCallBytes: innerTx.callHex,
      innerRuntimeCallHash: plan.controller ? innerHash : null,
      resources,
      summaryText: view.title,
      requiredGateIds: [...OPERATION_REQUIREMENTS[operationId].requiredGateIds],
      participants,
      evidence: chain.profile.sourceEvidence,
    });
    await journal.sealEnvelope(envelope);
  }
  const prepared = await connection.prepareSigning(tx, selected.address);
  const context = await buildSigningContext(
    prepared,
    `${selected.source}:${wallets.find((s) => s.source === selected.source)?.version ?? "unknown"}`,
    phase,
    proposalDigest,
  );
  const freshInput = await loadOperationInputs(
    {
      connection,
      chain,
      workspace: w,
      accounting: (f, accounts) =>
        accountingLedger(w, chain, connection, f, accounts),
    },
    {
      envelope,
      action,
      signer: selected.address,
      phase,
      actionId: operationId,
    },
    chain.fingerprint,
  );
  const qualification = await completePreparationSnapshot({
    profile: chain.profile,
    snapshot,
    envelope,
    freshInput,
    signingContext: context,
    wallet:
      wallets.find((session) => session.source === selected.source) ?? null,
  });
  if (qualification.blockers.length)
    throw new Error(
      qualification.blockers.map((blocker) => blocker.message).join("; "),
    );
  await journal.appendRecord(qualification.snapshot);
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
  if (qualifiedEnvelope.semanticIntentDigest !== envelope.semanticIntentDigest)
    throw new Error("Qualification changed the operation intent.");
  envelope = await sealRecord({
    ...qualifiedEnvelope,
    derivedFromRecordDigest: envelope.digest,
  });
  await journal.sealEnvelope(envelope);
  const lease = await journal.acquireLease(`operation:${w.id}`, tabId, 300000);
  if (!lease) throw new Error("Another tab controls this operation.");
  return {
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
        ? ["Signer", "Native runtime"]
        : [
            "Signer",
            "Multisig",
            ...(plan.signingPath === "multisig_proxy" ? ["Proxy → Pure"] : []),
            "Native runtime",
          ],
    resources: buildResourceReview(freshInput, {
      decimals: chain.fingerprint.tokenDecimals,
      symbol: chain.fingerprint.tokenSymbol,
    }),
  };
}
