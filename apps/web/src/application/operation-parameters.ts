import type {
  Intent,
  DataValue,
  ResourceBounds,
} from "@account-handoff/contracts";
import { parseUnits } from "@account-handoff/domain";
import {
  NativeConnection,
  hex,
  contractAddress,
  type Hex,
} from "@account-handoff/native-adapter";
import {
  encodeCreateGrant,
  encodeSubmission,
  encodeApproval,
  ZERO_ADDRESS,
} from "@account-handoff/grant-adapter";
import type { ChainView, WorkspaceRecord } from "./models";

export async function operationParameters(
  { chain, connection }: { chain: ChainView; connection: NativeConnection },
  actionId: Intent["operationId"],
  fields: Record<string, string>,
  w: WorkspaceRecord,
  signer: string,
): Promise<{
  parameters: Record<string, DataValue>;
  resources: ResourceBounds;
  abi: Hex | null;
}> {
  if (!chain || !connection) throw new Error("Network unavailable");
  const p: Record<string, DataValue> = {};
  let value = 0n;
  let abi: Hex | null = null;
  const requirePure = () => {
    if (!w.pure) throw new Error("Create and verify the Pure account first");
    return w.pure;
  };
  const role = (name: string, allowed: string[]) => {
    const r = fields[name];
    if (!r || !allowed.includes(r)) throw new Error("Select an allowed role");
    return r as keyof WorkspaceRecord["participants"];
  };
  switch (actionId) {
    case "GRC-SETUP-FUND-M0":
      value = parseUnits(
        fields["amount"] ?? "",
        chain.fingerprint.tokenDecimals,
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
        chain.fingerprint.tokenDecimals,
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
        chain.fingerprint.tokenDecimals,
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
      if (chain.localDescriptor?.contract?.address.toLowerCase() !== contract)
        throw new Error(
          "The contract must match the verified local deployment.",
        );
      const first = parseUnits(
        fields["firstAmount"] ?? "",
        chain.fingerprint.tokenDecimals,
      );
      const second = parseUnits(
        fields["secondAmount"] ?? "",
        chain.fingerprint.tokenDecimals,
      );
      value = first + second;
      const days = BigInt(fields["deadlineDays"] ?? "7");
      if (days < 1n || days > 365n)
        throw new Error("The deadline must be between 1 and 365 days away");
      const deadline =
        (await connection.currentBlockTime()) / 1000n + days * 86400n;
      const vesting = Number(fields["vestingBlocks"]);
      if (!Number.isSafeInteger(vesting) || vesting < 1 || vesting > 0xffffffff)
        throw new Error("Invalid vesting duration");
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
        throw new Error("No verified grant is available");
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
        throw new Error("Grant unavailable");
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
      const proposal = await connection.proposal(target.account, hash);
      if (!proposal || proposal.depositor !== signer)
        throw new Error(
          "Only the actual depositor of the active proposal can cancel it.",
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
    const estimate = await connection.estimateContract(
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
      estimate.storage + 10n ** BigInt(chain.fingerprint.tokenDecimals),
    );
  }
  return { parameters: p, resources, abi };
}
