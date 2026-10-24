import {
  Address,
  Badge,
  Button,
  Card,
  EmptyState,
  Evidence,
  Icon,
  KeyValues,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import { stateTone, ActionButton, NoWorkspace, ActivityRow } from "./shared";

export function History(props: ScreenProps) {
  const { snapshot, openAction } = props;
  const workspace = snapshot.workspace;
  return (
    <>
      <PageHeader
        icon="history"
        eyebrow="History and evidence"
        title="An outcome you can verify"
        description="The outer transaction, nested call and business outcome are shown separately. Historical evidence does not replace the current state."
      />
      {!workspace ? (
        <NoWorkspace {...props} />
      ) : (
        <>
          {!!workspace.handoffs?.length && (
            <Card title="Previous control handoffs">
              {workspace.handoffs.map((handoff, index) => (
                <div className="archived-handoff" key={handoff.id}>
                  <strong>Handoff {index + 1}</strong>
                  <div>
                    <Address value={handoff.from} />
                    <Icon name="arrow" size={16} />
                    <Address value={handoff.to} />
                  </div>
                  <small>
                    {handoff.continued
                      ? "Control change and continuation record saved"
                      : "Control change record saved"}{" "}
                    · {new Date(handoff.completedAt).toLocaleString()}
                  </small>
                </div>
              ))}
            </Card>
          )}
          <Card
            className="proof-card"
            title={
              workspace.continuity === "continued" ||
              workspace.continuity === "drift"
                ? "Grant continuation recorded"
                : workspace.continuity === "rotated"
                  ? "Control change recorded"
                  : "Continuation evidence is not complete yet"
            }
            action={
              <Badge tone={stateTone(workspace.continuity)}>
                {
                  {
                    "not-started": "Pending",
                    rotated: "Rotated",
                    continued: "Continued",
                    drift: "Historical evidence",
                    unknown: "Unknown",
                  }[workspace.continuity]
                }
              </Badge>
            }
          >
            <p>{workspace.continuityDetail}</p>
            <div className="proof-chain">
              <span>
                <Icon name="shield" size={18} />
                The same P
              </span>
              <Icon name="arrow" size={16} />
              <span>Exact previous-controller removal</span>
              <Icon name="arrow" size={16} />
              <span>Separate next-milestone submission</span>
            </div>
          </Card>
          {workspace.history.length ? (
            workspace.history.map((entry) => (
              <Card key={entry.id}>
                <ActivityRow entry={entry} />
                {entry.layers && (
                  <div className="receipt-layers">
                    {entry.layers.map((layer) => (
                      <div key={layer.label}>
                        <span>{layer.label}</span>
                        <Badge tone={layer.tone ?? "neutral"}>
                          {layer.value}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                {entry.txHash && (
                  <KeyValues
                    rows={[
                      {
                        label: "Transaction",
                        value: <Address value={entry.txHash} format="hex" />,
                      },
                    ]}
                  />
                )}
                {entry.unresolved &&
                  snapshot.operation?.id === entry.operationId && (
                    <Button
                      icon="refresh"
                      onClick={() =>
                        void props.run({
                          type: "reconcile-operation",
                          id: snapshot.operation!.id,
                        })
                      }
                    >
                      Reconcile this attempt
                    </Button>
                  )}
                {entry.evidence && (
                  <Evidence
                    value={entry.evidence}
                    title="Record evidence and technical details"
                  />
                )}
              </Card>
            ))
          ) : (
            <EmptyState title="No history yet" icon="history">
              Verified operations, rejections and unresolved attempts appear
              here. No events are fabricated.
            </EmptyState>
          )}
          {snapshot.actions
            .filter((action) => action.category === "maintenance")
            .map((action) => (
              <Card key={action.id} title={action.title}>
                <p>{action.description}</p>
                <ActionButton action={action} openAction={openAction} />
              </Card>
            ))}
        </>
      )}
    </>
  );
}
