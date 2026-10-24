import {
  Address,
  Card,
  Identity,
  KeyValues,
  Notice,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import { ActionButton, NoWorkspace, MilestoneCard } from "./shared";

export function Milestones(props: ScreenProps) {
  const { snapshot, openAction } = props;
  const workspace = snapshot.workspace;
  return (
    <>
      <PageHeader
        icon="milestones"
        eyebrow="Grant and milestones"
        title="Continue work on the same grant"
        description="Submission, approval and release have different outcomes. Review the terms and state of each milestone here."
      />
      {!workspace ? (
        <NoWorkspace {...props} />
      ) : (
        <>
          <Card title="Grant terms">
            <div className="equal-grid">
              <KeyValues
                rows={[
                  {
                    label: "Grant",
                    value: workspace.grantId
                      ? `#${workspace.grantId}`
                      : "Not created yet",
                  },
                  {
                    label: "Contract",
                    value: <Address value={workspace.contract} />,
                  },
                  {
                    label: "Beneficiary",
                    value: (
                      <Address value={workspace.beneficiary?.mappedAddress} />
                    ),
                  },
                ]}
              />
              <KeyValues
                rows={[
                  {
                    label: "Funder",
                    value: <Identity identity={workspace.funder} />,
                  },
                  {
                    label: "Reviewers",
                    value: workspace.reviewers.length
                      ? workspace.reviewers
                          .map(
                            (reviewer) =>
                              reviewer.label ??
                              `${reviewer.address.slice(0, 8)}…`,
                          )
                          .join(", ")
                      : "Not specified",
                  },
                  { label: "Reviewer threshold", value: "2 approvals" },
                ]}
              />
            </div>
          </Card>
          {workspace.milestones.length ? (
            <div className="equal-grid">
              {workspace.milestones.map((milestone) => (
                <MilestoneCard
                  key={milestone.id}
                  milestone={milestone}
                  actions={snapshot.actions}
                  openAction={openAction}
                />
              ))}
            </div>
          ) : (
            <Card title="Grant not created yet">
              <p className="muted">
                Verify P's creation, mapping and budget first. The funder then
                creates a grant for h(P).
              </p>
              {snapshot.actions
                .filter((action) => action.id === "GRC-GRANT-CREATE")
                .map((action) => (
                  <ActionButton
                    key={action.id}
                    action={action}
                    openAction={openAction}
                  />
                ))}
            </Card>
          )}
          <Notice title="Approval can immediately release a tranche">
            If your vote reaches the reviewer threshold, funds are released in
            the same operation. Check the amount and vesting terms before
            signing.
          </Notice>
        </>
      )}
    </>
  );
}
