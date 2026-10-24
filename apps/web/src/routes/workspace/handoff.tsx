import {
  Address,
  Button,
  Card,
  Icon,
  Identity,
  KeyValues,
  Notice,
  PageHeader,
} from "../../components/ui";
import { HandoffPlan } from "./handoff-plan";
import { HandoffIdentity } from "./handoff-identity";
import type { ScreenProps } from "../screen-types";
import { ActionButton, NoWorkspace } from "./shared";

export function Handoff(props: ScreenProps) {
  const { snapshot, navigate, openAction } = props;
  const workspace = snapshot.workspace;
  if (!workspace)
    return (
      <>
        <PageHeader
          icon="handoff"
          eyebrow="Control handoff"
          title="Select a workspace"
          description="A handoff requires a known beneficiary, the current controller and an available quorum."
        />
        <NoWorkspace {...props} />
      </>
    );
  if (!workspace.newController)
    return (
      <>
        <PageHeader
          icon="handoff"
          eyebrow="Control handoff"
          title="Change who controls the beneficiary"
          description="Choose a replacement group when your team is ready."
        />
        <div className="overview-grid">
          <HandoffPlan {...props} />
          <HandoffIdentity workspace={workspace} />
        </div>
      </>
    );
  const stage =
    workspace.continuity === "continued" || workspace.continuity === "drift"
      ? 3
      : workspace.authority === "M1"
        ? 2
        : workspace.authority === "DualControl"
          ? 1
          : 0;
  const openNextMilestone = workspace.milestones.some(
    (item) => item.index === 1 && item.state === "Open",
  );
  const controlComplete = workspace.authority === "M1";
  const continuationRecorded =
    workspace.continuity === "continued" || workspace.continuity === "drift";
  const finished = stage === 3 || (controlComplete && !openNextMilestone);
  const actionIds = [
    "GRC-ROTATION-ADD-M1",
    "GRC-ROTATION-REMOVE-M0",
    "GRC-GRANT-SUBMIT-M1",
  ];
  const titles = [
    "Authorize the new group",
    "Remove the previous group",
    "Continue the grant",
  ];
  return (
    <>
      <Button variant="ghost" icon="back" onClick={() => navigate("team")}>
        Back to team
      </Button>
      <PageHeader
        icon="handoff"
        eyebrow="Control handoff"
        title="Three actions. One stable beneficiary."
        description="Replace the controller, then continue the same grant."
      />
      <ol className="stepper">
        {titles.map((title, index) => (
          <li
            key={title}
            className={index < stage ? "done" : index === stage ? "active" : ""}
            aria-current={index === stage ? "step" : undefined}
          >
            <span className="step-number">
              {index < stage ? <Icon name="check" size={16} /> : index + 1}
            </span>
            <span>{title}</span>
          </li>
        ))}
      </ol>
      <div className="overview-grid">
        <Card
          title={
            !finished
              ? (titles[stage] ?? "Hand off control")
              : continuationRecorded
                ? "Handoff and continuation recorded"
                : "Controller changed"
          }
        >
          <p className="lede">
            {finished && !continuationRecorded
              ? "The replacement group is the sole controller. There is no open next milestone to submit."
              : stage === 0
                ? "The current group authorizes the replacement. Both groups retain full authority until the next step."
                : stage === 1
                  ? "The replacement group removes the previous controller’s Any / 0 permission. The full delegate inventory is then checked."
                  : stage === 2
                    ? "The new group submits the next milestone separately. That action proves grant continuation."
                    : workspace.continuityDetail}
          </p>
          <KeyValues
            rows={[
              {
                label: "Before",
                value: <Address value={workspace.oldController.address} />,
              },
              {
                label: "New group",
                value: (
                  <Address value={workspace.newController?.address ?? ""} />
                ),
              },
              {
                label: "Beneficiary",
                value: <Identity identity={workspace.beneficiary} />,
              },
            ]}
          />
          <Notice tone={stage === 1 ? "warning" : "neutral"}>
            {stage === 0
              ? "The current group retains authority during the transition. Its quorum must remain available."
              : stage === 1
                ? "Both groups can act now. Removing the previous group does not cancel existing native proposals."
                : "Each action requires its own quorum approval from the replacement group."}
          </Notice>
          {!finished ? (
            <ActionButton
              action={snapshot.actions.find(
                (action) => action.id === actionIds[stage],
              )}
              openAction={openAction}
              label="Review the next action"
            />
          ) : (
            <Button
              variant="primary"
              icon="arrow"
              onClick={() => navigate("history")}
            >
              Open evidence
            </Button>
          )}
          {controlComplete && (
            <div className="actions">
              <Button
                icon="handoff"
                disabled={!!snapshot.busy}
                onClick={() => void props.run({ type: "next-handoff" })}
              >
                Start another handoff
              </Button>
            </div>
          )}
        </Card>
        <HandoffIdentity workspace={workspace} />
        <Card eyebrow="Before each action" title="What we verify">
          <ul className="check-list">
            <li>
              <Icon name="shield" />
              Exact authority inventory
            </li>
            <li>
              <Icon name="shield" />
              The same P and h(P)
            </li>
            <li>
              <Icon name="shield" />
              Grant, deadlines and current round
            </li>
            <li>
              <Icon name="shield" />
              Reserves, mapping and vesting
            </li>
            <li>
              <Icon name="shield" />
              Separate signer approval
            </li>
          </ul>
          <p className="footnote">
            Pre-signing verification does not block concurrent actions by other
            authorized participants.
          </p>
          <Button icon="network" onClick={() => navigate("network")}>
            Network and verification status
          </Button>
        </Card>
      </div>
    </>
  );
}
