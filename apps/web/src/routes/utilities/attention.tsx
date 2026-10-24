import {
  Address,
  Badge,
  Button,
  Card,
  EmptyState,
  Evidence,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";

export function Attention(props: ScreenProps) {
  const entries =
    props.snapshot.workspace?.history.filter((entry) => entry.unresolved) ?? [];
  const operation = props.snapshot.operation;
  return (
    <>
      <PageHeader
        eyebrow="Потребує уваги"
        title="З’ясуйте результат перед наступною дією"
        description="Невідомий результат не означає помилку транзакції. Перевірте наявну спробу та native-пропозицію."
      />
      {operation &&
        (operation.canReconcile || operation.blockers.length > 0) && (
          <Card
            title={operation.title}
            action={<Badge tone={operation.tone}>{operation.stage}</Badge>}
          >
            <p>{operation.description}</p>
            {operation.blockers.map((blocker) => (
              <p className="muted" key={blocker}>
                {blocker}
              </p>
            ))}
            <Button
              variant="primary"
              icon="arrow"
              onClick={() => props.navigate("review", operation.actionId)}
            >
              Відкрити спробу
            </Button>
          </Card>
        )}
      {entries.map((entry) => (
        <Card
          key={entry.id}
          title={entry.title}
          action={<Badge tone="warning">{entry.state}</Badge>}
        >
          <p>{entry.detail}</p>
          {entry.txHash && <Address value={entry.txHash} />}
          {entry.operationId && operation?.id === entry.operationId && (
            <Button
              icon="refresh"
              onClick={() =>
                void props.run({
                  type: "reconcile-operation",
                  id: operation.id,
                })
              }
            >
              Звірити цю спробу
            </Button>
          )}
          {entry.evidence && <Evidence value={entry.evidence} />}
        </Card>
      ))}
      {!entries.length && !operation?.canReconcile && (
        <EmptyState icon="check" title="Нез’ясованих спроб не знайдено">
          Це стан відомих цьому браузеру записів. Оновіть простір, щоб звірити
          поточні мережеві дані.
        </EmptyState>
      )}
      {props.snapshot.actions
        .filter((action) => action.category === "recovery")
        .map((action) => (
          <Card key={action.id} title={action.title}>
            <p>{action.description}</p>
            <Button onClick={() => props.openAction(action.id)}>
              Перевірити скасування
            </Button>
          </Card>
        ))}
    </>
  );
}
