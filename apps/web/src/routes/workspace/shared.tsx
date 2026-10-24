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
  M0: "Початкова група M0",
  DualControl: "Обидві групи мають владу",
  M1: "Нова група M1",
  Diverged: "Неочікувані повноваження",
  Unknown: "Потрібна перевірка",
};
const milestoneText: Record<MilestoneView["state"], string> = {
  Open: "Відкритий",
  Submitted: "На розгляді",
  Released: "Виплачено",
  Reclaimed: "Повернуто фонду",
  Unknown: "Стан невідомий",
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
      title="Спочатку відкрийте робочий простір"
      icon="overview"
      action={
        <>
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate("setup")}
          >
            Створити простір
          </Button>
          <Button icon="upload" onClick={() => navigate("data")}>
            Імпортувати дані
          </Button>
        </>
      }
    >
      Тут з’являться бенефіціар, команда, етапи гранту та підтверджені дії.
      Відомі простори зберігаються в цьому браузері.
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
      eyebrow={`Етап ${milestone.index + 1}`}
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
          { label: "Раунд", value: milestone.round ?? "Невідомо" },
          { label: "Строк", value: milestone.deadline ?? "Потрібна перевірка" },
          {
            label: "Умови виплати",
            value: milestone.vesting ?? "Без нового vesting",
          },
          {
            label: "Схвалення",
            value:
              milestone.approvals === null
                ? "Невідомо"
                : `${milestone.approvals.length} із ${milestone.requiredApprovals}`,
          },
        ]}
      />
      {milestone.evidence && (
        <div className="submitted-evidence">
          <span className="eyebrow">Опублікований доказ</span>
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
          {entry.block && <span>Блок {entry.block}</span>}
          {entry.timestamp && <time>{entry.timestamp}</time>}
        </div>
        {onInspect && (
          <button type="button" className="text-button" onClick={onInspect}>
            Відкрити запис <Icon name="arrow" size={14} />
          </button>
        )}
      </div>
    </article>
  );
}
