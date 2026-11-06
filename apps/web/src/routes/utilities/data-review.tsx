import { useEffect, useRef, useState, type FormEvent } from "react";
import { Address, Button, Card, KeyValues, Notice } from "../../components/ui";
import { addressKey } from "../../components/addresses/options";
import { networkReady } from "../../components/network-status";
import type {
  AppCommand,
  PackageImportPreview,
  WorkspaceInput,
} from "../../ui-contract";
import type { ScreenProps } from "../screen-types";
import type { DataDraftControls } from "./data-draft";
import { DataCompletion } from "./data-completion";

function accountRows(input: Partial<WorkspaceInput>) {
  const accounts = (values: string[]) =>
    values.map((value) => <Address key={value} value={value} />);
  return [
    ...(input.oldMembers?.length
      ? [
          {
            label: "Signing threshold",
            value: `${input.threshold ?? 2} of ${input.oldMembers.length}`,
          },
        ]
      : []),
    ...(input.oldMembers?.length
      ? [{ label: "Current signers", value: accounts(input.oldMembers) }]
      : []),
    ...(input.newMembers?.length
      ? [{ label: "Replacement signers", value: accounts(input.newMembers) }]
      : []),
    ...(input.funder
      ? [{ label: "Funder", value: <Address value={input.funder} /> }]
      : []),
    ...(input.reviewers?.length
      ? [{ label: "Reviewers", value: accounts(input.reviewers) }]
      : []),
    ...(input.beneficiary
      ? [
          {
            label: "Pure beneficiary",
            value: <Address value={input.beneficiary} />,
          },
        ]
      : []),
    ...(input.contract
      ? [
          {
            label: "Grant contract",
            value: <Address value={input.contract} format="hex" />,
          },
        ]
      : []),
    ...(input.grantId !== undefined
      ? [{ label: "Grant ID", value: input.grantId }]
      : []),
    ...(input.creation
      ? [
          {
            label: "Creation block",
            value: <code>{input.creation.blockHash}</code>,
          },
          {
            label: "Creation transaction",
            value: <code>{input.creation.transactionHash}</code>,
          },
        ]
      : []),
  ];
}

function completeInput(
  input: Partial<WorkspaceInput>,
): WorkspaceInput | string {
  if (!input.name?.trim()) return "Enter a workspace name.";
  const members = input.oldMembers ?? [];
  if (
    members.length !== 3 ||
    members.some((value) => !addressKey(value)) ||
    new Set(members.map((value) => addressKey(value))).size !== 3
  )
    return "Choose three distinct current signing accounts.";
  if (!input.funder || !addressKey(input.funder))
    return "Choose a valid funder account.";
  const reviewers = input.reviewers ?? [];
  if (
    reviewers.length !== 2 ||
    reviewers.some((value) => !addressKey(value)) ||
    new Set(reviewers.map((value) => addressKey(value))).size !== 2
  )
    return "Choose two distinct reviewer accounts.";
  if (input.beneficiary && !addressKey(input.beneficiary))
    return "Enter a valid Pure beneficiary address.";
  if ((input.contract || input.grantId !== undefined) && !input.beneficiary)
    return "A grant requires its Pure beneficiary and creation hashes.";
  if (
    input.beneficiary &&
    (!/^0x[0-9a-fA-F]{64}$/.test(input.creation?.blockHash ?? "") ||
      !/^0x[0-9a-fA-F]{64}$/.test(input.creation?.transactionHash ?? ""))
  )
    return "Enter the block and transaction hashes that created this Pure account.";
  return {
    ...input,
    name: input.name.trim(),
    oldMembers: members,
    threshold: 2,
    funder: input.funder.trim(),
    reviewers,
  };
}

export function DataReview({
  snapshot,
  draft,
  onDraftChange,
  onConnectNetwork,
  onConfirm,
  applying,
}: Pick<ScreenProps, "snapshot"> &
  DataDraftControls & {
    onConfirm(
      command: Extract<AppCommand, { type: "import-package" }>,
    ): Promise<void>;
    applying: boolean;
  }) {
  const preview = draft.preview!;
  const region = useRef<HTMLElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    region.current?.focus();
  }, [preview.digest]);
  const ready = networkReady(snapshot.network);
  const matchingNetwork =
    (!preview.mode || preview.mode === snapshot.network.mode) &&
    (!preview.genesis || preview.genesis === snapshot.network.genesis);
  const canApply = ready && matchingNetwork && !snapshot.busy && !applying;
  const merge = !!draft.targetWorkspaceId;
  const needsDetails = preview.kind === "evidence" && !merge;
  const input = draft.workspaceInput;
  const source = preview.workspaceInput ?? {};
  async function confirm(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!canApply) return;
    const command: Extract<AppCommand, { type: "import-package" }> = {
      type: "import-package",
      contents: draft.contents,
      previewDigest: preview.digest,
    };
    if (merge) command.targetWorkspaceId = draft.targetWorkspaceId;
    else if (needsDetails) {
      if (
        (preview.missingFields.includes("pure") && !draft.beneficiaryChoice) ||
        ((preview.missingFields.includes("contract") ||
          preview.missingFields.includes("grantId")) &&
          !draft.grantChoice) ||
        (preview.missingFields.includes("M1") && !draft.replacementChoice)
      ) {
        setError(
          "Choose whether a beneficiary, grant and replacement group already exist. Missing evidence does not establish their absence.",
        );
        return;
      }
      if (
        draft.replacementChoice === "planned" &&
        draft.workspaceInput.newMembers?.length !== 3
      ) {
        setError("Choose three distinct replacement signing accounts.");
        return;
      }
      const completed = completeInput(input);
      if (typeof completed === "string") {
        setError(completed);
        return;
      }
      command.workspaceInput = completed;
    }
    await onConfirm(command);
  }
  const kind: Record<PackageImportPreview["kind"], string> = {
    workspace: "Workspace backup",
    evidence: "Evidence only",
    local: "LOCAL workspace",
  };
  return (
    <section ref={region} tabIndex={-1} aria-label="Package review">
      <Card title="Review before restoring" eyebrow="Step 2 of 2">
        <KeyValues
          rows={[
            { label: "Package", value: kind[preview.kind] },
            { label: "Workspace", value: preview.name ?? "Not included" },
            {
              label: "Environment",
              value:
                preview.mode === "DEMO"
                  ? "Testnet"
                  : preview.mode === "LIVE"
                    ? "Mainnet"
                    : preview.mode === "LOCAL"
                      ? "Local"
                      : "Requires verification",
            },
            { label: "Evidence records", value: preview.recordCount },
            ...(preview.genesis
              ? [
                  {
                    label: "Network identity",
                    value: <code>{preview.genesis}</code>,
                  },
                ]
              : []),
          ]}
        />
        {Object.keys(source).length > 0 && (
          <details>
            <summary>Public configuration from the package</summary>
            <KeyValues rows={accountRows(source)} />
          </details>
        )}
        {preview.warnings.length > 0 && (
          <Notice tone="warning" title="Check the package">
            <ul>
              {preview.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </Notice>
        )}
        <form onSubmit={(event) => void confirm(event)}>
          {preview.matchingWorkspaces.length > 0 && (
            <div className="field">
              <label htmlFor="import-destination">Restore destination</label>
              <select
                id="import-destination"
                value={draft.targetWorkspaceId}
                disabled={applying}
                onChange={(event) => {
                  setError("");
                  onDraftChange({ targetWorkspaceId: event.target.value });
                }}
              >
                <option value="">
                  {preview.kind === "evidence"
                    ? "Complete details for a workspace"
                    : "Restore the workspace from this package"}
                </option>
                {preview.matchingWorkspaces.map((workspace) => (
                  <option key={workspace.id} value={workspace.id}>
                    Merge evidence into {workspace.name}
                  </option>
                ))}
              </select>
              <p className="field__help">
                Potential matches are based on the file. The selected network is
                checked before importing.
              </p>
              {merge && (
                <p className="field__help">
                  Merging keeps the selected workspace configuration.
                </p>
              )}
            </div>
          )}
          {needsDetails && (
            <DataCompletion
              snapshot={snapshot}
              draft={draft}
              applying={applying}
              onDraftChange={(change) => {
                setError("");
                onDraftChange(change);
              }}
            />
          )}
          {(!ready || !matchingNetwork) && (
            <Notice tone="warning" title="Network verification required">
              <p>
                {!matchingNetwork
                  ? "Connect to the package's network before restoring."
                  : "You can review the package now. Restoring waits until the network connection and current state are verified."}
              </p>
              <Button type="button" icon="network" onClick={onConnectNetwork}>
                Open network setup
              </Button>
            </Notice>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <p className="field__help">
            Restoring does not request a signature or send a transaction. Wallet
            access, endpoints and signed payloads are not restored.
          </p>
          <Button
            type="submit"
            variant="primary"
            icon="shield"
            disabled={!canApply}
          >
            {applying
              ? "Applying package…"
              : merge
                ? "Merge evidence"
                : "Restore workspace"}
          </Button>
        </form>
      </Card>
    </section>
  );
}
