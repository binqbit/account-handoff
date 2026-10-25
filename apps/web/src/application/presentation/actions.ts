import {
  OPERATION_REQUIREMENTS,
  type EnabledOperationId,
  type GateId,
} from "@account-handoff/contracts";
import type { ActionView, OperationField } from "../../ui-contract";
import type { ChainView, WorkspaceRecord } from "../models";
import testnet from "../../../../../infra/testnet/network.json";
import { proof } from "./continuity";
import {
  authority,
  eq,
  mapped,
  stateFor,
  roleNames,
  type ParticipantRole,
} from "./shared";

const profileGates = new Set<GateId>([
  "Q-RUNTIME",
  "Q-CURRENCY",
  "Q-MAPPING",
  "Q-REVIVE-API",
  "Q-VESTING",
  "Q-CONTRACT",
  "Q-ADAPTER",
  "Q-RECEIPTS",
]);
function roles(
  workspace: WorkspaceRecord,
  keys: ParticipantRole[],
): { value: string; label: string; detail: string }[] {
  return keys
    .filter((role) => workspace.participants[role] !== null)
    .map((role) => ({
      value: role,
      label: `${roleNames[role]} · ${workspace.participants[role]!.slice(0, 8)}…${workspace.participants[role]!.slice(-6)}`,
      detail: workspace.participants[role]!,
    }));
}
function amountField(symbol: string): OperationField {
  return {
    name: "amount",
    label: `Amount (${symbol})`,
    type: "number",
    inputMode: "decimal",
    required: true,
    placeholder: "0.00",
    help: "Decimal amount in network tokens. Exact native units and the fee are shown before signing.",
  };
}
function roleField(
  workspace: WorkspaceRecord,
  name: string,
  label: string,
  keys: ParticipantRole[],
  initial?: string,
): OperationField {
  return {
    name,
    label,
    type: "select",
    required: true,
    options: roles(workspace, keys),
    value: initial ?? keys[0]!,
    help: "Choose the participant by role and verify their address below. This does not switch your signing account.",
  };
}
export function actionViews(
  workspace: WorkspaceRecord | null,
  chain: ChainView | null,
  selectedSigner: string | null,
): ActionView[] {
  if (!workspace) return [];
  const symbol = chain?.fingerprint.tokenSymbol ?? "native";
  const isPortalDotTestnet =
    workspace.mode === "DEMO" && workspace.genesis === testnet.genesisHash;
  const current = authority(workspace, chain);
  const actorState = stateFor(chain, selectedSigner);
  const pureState = stateFor(chain, workspace.pure);
  const selectedRoles = (
    Object.entries(workspace.participants) as [ParticipantRole, string][]
  )
    .filter(([, address]) => eq(address, selectedSigner))
    .map(([role]) => role);
  const oldMember = workspace.M0.members.some((member) =>
    eq(member, selectedSigner),
  );
  const newMember = workspace.M1?.members.some((member) =>
    eq(member, selectedSigner),
  );
  const common: string[] = [];
  if (!chain) common.push("Connect to the network and read finalized state.");
  if (chain && chain.profile.status !== "accepted")
    common.push(
      "The network profile is blocked or stale. Reconciliation is required.",
    );
  if (!selectedSigner)
    common.push("Connect a wallet and select a personal account.");
  if (chain && !eq(chain.fingerprint.genesis, workspace.genesis))
    common.push("The workspace belongs to another network.");
  if (
    chain &&
    ((workspace.mode === "LOCAL" && chain.localDescriptor?.mode !== "LOCAL") ||
      (workspace.mode !== "LOCAL" && chain.localDescriptor))
  )
    common.push("The environment profile does not match the workspace.");
  if (chain?.localDescriptor?.status === "retired")
    common.push("The local run has ended. A current runId is required.");
  if (selectedSigner && chain && !actorState)
    common.push("The selected signer's budget has not been read yet.");
  if (actorState && actorState.free <= actorState.frozen)
    common.push(
      "The selected signer has no known available funds for the fee.",
    );
  const requireOld = (): string[] => [
    ...(!oldMember ? ["A signer from the current group is required."] : []),
    ...(!["M0", "DualControl"].includes(current)
      ? ["The current group’s authority is not verified."]
      : []),
  ];
  const requireNew = (): string[] => [
    ...(!newMember ? ["A signer from the replacement group is required."] : []),
    ...(!["M1", "DualControl"].includes(current)
      ? ["The replacement group’s authority is not verified."]
      : []),
  ];
  const requirePure = (): string[] =>
    !workspace.pure
      ? ["Create and verify beneficiary P first."]
      : workspace.creationEvidence.some(
            (entry) =>
              entry.kind === "native_chain" &&
              /^0x[0-9a-f]{64}\/\d+$/.test(entry.locator) &&
              /^0x[0-9a-f]{64}$/.test(entry.sourceId ?? ""),
          )
        ? []
        : ["Pure provenance must be verified from a PureCreated event."];
  const requireMapping = (): string[] =>
    mapped(pureState)
      ? []
      : ["Verified persistent mapping P → h(P) → P is required."];
  const requireGrant = (): string[] =>
    workspace.grantId !== null && workspace.contract && chain?.grant
      ? requirePure()
      : ["Create or verify a grant for beneficiary P first."];
  const grant = chain?.grant;
  const milestone = (index: number) => grant?.milestones[index];
  const requireOpen = (index: number): string[] => {
    const value = milestone(index);
    if (!value) return ["The milestone state has not been read yet."];
    return value.state === 0 && value.round === 0
      ? []
      : [
          "An open milestone in its initial round is required. Resubmission is unsupported.",
        ];
  };
  const directRole = selectedRoles.find((role) =>
    ["F", "R1", "R2"].includes(role),
  );
  const fields: OperationField[] = [
    {
      name: "contract",
      label: "Deployed Vestry contract address",
      type: "contract",
      required: true,
      value: workspace.contract ?? "",
      help: "Paste the deployed Vestry contract address on this network: 0x followed by 40 hexadecimal characters. This is not a personal wallet address.",
    },
    {
      name: "firstAmount",
      label: `First tranche (${symbol})`,
      type: "number",
      inputMode: "decimal",
      required: true,
      value: isPortalDotTestnet ? "10" : "18",
      help: isPortalDotTestnet
        ? "PortalDot requires at least 10 tPOT for a vested tranche."
        : `The first milestone's amount in ${symbol}, not raw base units. It is held in the grant until release.`,
    },
    {
      name: "secondAmount",
      label: `Second tranche (${symbol})`,
      type: "number",
      inputMode: "decimal",
      required: true,
      value: isPortalDotTestnet ? "0.1" : "12",
      help: `The next milestone's amount in ${symbol}. The funder needs both tranches plus transaction costs.`,
    },
    {
      name: "vestingBlocks",
      label: "First tranche vesting: blocks",
      type: "number",
      required: true,
      value: isPortalDotTestnet ? "1000" : "1800",
      help: "Number of chain blocks over which the first released tranche unlocks. Enter 0 for no vesting; this is not a number of seconds.",
    },
    {
      name: "deadlineDays",
      label: "Milestone deadline: days from preparation",
      type: "number",
      required: true,
      value: "7",
      help: "Exact Unix deadlines are fixed in the review. The second tranche has no new vesting.",
    },
  ];
  const replacementPlanned = workspace.M1 !== null;
  function action(
    id: EnabledOperationId,
    title: string,
    description: string,
    category: ActionView["category"],
    actor: string,
    ownBlockers: string[],
    inputs: OperationField[] = [],
  ): ActionView {
    const unavailableCapabilities = chain
      ? OPERATION_REQUIREMENTS[id].requiredGateIds
          .filter(
            (gate) =>
              profileGates.has(gate) &&
              !(chain.profile.gateRecords ?? []).some(
                (record) =>
                  record.id === gate &&
                  record.stage === "profile_capability" &&
                  record.status === "accepted" &&
                  record.evidence.length > 0,
              ),
          )
          .map((gate) => `Network capability must be verified: ${gate}.`)
      : [];
    const blockers = [
      ...common,
      ...unavailableCapabilities,
      ...ownBlockers,
      ...(!replacementPlanned &&
      [
        "GRC-ROTATION-ADD-M1",
        "GRC-ROTATION-REMOVE-M0",
        "GRC-GRANT-SUBMIT-M1",
      ].includes(id)
        ? ["Choose a replacement group in Control handoff first."]
        : []),
    ];
    return {
      id,
      title,
      description,
      category,
      actor,
      enabled: blockers.length === 0,
      blockers,
      fields: inputs,
    };
  }
  const hasBaseline =
    !!(workspace.handoffBaseline ?? workspace.baseline) ||
    !!(pureState && chain?.grant);
  const proofState = proof(workspace, chain);
  const openOptions = [0, 1]
    .filter(
      (index) => milestone(index)?.state === 0 && milestone(index)?.round === 0,
    )
    .map((index) => ({
      value: String(index),
      label: `Milestone ${index + 1}`,
    }));
  const submittedOptions = [0, 1]
    .filter((index) => milestone(index)?.state === 1)
    .map((index) => ({
      value: String(index),
      label: `Milestone ${index + 1}`,
    }));
  return [
    action(
      "GRC-SETUP-FUND-M0",
      "Fund the controller reserve",
      "Fund the controller's Pure creation reserve separately. This does not fund signer fees.",
      "funding",
      "Selected donor",
      [],
      [amountField(symbol)],
    ),
    action(
      "GRC-SETUP-FUND-ACTOR",
      "Fund a participant's budget",
      "One specified address and amount. Participant budgets remain separate from grant funds.",
      "funding",
      "Selected donor",
      [],
      [
        roleField(workspace, "recipientRole", "Recipient", [
          "A",
          "B",
          "D",
          "F",
          "R1",
          "R2",
        ]),
        amountField(symbol),
      ],
    ),
    action(
      "GRC-SETUP-CREATE-PURE",
      "Create beneficiary P",
      "The current group creates a separate native Pure. Its address comes from the finalized receipt.",
      "setup",
      "Current group",
      [
        ...(!oldMember ? ["A current-group signer is required."] : []),
        ...(workspace.pure
          ? ["Beneficiary P is already linked to the workspace."]
          : []),
      ],
      [
        {
          name: "pureIndex",
          label: "Pure index",
          type: "number",
          required: true,
          value: "0",
          help: "Integer from 0 to 65535. A new index is not a retry of an unknown attempt.",
        },
      ],
    ),
    action(
      "GRC-SETUP-FUND-P",
      "Fund P liquidity",
      "A separate unlocked beneficiary budget for mapping, reserves and native operations.",
      "funding",
      "Selected donor",
      requirePure(),
      [amountField(symbol)],
    ),
    action(
      "GRC-SETUP-MAP-P",
      "Create P mapping",
      "Persistent mapping from native P to h(P). Reverse mapping must be verified.",
      "setup",
      "Current group through the beneficiary",
      [
        ...requirePure(),
        ...requireOld(),
        ...(mapped(pureState) ? ["P mapping is already verified."] : []),
      ],
    ),
    action(
      "GRC-SETUP-MAP-ACTOR",
      "Map a direct participant",
      "The funder and reviewers call the contract from their own native accounts.",
      "setup",
      "Selected F / R1 / R2",
      [
        ...(!directRole ? ["Select a personal account for F, R1 or R2."] : []),
        ...(mapped(actorState)
          ? ["The selected account's mapping is already verified."]
          : []),
      ],
      [
        roleField(
          workspace,
          "actorRole",
          "Direct participant",
          ["F", "R1", "R2"],
          directRole,
        ),
      ],
    ),
    action(
      "GRC-GRANT-CREATE",
      "Create and fund the grant",
      "Two milestones, two reviewers. The funder sets h(P) as beneficiary from the start.",
      "grant",
      "Funder",
      [
        ...requirePure(),
        ...requireMapping(),
        ...(!selectedRoles.includes("F")
          ? ["Only the designated funder may create the grant."]
          : []),
        ...(!mapped(actorState) ? ["Funder mapping is required."] : []),
        ...(["R1", "R2"] as const).flatMap((role) =>
          mapped(stateFor(chain, workspace.participants[role]))
            ? []
            : [`Verified ${role} mapping is required.`],
        ),
        ...(workspace.grantId !== null
          ? ["A grant is already linked to this workspace."]
          : []),
      ],
      fields,
    ),
    action(
      "GRC-GRANT-SUBMIT-M0",
      "Submit a milestone",
      "The evidence will be public. Submission does not imply approval or release.",
      "grant",
      "Current group through the beneficiary",
      [
        ...requirePure(),
        ...requireMapping(),
        ...requireGrant(),
        ...requireOld(),
        ...(!openOptions.length
          ? ["No milestone is open for submission."]
          : []),
      ],
      [
        {
          name: "index",
          label: "Milestone",
          type: "select",
          required: true,
          options: openOptions,
          value: openOptions[0]?.value ?? "0",
        },
        {
          name: "evidence",
          label: "Public evidence",
          type: "textarea",
          required: true,
          maxBytes: 1024,
          placeholder:
            "https://example.org/deliverable — what was completed and how to verify it",
          help: "Description or link. Text is recorded on-chain; do not include secrets.",
        },
      ],
    ),
    action(
      "GRC-GRANT-APPROVE",
      "Approve a submitted milestone",
      "Your vote may immediately release funds and create vesting in the same transaction.",
      "grant",
      "Reviewer",
      [
        ...requireGrant(),
        ...(!selectedRoles.some((role) => role === "R1" || role === "R2")
          ? ["Select the reviewer's personal account."]
          : []),
        ...(!mapped(actorState) ? ["Reviewer mapping is required."] : []),
        ...(!submittedOptions.length
          ? ["No milestone is awaiting approval."]
          : []),
      ],
      [
        {
          name: "index",
          label: "Milestone under review",
          type: "select",
          required: true,
          options: submittedOptions,
          value: submittedOptions[0]?.value ?? "0",
        },
      ],
    ),
    action(
      "GRC-ROTATION-ADD-M1",
      "Authorize the replacement group",
      "Both groups can act for the beneficiary until the previous group is removed.",
      "handoff",
      "Current group",
      [
        ...requirePure(),
        ...requireOld(),
        ...requireGrant(),
        ...requireMapping(),
        ...(current !== "M0"
          ? ["The current group must be the sole controller."]
          : []),
        ...(!hasBaseline
          ? ["A verified grant and beneficiary checkpoint are required."]
          : []),
      ],
    ),
    action(
      "GRC-ROTATION-REMOVE-M0",
      "Remove the previous group",
      "Remove only the previous controller’s permission and verify that the replacement is the sole controller.",
      "handoff",
      "Replacement group",
      [
        ...requirePure(),
        ...requireNew(),
        ...(current !== "DualControl"
          ? ["The exact DualControl state is required."]
          : []),
        ...(!hasBaseline
          ? ["The comparison baseline has not been recorded yet."]
          : []),
      ],
    ),
    action(
      "GRC-GRANT-SUBMIT-M1",
      "Submit the next milestone",
      "A separate submission by the same beneficiary proves continued work.",
      "handoff",
      "Replacement group through the beneficiary",
      [
        ...requirePure(),
        ...requireMapping(),
        ...requireGrant(),
        ...requireNew(),
        ...(current !== "M1"
          ? ["Verify the exact remaining M1 inventory first."]
          : []),
        ...requireOpen(1),
        ...(!hasBaseline ? ["A saved grant baseline is required."] : []),
      ],
      [
        {
          name: "evidence",
          label: "Public evidence",
          type: "textarea",
          required: true,
          maxBytes: 1024,
          placeholder:
            "Link to the next deliverable and describe what the new team completed",
          help: "This is a separate M1 submission on the same grant. Data is recorded on-chain.",
        },
      ],
    ),
    action(
      "GRC-VESTING-VEST-OTHER",
      "Refresh P's vesting lock",
      "A separate native maintenance operation after verification. It is not proof of a control handoff.",
      "maintenance",
      "Operator S",
      [
        ...requirePure(),
        ...(!selectedRoles.includes("S")
          ? ["Select the designated operator S."]
          : []),
        ...(!["continued", "drift"].includes(proofState.continuity)
          ? ["Complete and verify grant continuation first."]
          : []),
      ],
    ),
    action(
      "GRC-MULTISIG-CANCEL",
      "Cancel a native proposal",
      "The original depositor and exact timepoint are required. Execution may win a race against cancellation.",
      "recovery",
      "Original depositor",
      [
        ...(!oldMember && !newMember
          ? ["A member of the relevant controller is required."]
          : []),
      ],
      [
        {
          name: "targetController",
          label: "Proposal controller",
          type: "select",
          required: true,
          value: "M0",
          options: [
            { value: "M0", label: "M0 · original group" },
            { value: "M1", label: "M1 · new group" },
          ],
        },
        {
          name: "callHash",
          label: "Exact native call hash",
          type: "text",
          required: true,
          placeholder: "0x…",
          help: "The creation timepoint and depositor are read from the current native proposal.",
        },
      ],
    ),
  ];
}
