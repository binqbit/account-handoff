import { Button, Card, Icon, Notice, PageHeader } from "../../components/ui";
import { HelpDisclosure } from "../../components/help-disclosure";
import { ReadinessCards } from "../../components/readiness";
import type { ScreenProps } from "../screen-types";
import { TeamForm } from "./setup/team-form";
import type { SetupDraftControls } from "./setup/draft";
import { networkReady, networkStatus } from "../../components/network-status";
import { deployment } from "../../config/deployment";

export function Setup(props: ScreenProps & SetupDraftControls) {
  const { snapshot, navigate, openAction, onConnectNetwork } = props;
  const workspace = snapshot.workspace;
  const ready = networkReady(snapshot.network);
  const showForm = ready || !!snapshot.network.updatedAt;
  return (
    <>
      <PageHeader
        icon="team"
        eyebrow="Team setup"
        title="Start with a stable beneficiary"
        description="Create a multisig configuration or connect your existing group."
      />
      {!showForm ? (
        <Card
          title={
            snapshot.network.checking || snapshot.network.reconnecting
              ? "Connecting to the network…"
              : "Connect before setting up your workspace"
          }
        >
          <p role="status">
            {snapshot.network.checking || snapshot.network.reconnecting
              ? "Checking the network connection. The workspace form will appear when the connection is ready."
              : snapshot.network.error && snapshot.network.retryable === false
                ? "The selected network could not be verified. Open network setup to review the problem before continuing."
                : "A network connection is required to create or connect a workspace. Open network setup to connect manually or try again."}
          </p>
          <p className="muted">
            Any workspace details already entered are kept while you reconnect
            or visit network setup. Keep this page open to retain your draft.
          </p>
          {deployment.isTestnet && snapshot.network.retryable && (
            <p role="status">
              The app will retry automatically when the connection is available.
              You can also reconnect manually.
            </p>
          )}
          {snapshot.network.error && (
            <Notice tone="negative">{snapshot.network.error}</Notice>
          )}
          <Button icon="network" onClick={onConnectNetwork}>
            Open network setup
          </Button>
        </Card>
      ) : (
        <div className="setup-layout">
          {!ready && (
            <Notice
              tone={
                snapshot.network.retryable === false ? "negative" : "warning"
              }
              title={networkStatus(snapshot.network)}
            >
              <p>
                Your draft stays editable. Saving the workspace waits until the
                network connection and current state are verified.
              </p>
              {snapshot.network.error && <p>{snapshot.network.error}</p>}
              <button className="text-button" onClick={onConnectNetwork}>
                Open network setup
              </button>
            </Notice>
          )}
          <HelpDisclosure title="How setup works">
            <div
              className="identity-flow"
              aria-label="The signing group can change while the beneficiary stays the same"
            >
              <span>
                <Icon name="team" />
                <strong>Current</strong>
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
                <strong>Next</strong>
                <small>New team</small>
              </span>
            </div>
            <ol className="setup-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Define the team</strong>
                  <p>
                    The current signers, funder and reviewers. Choose a
                    replacement group only when you start a handoff.
                  </p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Create beneficiary P</strong>
                  <p>
                    A stable native account controlled by your multisig. Its
                    mapped EVM address receives the grant.
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
            <p>
              This flow creates a grant for the stable P. It does not change the
              beneficiary of an existing personal grant.
            </p>
            <p>
              Choose a known account or paste a native address and press Enter.
              Native addresses use SS58 or 0x + 64 hex characters. Contract
              addresses use 0x + 40 hex characters.
            </p>
          </HelpDisclosure>
          <TeamForm key={snapshot.network.mode} {...props} />
        </div>
      )}
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
