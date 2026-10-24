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
          eyebrow="Ваш робочий простір"
          title="Команда змінюється. Грант залишається."
          description="Створіть сталого бенефіціара та керуйте передачею повноважень із перевіркою кожного результату."
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
        eyebrow="Робочий простір / огляд"
        title={workspace.name}
        description="Сталий бенефіціар. Прозорі повноваження. Наступна дія — з перевіреним результатом."
        actions={
          <Button
            icon="refresh"
            disabled={!!snapshot.busy}
            onClick={() => void props.run({ type: "refresh" })}
          >
            Оновити стан
          </Button>
        }
      />
      <div className="overview-grid">
        <Card
          className="next-task"
          eyebrow="Наступний крок"
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
                Відкрити наступний крок
              </Button>
            )}
          </div>
          <div className="next-task__footer">
            <Icon name="shield" size={16} />
            <span>Кожна дія має окремий перегляд і підпис.</span>
          </div>
        </Card>
        <Card eyebrow="Незмінна ідентичність" title="Бенефіціар гранту">
          <div className="beneficiary-emblem">
            <Icon name="shield" size={30} />
            <span>P</span>
          </div>
          <Identity identity={workspace.beneficiary} />
          <div className="identity-secondary">
            <span>Адреса в застосунку</span>
            <Address value={workspace.beneficiary?.mappedAddress} compact />
          </div>
        </Card>
      </div>
      {workspace.authority === "DualControl" && (
        <Notice tone="warning" title="Період спільних повноважень">
          M0 і M1 зараз можуть діяти від імені бенефіціара. Завершіть окреме
          вилучення M0 та перевірте повний список дозволів.
        </Notice>
      )}
      {workspace.authority === "Diverged" && (
        <Notice tone="negative" title="Конфігурація повноважень змінилася">
          Виявлено неочікувані права. Перевірте історію й точний список
          делегатів перед новими діями.
        </Notice>
      )}
      <div className="summary-grid">
        <Card eyebrow="Грант">
          <div className="metric">
            {workspace.grantTotal ?? "—"} <span>{workspace.symbol}</span>
          </div>
          <p>
            {workspace.grantId
              ? `Грант #${workspace.grantId}`
              : "Грант ще не прив’язано"}{" "}
            · {workspace.milestones.length} етапи
          </p>
        </Card>
        <Card eyebrow="Керування">
          <div className="metric">
            {workspace.oldController.threshold}{" "}
            <span>із {workspace.oldController.members.length}</span>
          </div>
          <Badge tone={stateTone(workspace.authority)}>
            {authorityText[workspace.authority]}
          </Badge>
        </Card>
        <Card eyebrow="Спостереження">
          <div className="metric">
            {snapshot.network.blockNumber ?? "—"} <span>блок</span>
          </div>
          <Badge
            tone={
              snapshot.network.connected && snapshot.network.blockHash
                ? "positive"
                : "warning"
            }
          >
            {snapshot.network.connected && snapshot.network.blockHash
              ? "Фіналізований якір"
              : snapshot.network.connected
                ? "Перевіряємо якір"
                : "Очікуємо підключення"}
          </Badge>
        </Card>
      </div>
      <div className="section-heading">
        <h2>Етапи гранту</h2>
        <button
          className="text-button"
          type="button"
          onClick={() => navigate("milestones")}
        >
          Усі деталі <Icon name="arrow" size={15} />
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
            Після створення або підключення гранту тут з’являться його етапи.
          </p>
        </Card>
      )}
      <div className="section-heading">
        <h2>Останні дії</h2>
        <button
          className="text-button"
          type="button"
          onClick={() => navigate("history")}
        >
          Повна історія <Icon name="arrow" size={15} />
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
            Підтверджених операцій ще немає. Події з’являться після їх отримання
            та перевірки.
          </p>
        )}
      </Card>
    </>
  );
}
