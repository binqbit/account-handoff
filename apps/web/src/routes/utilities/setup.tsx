import { Button, Card, Icon, Notice, PageHeader } from "../../components/ui";
import { ReadinessCards } from "../../components/readiness";
import type { ScreenProps } from "../screen-types";
import { TeamForm } from "./setup/team-form";

export function Setup(props: ScreenProps) {
  const { snapshot, navigate, openAction } = props;
  const workspace = snapshot.workspace;
  return (
    <>
      <PageHeader
        icon="team"
        eyebrow="Team setup"
        title="Start with a stable beneficiary"
        description="Define the team first. Every creation, funding and mapping action has a separate review."
      />
      <div className="overview-grid setup-layout">
        <TeamForm {...props} />
        <div>
          <Card
            eyebrow="How it works"
            title="One beneficiary. A changing team."
          >
            <div
              className="identity-flow"
              aria-label="Control moves from original group M0 to new group M1 while beneficiary P stays the same"
            >
              <span>
                <Icon name="team" />
                <strong>M0</strong>
                <small>Original team</small>
              </span>
              <Icon name="arrow" size={17} />
              <span className="identity-flow__stable">
                <Icon name="shield" />
                <strong>P</strong>
                <small>Same beneficiary</small>
              </span>
              <Icon name="back" size={17} />
              <span>
                <Icon name="team" />
                <strong>M1</strong>
                <small>New team</small>
              </span>
            </div>
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
                  <p>
                    A stable native account controlled by M0. Its mapped EVM
                    address receives the grant.
                  </p>
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
