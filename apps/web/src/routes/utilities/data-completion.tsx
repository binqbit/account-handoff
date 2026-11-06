import { Notice } from "../../components/ui";
import { AddressList } from "../../components/addresses/address-list";
import { AddressPicker } from "../../components/addresses/address-picker";
import { participantOptions } from "../../components/addresses/options";
import type { AppSnapshot, WorkspaceInput } from "../../ui-contract";
import type { DataDraftControls } from "./data-draft";

export function DataCompletion({
  snapshot,
  draft,
  onDraftChange,
  applying,
}: Pick<DataDraftControls, "draft" | "onDraftChange"> & {
  snapshot: AppSnapshot;
  applying: boolean;
}) {
  const preview = draft.preview!;
  const input = draft.workspaceInput;
  const source = preview.workspaceInput ?? {};
  const options = participantOptions(snapshot);
  const unknownBeneficiary = preview.missingFields.includes("pure");
  const unknownGrant =
    preview.missingFields.includes("contract") ||
    preview.missingFields.includes("grantId");
  const unknownReplacement = preview.missingFields.includes("M1");
  function missing(field: keyof WorkspaceInput) {
    return (
      source[field] === undefined ||
      source[field] === null ||
      preview.missingFields.includes(field)
    );
  }
  function update(change: Partial<WorkspaceInput>) {
    onDraftChange({ workspaceInput: { ...input, ...change } });
  }
  return (
    <>
      <Notice title="This older file contains evidence only">
        Complete and confirm the missing public details to restore a workspace.
        Addresses identified in the file stay unchanged. Missing evidence does
        not establish that a beneficiary or grant is absent.
      </Notice>
      {missing("name") && (
        <div className="field">
          <label htmlFor="import-workspace-name">Workspace name</label>
          <input
            id="import-workspace-name"
            value={input.name ?? ""}
            maxLength={80}
            required
            disabled={applying}
            onChange={(event) => update({ name: event.target.value })}
          />
        </div>
      )}
      {missing("oldMembers") && (
        <AddressList
          label="Current signers"
          values={input.oldMembers ?? []}
          onChange={(oldMembers) => update({ oldMembers })}
          inputDraft={{
            value: draft.membersInput,
            onChange: (membersInput) => onDraftChange({ membersInput }),
          }}
          count={3}
          options={options}
          disabled={applying}
          help="Enter the three current native signers. The threshold is 2 of 3."
        />
      )}
      {missing("funder") && (
        <AddressPicker
          label="Funder account"
          value={input.funder ?? ""}
          onChange={(funder) => update({ funder })}
          options={options}
          required
          disabled={applying}
          help="The account that funds this grant."
        />
      )}
      {missing("reviewers") && (
        <AddressList
          label="Reviewer accounts"
          values={input.reviewers ?? []}
          onChange={(reviewers) => update({ reviewers })}
          inputDraft={{
            value: draft.reviewersInput,
            onChange: (reviewersInput) => onDraftChange({ reviewersInput }),
          }}
          count={2}
          options={options}
          disabled={applying}
          help="Both reviewer accounts are required."
        />
      )}
      {unknownReplacement && (
        <>
          <div className="field">
            <label htmlFor="import-replacement-choice">
              Replacement signing group
            </label>
            <select
              id="import-replacement-choice"
              required
              disabled={applying}
              value={draft.replacementChoice}
              onChange={(event) =>
                onDraftChange({
                  replacementChoice: event.target
                    .value as typeof draft.replacementChoice,
                  replacementInput: "",
                  workspaceInput: { ...input, newMembers: [] },
                })
              }
            >
              <option value="">Choose the current situation</option>
              <option value="planned">A replacement group is planned</option>
              <option value="none">No replacement group is planned</option>
            </select>
          </div>
          {draft.replacementChoice === "planned" && (
            <AddressList
              label="Replacement signers"
              values={input.newMembers ?? []}
              onChange={(newMembers) => update({ newMembers })}
              inputDraft={{
                value: draft.replacementInput,
                onChange: (replacementInput) =>
                  onDraftChange({ replacementInput }),
              }}
              count={3}
              options={options}
              disabled={applying}
              help="Keep the first two current signers and choose the replacement third member."
            />
          )}
        </>
      )}
      {unknownBeneficiary && (
        <>
          <div className="field">
            <label htmlFor="import-beneficiary-choice">Pure beneficiary</label>
            <select
              id="import-beneficiary-choice"
              required
              disabled={applying}
              value={draft.beneficiaryChoice}
              onChange={(event) => {
                const next = { ...input, beneficiary: "" };
                delete next.creation;
                onDraftChange({
                  beneficiaryChoice: event.target
                    .value as typeof draft.beneficiaryChoice,
                  workspaceInput: next,
                });
              }}
            >
              <option value="">Choose the current situation</option>
              <option value="existing">
                A Pure beneficiary already exists
              </option>
              <option value="none">No beneficiary has been created yet</option>
            </select>
          </div>
          {draft.beneficiaryChoice === "existing" && (
            <AddressPicker
              label="Pure beneficiary address"
              value={input.beneficiary ?? ""}
              onChange={(beneficiary) => update({ beneficiary })}
              options={[]}
              required
              disabled={applying}
              help="Enter the existing Pure account. Its original creation and current control will be checked."
            />
          )}
        </>
      )}
      {input.beneficiary &&
        (!source.creation?.blockHash || !source.creation.transactionHash) && (
          <>
            <div className="field">
              <label htmlFor="import-pure-block">Creation block hash</label>
              <input
                id="import-pure-block"
                value={input.creation?.blockHash ?? ""}
                pattern="0x[0-9a-fA-F]{64}"
                required
                disabled={applying}
                onChange={(event) =>
                  update({
                    creation: {
                      transactionHash: input.creation?.transactionHash ?? "",
                      blockHash: event.target.value,
                    },
                  })
                }
              />
            </div>
            <div className="field">
              <label htmlFor="import-pure-transaction">
                Creation transaction hash
              </label>
              <input
                id="import-pure-transaction"
                value={input.creation?.transactionHash ?? ""}
                pattern="0x[0-9a-fA-F]{64}"
                required
                disabled={applying}
                onChange={(event) =>
                  update({
                    creation: {
                      blockHash: input.creation?.blockHash ?? "",
                      transactionHash: event.target.value,
                    },
                  })
                }
              />
            </div>
          </>
        )}
      {unknownGrant && (
        <>
          <div className="field">
            <label htmlFor="import-grant-choice">Grant connection</label>
            <select
              id="import-grant-choice"
              required
              disabled={applying}
              value={draft.grantChoice}
              onChange={(event) => {
                const next = {
                  ...input,
                  contract:
                    event.target.value === "none"
                      ? ""
                      : (source.contract ?? ""),
                };
                delete next.grantId;
                onDraftChange({
                  grantChoice: event.target.value as typeof draft.grantChoice,
                  workspaceInput: next,
                });
              }}
            >
              <option value="">Choose the current situation</option>
              <option value="existing">A grant is already attached</option>
              <option value="none">No grant is attached yet</option>
            </select>
          </div>
          {draft.grantChoice === "existing" && (
            <>
              {!source.contract && (
                <AddressPicker
                  label="Grant contract"
                  value={input.contract ?? ""}
                  onChange={(contract) => update({ contract })}
                  options={[]}
                  kind="contract"
                  required
                  disabled={applying}
                  help="The deployment containing the existing grant."
                />
              )}
              {source.grantId === undefined && (
                <div className="field">
                  <label htmlFor="import-grant-id">Grant ID</label>
                  <input
                    id="import-grant-id"
                    required
                    inputMode="numeric"
                    pattern="0|[1-9][0-9]*"
                    value={input.grantId ?? ""}
                    disabled={applying}
                    onChange={(event) =>
                      update({ grantId: event.target.value })
                    }
                  />
                  <p className="field__help">Grant ID 0 is a valid grant.</p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
