import {
  Address,
  Badge,
  Button,
  Card,
  Icon,
  Identity,
  Notice,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import {
  authorityText,
  stateTone,
  ActionButton,
  NoWorkspace,
  MilestoneCard,
  ActivityRow,
} from "./shared";

export function Overview(props: ScreenProps) {
  const { snapshot, navigate, openAction } = props;
  const workspace = snapshot.workspace;
  if (!workspace)
    return (
      <>
        <PageHeader
          eyebrow="Your workspace"
          title="The team changes. The grant stays."
          description="Create a stable beneficiary and manage a control handoff with verified outcomes."
        />
        <NoWorkspace {...props} />
      </>
    );
  const taskAction = snapshot.actions.find(
    (action) => action.id === workspace.currentTask.actionId,
  );
  return (
    <>
      <PageHeader
        eyebrow="Workspace / overview"
        title={workspace.name}
        description="Stable beneficiary. Visible authority. Each next action has a verified outcome."
        actions={
          <Button
            icon="refresh"
            disabled={!!snapshot.busy}
            onClick={() => void props.run({ type: "refresh" })}
          >
            Refresh state
          </Button>
        }
      />
      <div className="overview-grid">
        <Card
          className="next-task"
          eyebrow="Next step"
          title={workspace.currentTask.title}
        >
          <p className="next-task__description">
            {workspace.currentTask.detail}
          </p>
          <div className="actions">
            {taskAction ? (
              <ActionButton action={taskAction} openAction={openAction} />
            ) : (
              <Button
                variant="primary"
                icon="arrow"
                onClick={() =>
                  navigate(workspace.currentTask.destination ?? "network")
                }
              >
                Open the next step
              </Button>
            )}
          </div>
          <div className="next-task__footer">
            <Icon name="shield" size={16} />
            <span>Every action has a separate review and signature.</span>
          </div>
        </Card>
        <Card eyebrow="Stable identity" title="Grant beneficiary">
          <div className="beneficiary-emblem">
            <Icon name="shield" size={30} />
            <span>P</span>
          </div>
          <Identity identity={workspace.beneficiary} />
          <div className="identity-secondary">
            <span>Application address</span>
            <Address value={workspace.beneficiary?.mappedAddress} compact />
          </div>
        </Card>
      </div>
      {workspace.authority === "DualControl" && (
        <Notice tone="warning" title="Shared authority period">
          M0 and M1 can currently act for the beneficiary. Complete the separate
          M0 removal and verify the full permission inventory.
        </Notice>
      )}
      {workspace.authority === "Diverged" && (
        <Notice tone="negative" title="Authority configuration changed">
          Unexpected authority was found. Review the history and exact delegate
          inventory before taking further action.
        </Notice>
      )}
      <div className="summary-grid">
        <Card eyebrow="Grant">
          <div className="metric">
            {workspace.grantTotal ?? "—"} <span>{workspace.symbol}</span>
          </div>
          <p>
            {workspace.grantId
              ? `Grant #${workspace.grantId}`
              : "Grant not linked yet"}{" "}
            · {workspace.milestones.length} milestones
          </p>
        </Card>
        <Card eyebrow="Control">
          <div className="metric">
            {workspace.oldController.threshold}{" "}
            <span>of {workspace.oldController.members.length}</span>
          </div>
          <Badge tone={stateTone(workspace.authority)}>
            {authorityText[workspace.authority]}
          </Badge>
        </Card>
        <Card eyebrow="Observation">
          <div className="metric">
            {snapshot.network.blockNumber ?? "—"} <span>block</span>
          </div>
          <Badge
            tone={
              snapshot.network.connected && snapshot.network.blockHash
                ? "positive"
                : "warning"
            }
          >
            {snapshot.network.connected && snapshot.network.blockHash
              ? "Finalized anchor"
              : snapshot.network.connected
                ? "Checking the anchor"
                : "Waiting for a connection"}
          </Badge>
        </Card>
      </div>
      <div className="section-heading">
        <h2>Grant milestones</h2>
        <button
          className="text-button"
          type="button"
          onClick={() => navigate("milestones")}
        >
          All details <Icon name="arrow" size={15} />
        </button>
      </div>
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
        <Card>
          <p className="muted">
            Milestones appear here after a grant is created or linked.
          </p>
        </Card>
      )}
      <div className="section-heading">
        <h2>Recent activity</h2>
        <button
          className="text-button"
          type="button"
          onClick={() => navigate("history")}
        >
          Full history <Icon name="arrow" size={15} />
        </button>
      </div>
      <Card>
        {workspace.history.length ? (
          workspace.history
            .slice(0, 3)
            .map((entry) => (
              <ActivityRow
                key={entry.id}
                entry={entry}
                onInspect={() => navigate("history")}
              />
            ))
        ) : (
          <p className="muted">
            No verified operations yet. Events appear after they are received
            and verified.
          </p>
        )}
      </Card>
    </>
  );
}
