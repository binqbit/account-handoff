import {
  Address,
  Badge,
  Button,
  Card,
  Identity,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import { NoWorkspace } from "./shared";

export function Team(props: ScreenProps) {
  const { snapshot, navigate, openAction } = props;
  const workspace = snapshot.workspace;
  return (
    <>
      <PageHeader
        eyebrow="Команда і повноваження"
        title="Люди змінюються. Бенефіціар — той самий."
        description="Кожна група має свою адресу контролера. Особистий гаманець підписує лише дозволені для його власника дії."
        actions={
          workspace && (
            <Button
              variant="primary"
              icon="arrow"
              onClick={() => navigate("handoff")}
            >
              Передати керування
            </Button>
          )
        }
      />
      {!workspace ? (
        <NoWorkspace {...props} />
      ) : (
        <>
          <div className="equal-grid">
            {[workspace.oldController, workspace.newController].map(
              (controller, index) => (
                <Card
                  key={controller.address || index}
                  eyebrow={
                    index === 0 ? "Початкова група · M0" : "Наступна група · M1"
                  }
                  title={`${controller.threshold} із ${controller.members.length} підписантів`}
                  action={
                    <Badge
                      tone={
                        controller.active
                          ? workspace.authority === "DualControl"
                            ? "warning"
                            : "positive"
                          : "neutral"
                      }
                    >
                      {controller.active === null
                        ? "Не перевірено"
                        : controller.active
                          ? "Має повноваження"
                          : "Без повноважень"}
                    </Badge>
                  }
                >
                  <Address value={controller.address} />
                  <ul className="member-list">
                    {controller.members.map((member, memberIndex) => (
                      <li key={member.address}>
                        <span className="member-avatar">
                          {member.label?.slice(0, 1) ?? memberIndex + 1}
                        </span>
                        <Identity identity={member} />
                      </li>
                    ))}
                  </ul>
                </Card>
              ),
            )}
          </div>
          <Card
            title="Бюджети та ідентичності"
            eyebrow="Кошти для виконання операцій"
          >
            <div className="table-scroll">
              <table>
                <caption className="sr-only">
                  Операційні бюджети учасників та бенефіціара
                </caption>
                <thead>
                  <tr>
                    <th>Акаунт</th>
                    <th>Призначення</th>
                    <th>Вільні / доступні</th>
                    <th>Зарезервовано</th>
                    <th>Mapping</th>
                  </tr>
                </thead>
                <tbody>
                  {workspace.balances.map((balance) => (
                    <tr key={`${balance.identity.address}-${balance.role}`}>
                      <td>
                        <Identity identity={balance.identity} />
                      </td>
                      <td>{balance.role}</td>
                      <td>
                        {balance.free ?? "Невідомо"} /{" "}
                        {balance.available ?? "Невідомо"}{" "}
                        <span className="muted">{balance.symbol}</span>
                      </td>
                      <td>{balance.reserved ?? "Невідомо"}</td>
                      <td>
                        <Badge
                          tone={
                            balance.mapping === "verified"
                              ? "positive"
                              : balance.mapping === "missing"
                                ? "warning"
                                : "neutral"
                          }
                        >
                          {
                            {
                              verified: "Підтверджено",
                              missing: "Потрібне",
                              unknown: "Невідомо",
                              "not-required": "Не потрібне",
                            }[balance.mapping]
                          }
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!workspace.balances.length && (
                <p className="muted">
                  Баланси з’являться після читання фіналізованого стану.
                </p>
              )}
            </div>
            <div className="actions">
              {snapshot.actions
                .filter(
                  (action) =>
                    action.category === "funding" ||
                    action.id === "GRC-SETUP-MAP-ACTOR",
                )
                .map((action) => (
                  <Button key={action.id} onClick={() => openAction(action.id)}>
                    {action.title}
                  </Button>
                ))}
            </div>
            <p className="footnote">
              Комісії підписантів, резерви пропозицій, escrow фонду,
              mapping-hold і ліквідність P обліковуються окремо. Vesting не є
              доступним операційним бюджетом.
            </p>
          </Card>
        </>
      )}
    </>
  );
}
