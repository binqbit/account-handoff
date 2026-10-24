import {
  Address,
  Badge,
  Button,
  Card,
  EmptyState,
  Evidence,
  Icon,
  KeyValues,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import { stateTone, ActionButton, NoWorkspace, ActivityRow } from "./shared";

export function History(props: ScreenProps) {
  const { snapshot, openAction } = props;
  const workspace = snapshot.workspace;
  return (
    <>
      <PageHeader
        eyebrow="Історія та докази"
        title="Результат, який можна перевірити"
        description="Зовнішня транзакція, вкладений виклик і бізнес-результат показані окремо. Історичний доказ не підмінює поточний стан."
      />
      {!workspace ? (
        <NoWorkspace {...props} />
      ) : (
        <>
          <Card
            className="proof-card"
            title={
              workspace.continuity === "continued" ||
              workspace.continuity === "drift"
                ? "Продовження гранту зафіксовано"
                : workspace.continuity === "rotated"
                  ? "Керування змінено. Потрібне продовження."
                  : "Доказ продовження ще не сформовано"
            }
            action={
              <Badge tone={stateTone(workspace.continuity)}>
                {
                  {
                    "not-started": "Очікується",
                    rotated: "Rotated",
                    continued: "Continued",
                    drift: "Історичний доказ",
                    unknown: "Невідомо",
                  }[workspace.continuity]
                }
              </Badge>
            }
          >
            <p>{workspace.continuityDetail}</p>
            <div className="proof-chain">
              <span>
                <Icon name="shield" size={18} />
                Той самий P
              </span>
              <Icon name="arrow" size={16} />
              <span>Точне вилучення M0</span>
              <Icon name="arrow" size={16} />
              <span>Окреме подання M1</span>
            </div>
          </Card>
          {workspace.history.length ? (
            workspace.history.map((entry) => (
              <Card key={entry.id}>
                <ActivityRow entry={entry} />
                {entry.layers && (
                  <div className="receipt-layers">
                    {entry.layers.map((layer) => (
                      <div key={layer.label}>
                        <span>{layer.label}</span>
                        <Badge tone={layer.tone ?? "neutral"}>
                          {layer.value}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
                {entry.txHash && (
                  <KeyValues
                    rows={[
                      {
                        label: "Транзакція",
                        value: <Address value={entry.txHash} />,
                      },
                    ]}
                  />
                )}
                {entry.unresolved &&
                  snapshot.operation?.id === entry.operationId && (
                    <Button
                      icon="refresh"
                      onClick={() =>
                        void props.run({
                          type: "reconcile-operation",
                          id: snapshot.operation!.id,
                        })
                      }
                    >
                      Звірити цю спробу
                    </Button>
                  )}
                {entry.evidence && (
                  <Evidence
                    value={entry.evidence}
                    title="Доказ і технічні деталі запису"
                  />
                )}
              </Card>
            ))
          ) : (
            <EmptyState title="Історія ще порожня" icon="history">
              Тут зберігатимуться підтверджені операції, відмови та нез’ясовані
              спроби. Жодних подій не підставляється автоматично.
            </EmptyState>
          )}
          {snapshot.actions
            .filter((action) => action.category === "maintenance")
            .map((action) => (
              <Card key={action.id} title={action.title}>
                <p>{action.description}</p>
                <ActionButton action={action} openAction={openAction} />
              </Card>
            ))}
        </>
      )}
    </>
  );
}
