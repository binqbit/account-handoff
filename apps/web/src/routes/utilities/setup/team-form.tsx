import { useMemo, useState, type FormEvent } from "react";
import { createKeyMulti } from "@polkadot/util-crypto";
import { u8aToHex } from "dedot/utils";
import { Address, Button, Card, Icon } from "../../../components/ui";
import { AddressPicker } from "../../../components/addresses/address-picker";
import { AddressList } from "../../../components/addresses/address-list";
import {
  addressKey,
  participantOptions,
} from "../../../components/addresses/options";
import type { WorkspaceInput } from "../../../ui-contract";
import type { ScreenProps } from "../../screen-types";
import { ExistingBeneficiaryFields } from "./existing-beneficiary-fields";
import type { SetupDraftControls } from "./draft";

export function TeamForm({
  snapshot,
  run,
  navigate,
  draft,
  onDraftChange,
  onDraftReset,
}: ScreenProps & SetupDraftControls) {
  const {
    mode,
    name,
    members,
    controllerAddress,
    funder,
    reviewers,
    existing,
  } = draft;
  const [formError, setFormError] = useState("");
  const options = participantOptions(snapshot);
  const busy = !!snapshot.busy;
  const derived = useMemo(() => {
    const accounts = members.map((value) => addressKey(value));
    return accounts.length === 3 &&
      accounts.every(Boolean) &&
      new Set(accounts).size === 3
      ? u8aToHex(createKeyMulti(accounts as string[], 2))
      : null;
  }, [members]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    if (!derived) {
      setFormError("Choose three distinct native signing accounts.");
      return;
    }
    if (mode === "connect" && addressKey(controllerAddress) !== derived) {
      setFormError(
        "The multisig address does not match these members and the 2-of-3 threshold.",
      );
      return;
    }
    if (
      !addressKey(funder) ||
      reviewers.length !== 2 ||
      new Set(reviewers.map((value) => addressKey(value))).size !== 2
    ) {
      setFormError("Choose a funder and two distinct reviewers.");
      return;
    }
    const attachment = mode === "connect" ? existing : {};
    if (
      (attachment.contract || attachment.grantId) &&
      !attachment.beneficiary
    ) {
      setFormError(
        "Enter the grant's Pure beneficiary and its creation receipt.",
      );
      return;
    }
    if (
      attachment.beneficiary &&
      (!attachment.creation?.blockHash || !attachment.creation.transactionHash)
    ) {
      setFormError(
        "Enter the block hash and transaction hash that created this Pure account.",
      );
      return;
    }
    const input: WorkspaceInput = {
      name: name.trim(),
      oldMembers: members,
      threshold: 2,
      funder: funder.trim(),
      reviewers,
      ...attachment,
    };
    if (mode === "connect") input.controllerAddress = controllerAddress.trim();
    const outcome = await run({ type: "create-workspace", input });
    if (outcome.succeeded) {
      onDraftReset();
      navigate("overview");
    }
  }
  return (
    <Card title="Your multisig">
      <form onSubmit={(event) => void submit(event)}>
        <div
          className="actions workspace-entry"
          role="group"
          aria-label="Multisig setup"
        >
          <Button
            type="button"
            variant={mode === "create" ? "primary" : "secondary"}
            aria-pressed={mode === "create"}
            onClick={() => onDraftChange({ mode: "create" })}
            disabled={busy}
          >
            Create multisig
          </Button>
          <Button
            type="button"
            variant={mode === "connect" ? "primary" : "secondary"}
            aria-pressed={mode === "connect"}
            onClick={() => onDraftChange({ mode: "connect" })}
            disabled={busy}
          >
            Connect existing
          </Button>
        </div>
        <div className="field">
          <label htmlFor="workspace-name">Workspace name</label>
          <input
            id="workspace-name"
            value={name}
            onChange={(event) => onDraftChange({ name: event.target.value })}
            placeholder="e.g. Atlas Research"
            maxLength={80}
            required
            disabled={busy}
          />
        </div>
        {mode === "connect" && (
          <AddressPicker
            label="Existing multisig address"
            value={controllerAddress}
            onChange={(controllerAddress) =>
              onDraftChange({ controllerAddress })
            }
            options={[]}
            required
            disabled={busy}
            help="The address of your current native multisig."
          />
        )}
        <AddressList
          label="Current signers"
          values={members}
          onChange={(members) => onDraftChange({ members })}
          inputDraft={{
            value: draft.membersInput,
            onChange: (membersInput) => onDraftChange({ membersInput }),
          }}
          count={3}
          options={options}
          disabled={busy}
          help="2 of 3 signatures required. Enter the complete membership, including your own account."
        />
        {derived && (
          <div className="derived-address">
            <span>Multisig address</span>
            <Address value={derived} />
          </div>
        )}
        <div className="form-section-heading">
          <Icon name="grant" size={20} />
          <h3>Grant roles</h3>
        </div>
        <AddressPicker
          label="Funder account"
          value={funder}
          onChange={(funder) => onDraftChange({ funder })}
          options={options}
          required
          disabled={busy}
          help="The account that funds the grant."
        />
        <AddressList
          label="Reviewer accounts"
          values={reviewers}
          onChange={(reviewers) => onDraftChange({ reviewers })}
          inputDraft={{
            value: draft.reviewersInput,
            onChange: (reviewersInput) => onDraftChange({ reviewersInput }),
          }}
          options={options}
          count={2}
          disabled={busy}
          help="Both reviewers must approve."
        />
        {mode === "connect" && (
          <ExistingBeneficiaryFields
            value={existing}
            onChange={(existing) => onDraftChange({ existing })}
            disabled={busy}
          />
        )}
        {formError && (
          <p className="form-error" role="alert">
            {formError}
          </p>
        )}
        <div className="actions">
          <Button
            variant="primary"
            type="submit"
            icon="arrow"
            disabled={busy || !name.trim() || !snapshot.network.connected}
          >
            {mode === "create" ? "Create workspace" : "Connect workspace"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => navigate("workspaces")}
          >
            Back
          </Button>
        </div>
        <p className="form-reassurance">
          <Icon name="shield" size={15} />
          Saved locally. Creating a multisig configuration sends no transaction.
        </p>
      </form>
    </Card>
  );
}
