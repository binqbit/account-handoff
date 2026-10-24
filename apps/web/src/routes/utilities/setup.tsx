import { useId, useState, type FormEvent } from "react";
import { Button, Card, Icon, Notice, PageHeader } from "../../components/ui";
import type { WorkspaceInput } from "../../ui-contract";
import type { ScreenProps } from "../screen-types";
import { ReadinessCards } from "../../components/readiness";

function AddressField({
  label,
  value,
  onChange,
  help,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  multiline?: boolean;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          required
          aria-describedby={help ? helpId : undefined}
          spellCheck={false}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          aria-describedby={help ? helpId : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {help && (
        <p className="field__help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
}

export function Setup(props: ScreenProps) {
  const { snapshot, run, navigate, openAction } = props;
  const [name, setName] = useState("");
  const [oldMembers, setOldMembers] = useState("");
  const [newMembers, setNewMembers] = useState("");
  const [funder, setFunder] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [formError, setFormError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [beneficiary, setBeneficiary] = useState("");
  const [contract, setContract] = useState("");
  const [grantId, setGrantId] = useState("");
  const workspace = snapshot.workspace;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const parse = (input: string) =>
      input
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean);
    const old = parse(oldMembers);
    const next = parse(newMembers);
    const judges = parse(reviewers);
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
    if (judges.length !== 2 || new Set(judges).size !== 2) {
      setFormError("Enter two distinct reviewers.");
      return;
    }
    const input: WorkspaceInput = {
      name: name.trim(),
      oldMembers: old,
      newMembers: next,
      threshold: 2,
      funder: funder.trim(),
      reviewers: judges,
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
    <>
      <PageHeader
        eyebrow="Team setup"
        title="Start with a stable beneficiary"
        description="Define the team first. Every creation, funding and mapping action has a separate review."
      />
      <div className="overview-grid">
        <Card
          title={workspace ? "New workspace details" : "Name, team and roles"}
        >
          <form onSubmit={(event) => void submit(event)}>
            <AddressField
              label="Workspace name"
              value={name}
              onChange={setName}
              help="A recognizable team name, up to 80 characters."
            />
            <div className="equal-grid">
              <AddressField
                label="Original group M0 — three addresses"
                value={oldMembers}
                onChange={setOldMembers}
                multiline
                help="One native address or AccountId32 per line. Threshold: 2 of 3."
              />
              <AddressField
                label="New group M1 — three addresses"
                value={newMembers}
                onChange={setNewMembers}
                multiline
                help="Replace one member. The group receives a separate controller address."
              />
            </div>
            <AddressField
              label="Funder account F"
              value={funder}
              onChange={setFunder}
              help="The direct sender who creates and funds the grant."
            />
            <AddressField
              label="Two reviewer accounts"
              value={reviewers}
              onChange={setReviewers}
              multiline
              help="Two reviewers with a threshold of two are supported. Each approves from their own account."
            />
            <button
              type="button"
              className="text-button"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
            >
              {advanced
                ? "Hide known addresses"
                : "I know the P and grant addresses"}
              <Icon name="chevron" size={14} />
            </button>
            {advanced && (
              <div className="advanced-fields">
                <p className="muted">
                  These values require provenance and current-state
                  verification. Entering an address does not establish
                  authority.
                </p>
                <div className="field">
                  <label htmlFor="known-pure">Known native beneficiary P</label>
                  <input
                    id="known-pure"
                    value={beneficiary}
                    onChange={(event) => setBeneficiary(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="known-contract">Known grant contract</label>
                  <input
                    id="known-contract"
                    value={contract}
                    onChange={(event) => setContract(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="known-grant">Grant ID</label>
                  <input
                    id="known-grant"
                    value={grantId}
                    onChange={(event) => setGrantId(event.target.value)}
                    inputMode="numeric"
                  />
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
          </form>
        </Card>
        <div>
          <Card eyebrow="Sequence" title="One workspace, separate actions">
            <ol className="setup-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Define the team</strong>
                  <p>The original and next groups, funder and reviewers.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Create beneficiary P</strong>
                  <p>Reserve, creation through M0, liquidity and mapping.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Link the grant</strong>
                  <p>
                    The funder creates a grant for h(P) and funds its
                    milestones.
                  </p>
                </div>
              </li>
            </ol>
          </Card>
          <Notice title="Beneficiary from the start">
            This flow creates a grant for the stable P. It does not change the
            beneficiary of an existing personal grant.
          </Notice>
        </div>
      </div>
      {workspace && (
        <>
          <div className="section-heading">
            <h2>Setup: {workspace.name}</h2>
            <Button onClick={() => navigate("overview")}>Open workspace</Button>
          </div>
          <ReadinessCards rows={workspace.setupProgress} />
          <Card title="Next operations">
            <div className="operation-grid">
              {snapshot.actions
                .filter(
                  (action) =>
                    action.category === "setup" ||
                    action.category === "funding",
                )
                .map((action) => (
                  <div className="operation-tile" key={action.id}>
                    <h3>{action.title}</h3>
                    <p>{action.description}</p>
                    <Button onClick={() => openAction(action.id)}>
                      Review action
                    </Button>
                  </div>
                ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
