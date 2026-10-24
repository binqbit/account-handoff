import {
  Badge,
  Button,
  Card,
  EmptyState,
  Icon,
  KeyValues,
} from "../../components/ui";
import type {
  ActionView,
  WorkspaceView,
  Tone,
  MilestoneView,
  HistoryEntryView,
} from "../../ui-contract";
import type { ScreenProps } from "../screen-types";

export const authorityText: Record<WorkspaceView["authority"], string> = {
  M0: "Original group M0",
  DualControl: "Both groups have authority",
  M1: "New group M1",
  Diverged: "Unexpected authority",
  Unknown: "Verification required",
};
const milestoneText: Record<MilestoneView["state"], string> = {
  Open: "Open",
  Submitted: "Submitted",
  Released: "Released",
  Reclaimed: "Reclaimed by funder",
  Unknown: "State unknown",
};
export const stateTone = (state: string): Tone =>
  ["Released", "M1", "continued"].includes(state)
    ? "positive"
    : ["DualControl", "Submitted", "rotated"].includes(state)
      ? "warning"
      : ["Diverged", "Reclaimed", "drift"].includes(state)
        ? "negative"
        : "neutral";
export function ActionButton({
  action,
  openAction,
  label,
}: {
  action: ActionView | undefined;
  openAction: (id: string) => void;
  label?: string;
}) {
  if (!action) return null;
  return (
    <Button
      variant="primary"
      icon="arrow"
      onClick={() => openAction(action.id)}
    >
      {label ?? action.title}
    </Button>
  );
}
export function NoWorkspace({ navigate }: ScreenProps) {
  return (
    <EmptyState
      title="Open a workspace first"
      icon="overview"
      action={
        <>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate("setup")}
          >
            Create workspace
          </Button>
          <Button icon="upload" onClick={() => navigate("data")}>
            Import data
          </Button>
        </>
      }
    >
      The beneficiary, team, milestones and verified actions appear here. Known
      workspaces are saved in this browser.
    </EmptyState>
  );
}
export function MilestoneCard({
  milestone,
  actions,
  openAction,
}: {
  milestone: MilestoneView;
  actions: ActionView[];
  openAction: (id: string) => void;
}) {
  return (
    <Card
      className="milestone-card"
      eyebrow={`Milestone ${milestone.index + 1}`}
      title={milestone.title}
      action={
        <Badge tone={stateTone(milestone.state)}>
          {milestoneText[milestone.state]}
        </Badge>
      }
    >
      <div className="milestone-amount">
        {milestone.amount}
        <span>{milestone.symbol}</span>
      </div>
      <KeyValues
        rows={[
          { label: "Round", value: milestone.round ?? "Unknown" },
          {
            label: "Deadline",
            value: milestone.deadline ?? "Verification required",
          },
          {
            label: "Release terms",
            value: milestone.vesting ?? "No new vesting",
          },
          {
            label: "Approvals",
            value:
              milestone.approvals === null
                ? "Unknown"
                : `${milestone.approvals.length} of ${milestone.requiredApprovals}`,
          },
        ]}
      />
      {milestone.evidence && (
        <div className="submitted-evidence">
          <span className="eyebrow">Published evidence</span>
          <p>{milestone.evidence}</p>
        </div>
      )}
      <div className="actions">
        {milestone.actions.map((id) => (
          <ActionButton
            key={id}
            action={actions.find((action) => action.id === id)}
            openAction={openAction}
          />
        ))}
      </div>
    </Card>
  );
}
export function ActivityRow({
  entry,
  onInspect,
}: {
  entry: HistoryEntryView;
  onInspect?: () => void;
}) {
  return (
    <article className="activity-row">
      <span className={`activity-marker activity-marker--${entry.tone}`}>
        <Icon
          name={
            entry.tone === "positive"
              ? "check"
              : entry.unresolved
                ? "alert"
                : "history"
          }
          size={16}
        />
      </span>
      <div className="activity-content">
        <div className="row">
          <h3>{entry.title}</h3>
          <Badge tone={entry.tone}>{entry.state}</Badge>
        </div>
        <p>{entry.detail}</p>
        <div className="activity-meta">
          {entry.block && <span>Block {entry.block}</span>}
          {entry.timestamp && <time>{entry.timestamp}</time>}
        </div>
        {onInspect && (
          <button type="button" className="text-button" onClick={onInspect}>
            Open record <Icon name="arrow" size={14} />
          </button>
        )}
      </div>
    </article>
  );
}
