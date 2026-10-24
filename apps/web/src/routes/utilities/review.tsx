import { useEffect, useState, type FormEvent } from "react";
import {
  Address,
  Badge,
  Button,
  Card,
  EmptyState,
  Evidence,
  Icon,
  KeyValues,
  Notice,
  OperationInput,
  PageHeader,
} from "../../components/ui";
import type { ActionView } from "../../ui-contract";
import type { ScreenProps } from "../screen-types";

function ActionForm({
  action,
  props,
}: {
  action: ActionView;
  props: ScreenProps;
}) {
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      action.fields.map((field) => [
        field.name,
        field.value ?? field.options?.[0]?.value ?? "",
      ]),
    ),
  );
  const [error, setError] = useState("");
  async function prepare(event: FormEvent) {
    event.preventDefault();
    setError("");
    for (const field of action.fields) {
      const value = values[field.name] ?? "";
      if (field.required && !value.trim()) {
        setError(`Заповніть поле «${field.label}».`);
        return;
      }
      if (
        field.maxBytes &&
        new TextEncoder().encode(value).length > field.maxBytes
      ) {
        setError(
          `Поле «${field.label}» перевищує ${field.maxBytes} UTF-8 байт.`,
        );
        return;
      }
    }
    try {
      await props.run({
        type: "prepare-operation",
        actionId: action.id,
        fields: values,
        expectedRevision: props.snapshot.revision,
      });
    } catch {
      /* Global error is rendered without erasing form values. */
    }
  }
  return (
    <Card title="Параметри дії">
      <form onSubmit={(event) => void prepare(event)}>
        {action.fields.map((field) => (
          <OperationInput
            key={field.name}
            field={field}
            value={values[field.name] ?? ""}
            onChange={(value) =>
              setValues((current) => ({ ...current, [field.name]: value }))
            }
          />
        ))}
        {!action.fields.length && (
          <p className="muted">
            Параметри беруться з перевіреного стану простору. На наступному
            кроці ви побачите точну дію.
          </p>
        )}
        {action.blockers.length > 0 && (
          <Notice tone="warning" title="Спочатку виконайте передумови">
            <ul>
              {action.blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
          </Notice>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <Button
          variant="primary"
          icon="shield"
          type="submit"
          disabled={!action.enabled || !!props.snapshot.busy}
        >
          Підготувати до перегляду
        </Button>
      </form>
    </Card>
  );
}

export function Review(props: ScreenProps & { actionId: string | null }) {
  const { snapshot, actionId, navigate } = props;
  const operation = snapshot.operation;
  const action = snapshot.actions.find((item) => item.id === actionId);
  const [acknowledged, setAcknowledged] = useState(false);
  const active =
    operation && (!actionId || operation.actionId === actionId)
      ? operation
      : null;
  useEffect(() => {
    setAcknowledged(false);
  }, [active?.id, active?.stage, snapshot.wallet.selectedAddress]);
  return (
    <>
      <Button
        variant="ghost"
        icon="back"
        onClick={() =>
          navigate(action?.category === "handoff" ? "handoff" : "overview")
        }
      >
        Повернутися до задачі
      </Button>
      <PageHeader
        eyebrow="Окремий перегляд операції"
        title={active?.title ?? action?.title ?? "Перевірте заплановану дію"}
        description={
          active?.description ??
          action?.description ??
          "Оберіть дію в просторі, щоб переглянути її параметри й наслідки."
        }
      />
      {!active ? (
        action ? (
          <div className="overview-grid">
            <ActionForm key={action.id} action={action} props={props} />
            <Card title="Хто виконує дію">
              <KeyValues
                rows={[
                  { label: "Роль", value: action.actor },
                  {
                    label: "Особистий акаунт",
                    value: <Address value={snapshot.wallet.selectedAddress} />,
                  },
                  { label: "Середовище", value: snapshot.network.mode },
                ]}
              />
              <Notice title="Спочатку точний план">
                Підготовка не відкриває гаманець. Наступний крок покаже маршрут,
                ресурси та точні дані для підпису.
              </Notice>
            </Card>
          </div>
        ) : (
          <EmptyState
            title="Немає обраної дії"
            action={
              <Button variant="primary" onClick={() => navigate("overview")}>
                До огляду
              </Button>
            }
          >
            Відкрийте задачу з огляду, команди або етапів гранту.
          </EmptyState>
        )
      ) : (
        <div className="overview-grid">
          <div>
            <Card
              title="Наслідки та точні умови"
              action={<Badge tone={active.tone}>{active.stage}</Badge>}
            >
              <ul className="consequence-list">
                {active.consequences.map((consequence) => (
                  <li key={consequence}>
                    <Icon name="arrow" size={16} />
                    <span>{consequence}</span>
                  </li>
                ))}
              </ul>
              <KeyValues rows={active.terms} />
              <div className="field">
                <label className="checkbox-label">
                  <input
                    type="checkbox"
                    checked={acknowledged}
                    onChange={(event) => setAcknowledged(event.target.checked)}
                    disabled={!active.canSign && !active.canSend}
                  />
                  <span>
                    Я перевірив акаунт, маршрут, умови й наслідки цієї окремої
                    дії.
                  </span>
                </label>
              </div>
              {active.blockers.length > 0 && (
                <Notice tone="warning" title="Дію зараз заблоковано">
                  <ul>
                    {active.blockers.map((blocker) => (
                      <li key={blocker}>{blocker}</li>
                    ))}
                  </ul>
                </Notice>
              )}
              <div className="actions">
                {active.canSign && (
                  <Button
                    variant="primary"
                    icon="wallet"
                    disabled={!acknowledged || !!snapshot.busy}
                    onClick={() =>
                      void props.run({ type: "sign-operation", id: active.id })
                    }
                  >
                    Запросити підпис
                  </Button>
                )}
                {active.canSend && (
                  <Button
                    variant="primary"
                    icon="arrow"
                    disabled={!acknowledged || !!snapshot.busy}
                    onClick={() =>
                      void props.run({ type: "send-operation", id: active.id })
                    }
                  >
                    Надіслати підписану операцію
                  </Button>
                )}
                {active.canReconcile && (
                  <Button
                    icon="refresh"
                    disabled={!!snapshot.busy}
                    onClick={() =>
                      void props.run({
                        type: "reconcile-operation",
                        id: active.id,
                      })
                    }
                  >
                    Звірити результат
                  </Button>
                )}
                {active.canDiscard && (
                  <Button
                    variant="ghost"
                    disabled={!!snapshot.busy}
                    onClick={() =>
                      void props.run({
                        type: "discard-operation",
                        id: active.id,
                      })
                    }
                  >
                    Відкласти перегляд
                  </Button>
                )}
              </div>
              {active.canSend && (
                <p className="footnote">
                  Підписані байти збережені локально. Надсилання виконується
                  лише цією окремою командою.
                </p>
              )}
              {active.canReconcile && (
                <p className="footnote">
                  Звіряння читає результат наявної спроби. Воно не створює новий
                  nonce або новий підпис.
                </p>
              )}
            </Card>
            {active.callHex && (
              <Evidence
                title="Точний RuntimeCall і підтверджені ідентифікатори"
                value={{
                  call: active.callHex,
                  callHash: active.callHash,
                  transactionHash: active.txHash,
                }}
              />
            )}
            {active.evidence && (
              <Evidence title="Доказ результату" value={active.evidence} />
            )}
          </div>
          <div>
            <Card title="Маршрут виконання">
              <ol className="execution-route">
                {active.route.map((step, index) => (
                  <li key={`${index}-${step}`}>
                    <span>{index + 1}</span>
                    <code>{step}</code>
                  </li>
                ))}
              </ol>
              <KeyValues
                rows={[
                  {
                    label: "Підписант",
                    value: <Address value={active.signer?.address} />,
                  },
                  { label: "Роль", value: active.actor },
                ]}
              />
            </Card>
            <Card title="Комісії та резерви">
              {active.resources.length ? (
                <div className="resource-list">
                  {active.resources.map((resource, index) => (
                    <div key={`${resource.label}-${index}`}>
                      <span>
                        {resource.label}
                        <small>Сплачує: {resource.payer}</small>
                      </span>
                      <strong>{resource.amount}</strong>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="muted">
                  Оцінка ресурсів ще не отримана. Підпис дозволяється після
                  перевірки потрібних меж.
                </p>
              )}
            </Card>
            {active.approvals && (
              <Card title="Поточна native-пропозиція">
                <KeyValues
                  rows={[
                    {
                      label: "Схвалення",
                      value: `${active.approvals.approved.length} із ${active.approvals.required}`,
                    },
                    {
                      label: "Депозитор",
                      value: (
                        <Address value={active.approvals.depositor} compact />
                      ),
                    },
                    {
                      label: "Timepoint",
                      value: active.approvals.timepoint ?? "Ще не створено",
                    },
                  ]}
                />
                <p className="footnote">
                  Перше схвалення не виконує бізнес-дію. Фінальне схвалення
                  потребує власного перегляду та підпису.
                </p>
              </Card>
            )}
          </div>
        </div>
      )}
    </>
  );
}
