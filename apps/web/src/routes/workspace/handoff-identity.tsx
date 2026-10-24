import { Address, Card, Icon, KeyValues } from "../../components/ui";
import type { WorkspaceView } from "../../ui-contract";

type Comparison = NonNullable<WorkspaceView["identityComparison"]>[number];

function comparisonState(row: Comparison) {
  if (row.matches === false) return "changed";
  return row.matches === true && row.before && row.current
    ? "unchanged"
    : "unknown";
}

export function HandoffIdentity({ workspace }: { workspace: WorkspaceView }) {
  const comparison = workspace.identityComparison ?? [];
  const changed = comparison.filter(
    (row) => comparisonState(row) === "changed",
  );
  const unknown = comparison.filter(
    (row) => comparisonState(row) === "unknown",
  );
  const status = changed.length
    ? {
        kind: "changed",
        title: "Identity changed",
        detail: `Changed: ${changed.map((row) => row.label).join(", ")}.${unknown.length ? " Some addresses still need verification." : ""}`,
      }
    : unknown.length
      ? {
          kind: "unknown",
          title: "Verification incomplete",
          detail: `Not verified: ${unknown.map((row) => row.label).join(", ")}.`,
        }
      : comparison.length
        ? {
            kind: "unchanged",
            title: "Identity unchanged",
            detail: "Checked addresses match the saved grant checkpoint.",
          }
        : {
            kind: "unknown",
            title: "Not compared yet",
            detail:
              "Comparison becomes available after a grant checkpoint is saved.",
          };
  return (
    <Card
      eyebrow="Stable identity"
      title="The grant stays with the beneficiary"
    >
      <KeyValues
        rows={[
          {
            label: "Native beneficiary",
            value: <Address value={workspace.beneficiary?.address} />,
          },
          {
            label: "Grant recipient",
            value: <Address value={workspace.beneficiary?.mappedAddress} />,
          },
          {
            label: "Grant contract",
            value: <Address value={workspace.contract} />,
          },
          {
            label: "Grant",
            value:
              workspace.grantId === null
                ? "Not connected"
                : `#${workspace.grantId}`,
          },
        ]}
      />
      <div
        className={`identity-status identity-status--${status.kind}`}
        role={changed.length ? "alert" : "status"}
        aria-label="Identity verification"
      >
        <Icon
          name={
            status.kind === "unchanged"
              ? "check"
              : status.kind === "changed"
                ? "alert"
                : "info"
          }
          size={18}
        />
        <div>
          <strong>{status.title}</strong>
          <p>{status.detail}</p>
        </div>
      </div>
      {comparison.length > 0 && (
        <details className="identity-comparison" open={changed.length > 0}>
          <summary>
            <span>
              {changed.length ? "Review changed addresses" : "View comparison"}
            </span>
            <Icon name="down" size={14} />
          </summary>
          {comparison.map((row) => (
            <div
              className={`identity-comparison__row identity-comparison__row--${comparisonState(row)}`}
              key={row.label}
            >
              <div className="identity-comparison__heading">
                <strong>{row.label}</strong>
                <span>
                  {comparisonState(row) === "changed"
                    ? "Changed"
                    : comparisonState(row) === "unchanged"
                      ? "Unchanged"
                      : "Not verified"}
                </span>
              </div>
              <dl>
                {comparisonState(row) === "unchanged" ? (
                  <div>
                    <dt>Saved and current</dt>
                    <dd>
                      <Address value={row.current} />
                    </dd>
                  </div>
                ) : (
                  <>
                    <div>
                      <dt>Saved</dt>
                      <dd>
                        <Address value={row.before} />
                      </dd>
                    </div>
                    <div>
                      <dt>Current</dt>
                      <dd>
                        <Address value={row.current} />
                      </dd>
                    </div>
                  </>
                )}
              </dl>
            </div>
          ))}
        </details>
      )}
    </Card>
  );
}
