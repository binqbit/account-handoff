import { useEffect, useState, type FormEvent } from "react";
import {
  Address,
  Badge,
  Button,
  Card,
  EmptyState,
  Evidence,
  Icon,
  KeyValues,
  Notice,
  OperationInput,
  PageHeader,
} from "../../components/ui";
import type { ActionView } from "../../ui-contract";
import type { ScreenProps } from "../screen-types";
import { addressError } from "../../components/addresses/options";
import { displayAddress } from "../../components/addresses/format";

function ActionForm({
  action,
  props,
}: {
  action: ActionView;
  props: ScreenProps;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      action.fields.map((field) => [
        field.name,
        field.value ?? field.options?.[0]?.value ?? "",
      ]),
    ),
  );
  const [error, setError] = useState("");
  async function prepare(event: FormEvent) {
    event.preventDefault();
    setError("");
    for (const field of action.fields) {
      const value = values[field.name] ?? "";
      if (field.required && !value.trim()) {
        setError(`Complete the “${field.label}” field.`);
        return;
      }
      if (field.type === "contract") {
        const invalid = addressError(value, "contract");
        if (invalid) {
          setError(invalid);
          return;
        }
      }
      if (
        field.maxBytes &&
        new TextEncoder().encode(value).length > field.maxBytes
      ) {
        setError(
          `The “${field.label}” field exceeds ${field.maxBytes} UTF-8 bytes.`,
        );
        return;
      }
    }
    try {
      await props.run({
        type: "prepare-operation",
        actionId: action.id,
        fields: values,
        expectedRevision: props.snapshot.revision,
      });
    } catch {
      /* Global error is rendered without erasing form values. */
    }
  }
  return (
    <Card title="Action parameters">
      <form onSubmit={(event) => void prepare(event)}>
        {action.fields.map((field) => (
          <OperationInput
            key={field.name}
            field={field}
            value={values[field.name] ?? ""}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.name]: value }))
            }
          />
        ))}
        {!action.fields.length && (
          <p className="muted">Uses the verified workspace parameters.</p>
        )}
        {action.blockers.length > 0 && (
          <Notice tone="warning" title="Complete the prerequisites first">
            <ul>
              {action.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Notice>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          icon="shield"
          type="submit"
          disabled={!action.enabled || !!props.snapshot.busy}
        >
          Prepare for review
        </Button>
      </form>
    </Card>
  );
}

export function Review(props: ScreenProps & { actionId: string | null }) {
  const { snapshot, actionId, navigate } = props;
  const operation = snapshot.operation;
  const action = snapshot.actions.find((item) => item.id === actionId);
  const [acknowledged, setAcknowledged] = useState(false);
  const active =
    operation && (!actionId || operation.actionId === actionId)
      ? operation
      : null;
  useEffect(() => {
    setAcknowledged(false);
  }, [active?.id, active?.stage, snapshot.wallet.selectedAddress]);
  return (
    <>
      <Button
        variant="ghost"
        icon="back"
        onClick={() =>
          navigate(action?.category === "handoff" ? "handoff" : "overview")
        }
      >
        Back to task
      </Button>
      <PageHeader
        icon="shield"
        eyebrow="Separate operation review"
        title={active?.title ?? action?.title ?? "Review the planned action"}
        description={
          active?.description ??
          action?.description ??
          "Choose a workspace action to review its parameters and consequences."
        }
      />
      {(action || active) && (
        <ol className="review-steps" aria-label="Operation steps">
          {[
            "Set parameters",
            "Review and sign",
            "Send operation",
            "Verify outcome",
          ].map((label, index) => {
            const current = !active
              ? 0
              : active.stage.toLowerCase() === "prepared" ||
                  active.stage.toLowerCase() === "stale"
                ? 1
                : active.stage.toLowerCase() === "signed"
                  ? 2
                  : 3;
            return (
              <li
                key={label}
                aria-current={index === current ? "step" : undefined}
              >
                <span>{index + 1}</span>
                {label}
              </li>
            );
          })}
        </ol>
      )}
      {!active ? (
        action ? (
          <div className="overview-grid">
            <ActionForm key={action.id} action={action} props={props} />
            <Card title="Who performs the action">
              <KeyValues
                rows={[
                  { label: "Role", value: displayAddress(action.actor) },
                  {
                    label: "Personal account",
                    value: <Address value={snapshot.wallet.selectedAddress} />,
                  },
                  { label: "Environment", value: snapshot.network.mode },
                ]}
              />
              <Notice title="Review the exact plan first">
                Preparation does not open the wallet. The next step shows the
                route, resources and exact signing data.
              </Notice>
            </Card>
          </div>
        ) : (
          <EmptyState
            title="No action selected"
            action={
              <Button variant="primary" onClick={() => navigate("overview")}>
                Go to overview
              </Button>
            }
          >
            Open a task from the overview, team or grant milestones.
          </EmptyState>
        )
      ) : (
        <div className="overview-grid">
          <div>
            <Card
              title="Consequences and exact terms"
              action={<Badge tone={active.tone}>{active.stage}</Badge>}
            >
              <ul className="consequence-list">
                {active.consequences.map((consequence) => (
                  <li key={consequence}>
                    <Icon name="arrow" size={16} />
                    <span>{consequence}</span>
                  </li>
                ))}
              </ul>
              <KeyValues
                rows={active.terms.map((term) => ({
                  ...term,
                  value: displayAddress(term.value),
                }))}
              />
              <div className="field">
                {active.stage.toLowerCase() === "finalized" ? (
                  <div className="checkbox-label" role="status">
                    Transaction confirmed. This review can be closed.
                  </div>
                ) : (
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={acknowledged}
                      onChange={(event) =>
                        setAcknowledged(event.target.checked)
                      }
                      disabled={!active.canSign && !active.canSend}
                    />
                    <span>
                      I have checked the account, route, terms and consequences
                      of this individual action.
                    </span>
                  </label>
                )}
              </div>
              {active.blockers.length > 0 && (
                <Notice tone="warning" title="This action is currently blocked">
                  <ul>
                    {active.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              <div className="actions">
                {active.canSign && (
                  <Button
                    variant="primary"
                    icon="wallet"
                    disabled={!acknowledged || !!snapshot.busy}
                    onClick={() =>
                      void props.run({ type: "sign-operation", id: active.id })
                    }
                  >
                    Request signature
                  </Button>
                )}
                {active.canSend && (
                  <Button
                    variant="primary"
                    icon="arrow"
                    disabled={!acknowledged || !!snapshot.busy}
                    onClick={() =>
                      void props.run({ type: "send-operation", id: active.id })
                    }
                  >
                    Send signed operation
                  </Button>
                )}
                {active.canReconcile && (
                  <Button
                    icon="refresh"
                    disabled={!!snapshot.busy}
                    onClick={() =>
                      void props.run({
                        type: "reconcile-operation",
                        id: active.id,
                      })
                    }
                  >
                    {active.stage === "signed"
                      ? "Restore the signed operation"
                      : "Reconcile outcome"}
                  </Button>
                )}
                {active.canDiscard && (
                  <Button
                    variant="ghost"
                    disabled={!!snapshot.busy}
                    onClick={() =>
                      void props.run({
                        type: "discard-operation",
                        id: active.id,
                      })
                    }
                  >
                    Set review aside
                  </Button>
                )}
              </div>
              {active.canSend && (
                <p className="footnote">
                  Signed bytes are saved locally. Only this separate command
                  sends them.
                </p>
              )}
              {active.canReconcile && (
                <p className="footnote">
                  {active.stage === "signed"
                    ? "Recovery opens the saved signed payload. Sending remains a separate action; no new signature is requested."
                    : "Reconciliation reads the existing attempt's outcome. It does not create a new nonce or signature."}
                </p>
              )}
            </Card>
            {active.callHex && (
              <Evidence
                title="Exact RuntimeCall and verified identifiers"
                value={{
                  call: active.callHex,
                  callHash: active.callHash,
                  transactionHash: active.txHash,
                }}
              />
            )}
            {active.evidence && (
              <Evidence title="Outcome evidence" value={active.evidence} />
            )}
          </div>
          <div>
            <Card title="Execution route">
              <ol className="execution-route">
                {active.route.map((step, index) => (
                  <li key={`${index}-${step}`}>
                    <span>{index + 1}</span>
                    <code>{displayAddress(step)}</code>
                  </li>
                ))}
              </ol>
              <KeyValues
                rows={[
                  {
                    label: "Signer",
                    value: (
                      <Address
                        value={active.signer?.address}
                        compact={false}
                        label="signer address"
                      />
                    ),
                  },
                  { label: "Role", value: displayAddress(active.actor) },
                ]}
              />
            </Card>
            <Card title="Fees and reserves">
              {active.resources.length ? (
                <div className="resource-list">
                  {active.resources.map((resource, index) => (
                    <div key={`${resource.label}-${index}`}>
                      <span>
                        {resource.label}
                        <small>Paid by: {displayAddress(resource.payer)}</small>
                      </span>
                      <strong>{resource.amount}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Resource estimates are not available yet. Signing is enabled
                  after the required limits are verified.
                </p>
              )}
            </Card>
            {active.approvals && (
              <Card title="Current native proposal">
                <KeyValues
                  rows={[
                    {
                      label: "Approvals",
                      value: `${active.approvals.approved.length} of ${active.approvals.required}`,
                    },
                    {
                      label: "Depositor",
                      value: (
                        <Address value={active.approvals.depositor} compact />
                      ),
                    },
                    {
                      label: "Timepoint",
                      value: active.approvals.timepoint ?? "Not created yet",
                    },
                  ]}
                />
                <p className="footnote">
                  The first approval does not execute the business action. Final
                  approval requires its own review and signature.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
