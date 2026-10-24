import { Address, Badge, Card, Identity, KeyValues } from "../../components/ui";
import type { WorkspaceView } from "../../ui-contract";

export function HandoffIdentity({ workspace }: { workspace: WorkspaceView }) {
  const comparison = workspace.identityComparison;
  return (
    <Card
      eyebrow="Stable identity"
      title="The grant stays with the beneficiary"
    >
      <KeyValues
        rows={[
          {
            label: "Native beneficiary",
            value: <Identity identity={workspace.beneficiary} />,
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
      {comparison?.length ? (
        <div
          className="identity-checks"
          aria-label="Identity comparison with the saved baseline"
        >
          {comparison.map((row) => (
            <div key={row.label}>
              <span>{row.label}</span>
              <Badge
                tone={
                  row.matches === null
                    ? "neutral"
                    : row.matches
                      ? "positive"
                      : "negative"
                }
              >
                {row.matches === null
                  ? "Awaiting verification"
                  : row.matches
                    ? "Matches baseline"
                    : "Changed"}
              </Badge>
              <div>
                <Address value={row.before} />
                <span aria-label="compared with"> → </span>
                <Address value={row.current} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">
          The app compares these identities with the saved grant baseline during
          the handoff.
        </p>
      )}
    </Card>
  );
}
