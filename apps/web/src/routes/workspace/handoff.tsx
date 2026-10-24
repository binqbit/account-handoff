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
import type { ScreenProps } from "../screen-types";
import { ActionButton, NoWorkspace } from "./shared";

export function Handoff(props: ScreenProps) {
  const { snapshot, navigate, openAction } = props;
  const workspace = snapshot.workspace;
  if (!workspace)
    return (
      <>
        <PageHeader
          eyebrow="Передача керування"
          title="Оберіть робочий простір"
          description="Для передачі потрібні відомий бенефіціар, поточний контролер і його доступний кворум."
        />
        <NoWorkspace {...props} />
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
  const actionIds = [
    "GRC-ROTATION-ADD-M1",
    "GRC-ROTATION-REMOVE-M0",
    "GRC-GRANT-SUBMIT-M1",
  ];
  const titles = [
    "Додати нову групу M1",
    "Вилучити лише M0",
    "Продовжити грант",
  ];
  return (
    <>
      <Button variant="ghost" icon="back" onClick={() => navigate("team")}>
        До команди
      </Button>
      <PageHeader
        eyebrow="Передача керування"
        title="Три дії. Один сталий бенефіціар."
        description="Передайте повноваження новій групі та підтвердьте її роботу на тому самому гранті."
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
            stage < 3
              ? (titles[stage] ?? "Передати керування")
              : "Передачу та продовження перевірено"
          }
        >
          <p className="lede">
            {stage === 0
              ? "Початкова група додає M1. До наступного кроку обидві групи матимуть повну владу."
              : stage === 1
                ? "Нова група вилучає точний дозвіл M0 / Any / 0. Після цього перевіряється весь список делегатів."
                : stage === 2
                  ? "Нова група окремо подає наступний етап. Саме ця дія підтверджує продовження гранту."
                  : workspace.continuityDetail}
          </p>
          <KeyValues
            rows={[
              {
                label: "Було",
                value: <Address value={workspace.oldController.address} />,
              },
              {
                label: "Нова група",
                value: <Address value={workspace.newController.address} />,
              },
              {
                label: "Бенефіціар",
                value: <Identity identity={workspace.beneficiary} />,
              },
            ]}
          />
          <Notice tone={stage === 1 ? "warning" : "neutral"}>
            {stage === 0
              ? "M0 не заморожується під час переходу. Поточний кворум має залишатися доступним."
              : stage === 1
                ? "M0 і M1 зараз можуть діяти. Видалення M0 не скасовує старі native-пропозиції."
                : "Окремі підписи A та D потрібні і для вилучення M0, і для подання наступного етапу."}
          </Notice>
          {stage < 3 ? (
            <ActionButton
              action={snapshot.actions.find(
                (action) => action.id === actionIds[stage],
              )}
              openAction={openAction}
              label="Перевірити наступну дію"
            />
          ) : (
            <Button
              variant="primary"
              icon="arrow"
              onClick={() => navigate("history")}
            >
              Відкрити доказ
            </Button>
          )}
        </Card>
        <Card eyebrow="Перед кожною дією" title="Що перевіряємо">
          <ul className="check-list">
            <li>
              <Icon name="shield" />
              Точний список повноважень
            </li>
            <li>
              <Icon name="shield" />
              Той самий P та h(P)
            </li>
            <li>
              <Icon name="shield" />
              Грант, строки й поточний раунд
            </li>
            <li>
              <Icon name="shield" />
              Резерви, mapping і vesting
            </li>
            <li>
              <Icon name="shield" />
              Окреме схвалення підписанта
            </li>
          </ul>
          <p className="footnote">
            Перевірка перед підписом не блокує паралельні дії інших
            уповноважених учасників.
          </p>
          <Button icon="network" onClick={() => navigate("network")}>
            Стан мережі та перевірок
          </Button>
        </Card>
      </div>
    </>
  );
}
