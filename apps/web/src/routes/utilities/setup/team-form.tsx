import { useState, type FormEvent } from "react";
import { Button, Card, Icon } from "../../../components/ui";
import { AddressPicker } from "../../../components/addresses/address-picker";
import { AddressList } from "../../../components/addresses/address-list";
import {
  addressKey,
  participantOptions,
} from "../../../components/addresses/options";
import type { WorkspaceInput } from "../../../ui-contract";
import type { ScreenProps } from "../../screen-types";

export function TeamForm(props: ScreenProps) {
  const { snapshot, run, navigate } = props;
  const [name, setName] = useState("");
  const [oldMembers, setOldMembers] = useState<string[]>([]);
  const [newMembers, setNewMembers] = useState<string[]>([]);
  const [funder, setFunder] = useState("");
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [formError, setFormError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [beneficiary, setBeneficiary] = useState("");
  const [contract, setContract] = useState("");
  const [grantId, setGrantId] = useState("");
  const workspace = snapshot.workspace;
  const options = participantOptions(snapshot);
  const busy = !!snapshot.busy;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const old = oldMembers.map((value) => addressKey(value)!);
    const next = newMembers.map((value) => addressKey(value)!);
    const judges = reviewers.map((value) => addressKey(value)!);
    if (old.length !== 3 || next.length !== 3) {
      setFormError(
        "Each group needs three distinct accounts. The supported threshold is 2 of 3.",
      );
      return;
    }
    if (new Set(old).size !== 3 || new Set(next).size !== 3) {
      setFormError("Accounts within a group must be distinct.");
      return;
    }
    if (old.filter((address) => next.includes(address)).length !== 2) {
      setFormError(
        "Keep two members from M0 and choose one replacement for M1.",
      );
      return;
    }
    if (judges.length !== 2 || new Set(judges).size !== 2) {
      setFormError("Enter two distinct reviewers.");
      return;
    }
    if (!addressKey(funder)) {
      setFormError("Choose a valid native funder account.");
      return;
    }
    if (
      (beneficiary && !addressKey(beneficiary)) ||
      (contract && !addressKey(contract, "contract"))
    ) {
      setFormError("Check the known beneficiary and contract address formats.");
      return;
    }
    if (grantId && !/^(0|[1-9]\d*)$/.test(grantId)) {
      setFormError("The grant ID must be a whole number, starting at 0.");
      return;
    }
    const input: WorkspaceInput = {
      name: name.trim(),
      oldMembers,
      newMembers,
      threshold: 2,
      funder: funder.trim(),
      reviewers,
    };
    if (beneficiary.trim()) input.beneficiary = beneficiary.trim();
    if (contract.trim()) input.contract = contract.trim();
    if (grantId.trim()) input.grantId = grantId.trim();
    try {
      await run({ type: "create-workspace", input });
    } catch {
      /* Parent renders the command error. */
    }
  }
  return (
    <Card title={workspace ? "New workspace details" : "Name, team and roles"}>
      <form onSubmit={(event) => void submit(event)}>
        <div className="field">
          <label htmlFor="workspace-name">Workspace name</label>
          <input
            id="workspace-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="e.g. Atlas Research"
            maxLength={80}
            required
            disabled={busy}
            aria-describedby="workspace-name-help"
          />
          <p className="field__help" id="workspace-name-help">
            A name for this team's local workspace. You can review every
            on-chain action separately.
          </p>
        </div>
        <div className="form-section-heading">
          <Icon name="team" size={20} />
          <div>
            <h3>Choose the people who can sign</h3>
            <p>
              Each group needs 2 of its 3 members to approve. Keep two members
              and replace one.
            </p>
          </div>
        </div>
        <div className="equal-grid signer-groups">
          <AddressList
            label="Original group M0"
            values={oldMembers}
            onChange={setOldMembers}
            count={3}
            options={options}
            disabled={busy}
            help="The three people who control the beneficiary before the handoff."
          />
          <AddressList
            label="New group M1"
            values={newMembers}
            onChange={setNewMembers}
            count={3}
            options={options}
            disabled={busy}
            help="Two continuing members and one new member. M1 gets its own controller address."
          />
        </div>
        <div className="form-section-heading">
          <Icon name="grant" size={20} />
          <div>
            <h3>Assign the grant roles</h3>
            <p>
              The funder deposits the grant. Two reviewers approve completed
              milestones.
            </p>
          </div>
        </div>
        <AddressPicker
          label="Funder account F"
          value={funder}
          onChange={setFunder}
          options={options}
          required
          disabled={busy}
          help="A native account that will create and fund the grant. Choose a public address; never enter a seed phrase or private key."
        />
        <AddressList
          label="Two reviewer accounts"
          values={reviewers}
          onChange={setReviewers}
          options={options}
          count={2}
          disabled={busy}
          help="Both reviewers must approve. Each signs with their own personal wallet."
        />
        <button
          type="button"
          className="text-button"
          aria-expanded={advanced}
          aria-controls="known-workspace-addresses"
          onClick={() => setAdvanced(!advanced)}
        >
          {advanced
            ? "Hide known addresses"
            : "I know the P and grant addresses"}
          <Icon name="chevron" size={14} />
        </button>
        {advanced && (
          <div className="advanced-fields" id="known-workspace-addresses">
            <p className="muted">
              These values require provenance and current-state verification.
              Entering an address does not establish authority.
            </p>
            <AddressPicker
              label="Known native beneficiary P"
              value={beneficiary}
              onChange={setBeneficiary}
              disabled={busy}
              options={
                workspace?.beneficiary
                  ? [
                      {
                        address: workspace.beneficiary.address,
                        label: workspace.beneficiary.label ?? "Beneficiary P",
                        detail: "Current workspace",
                      },
                    ]
                  : []
              }
              help="Optional. The existing Pure beneficiary's native address, not a personal wallet or an EVM address."
            />
            <AddressPicker
              label="Known grant contract"
              value={contract}
              onChange={setContract}
              disabled={busy}
              kind="contract"
              options={
                workspace?.contract
                  ? [
                      {
                        address: workspace.contract,
                        label: "Vestry contract",
                        detail: "Current workspace",
                      },
                    ]
                  : []
              }
              help="Optional. The deployed Vestry contract's 20-byte EVM address (0x + 40 hex characters)."
            />
            <div className="field">
              <label htmlFor="known-grant">Grant ID</label>
              <input
                id="known-grant"
                value={grantId}
                onChange={(event) => setGrantId(event.target.value)}
                inputMode="numeric"
                placeholder="e.g. 0"
                pattern="0|[1-9][0-9]*"
                aria-describedby="known-grant-help"
              />
              <p className="field__help" id="known-grant-help">
                Optional. The numeric ID of the grant in that contract, not a
                transaction hash.
              </p>
            </div>
          </div>
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
            disabled={
              !!snapshot.busy || !name.trim() || name.trim().length > 80
            }
          >
            Save team
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
          Saving the team creates a local draft. It does not sign or send a
          transaction.
        </p>
      </form>
    </Card>
  );
}
