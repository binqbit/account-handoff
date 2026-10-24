import {
  Address,
  Card,
  Identity,
  KeyValues,
  Notice,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import { ActionButton, NoWorkspace, MilestoneCard } from "./shared";

export function Milestones(props: ScreenProps) {
  const { snapshot, openAction } = props;
  const workspace = snapshot.workspace;
  return (
    <>
      <PageHeader
        eyebrow="Грант і етапи"
        title="Продовжуйте роботу над тим самим грантом"
        description="Подання, схвалення й виплата мають різні результати. Тут видно умови та стан кожного етапу."
      />
      {!workspace ? (
        <NoWorkspace {...props} />
      ) : (
        <>
          <Card title="Умови гранту">
            <div className="equal-grid">
              <KeyValues
                rows={[
                  {
                    label: "Грант",
                    value: workspace.grantId
                      ? `#${workspace.grantId}`
                      : "Ще не створено",
                  },
                  {
                    label: "Контракт",
                    value: <Address value={workspace.contract} />,
                  },
                  {
                    label: "Бенефіціар",
                    value: (
                      <Address value={workspace.beneficiary?.mappedAddress} />
                    ),
                  },
                ]}
              />
              <KeyValues
                rows={[
                  {
                    label: "Фонд",
                    value: <Identity identity={workspace.funder} />,
                  },
                  {
                    label: "Рецензенти",
                    value: workspace.reviewers.length
                      ? workspace.reviewers
                          .map(
                            (reviewer) =>
                              reviewer.label ??
                              `${reviewer.address.slice(0, 8)}…`,
                          )
                          .join(", ")
                      : "Не задані",
                  },
                  { label: "Поріг рецензентів", value: "2 схвалення" },
                ]}
              />
            </div>
          </Card>
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
            <Card title="Грант ще не створено">
              <p className="muted">
                Спочатку потрібно підтвердити створення P, його mapping і
                бюджет, потім фонд створює грант для h(P).
              </p>
              {snapshot.actions
                .filter((action) => action.id === "GRC-GRANT-CREATE")
                .map((action) => (
                  <ActionButton
                    key={action.id}
                    action={action}
                    openAction={openAction}
                  />
                ))}
            </Card>
          )}
          <Notice title="Схвалення може одразу виплатити транш">
            Якщо ваш голос досягає порога рецензентів, виплата відбудеться в тій
            самій операції. Перед підписом перевірте суму та умови vesting.
          </Notice>
        </>
      )}
    </>
  );
}
