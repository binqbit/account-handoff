import { useId, useState, type FormEvent } from "react";
import { Button, Card, Icon, Notice, PageHeader } from "../../components/ui";
import type { WorkspaceInput } from "../../ui-contract";
import type { ScreenProps } from "../screen-types";
import { ReadinessCards } from "../../components/readiness";

function AddressField({
  label,
  value,
  onChange,
  help,
  multiline = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  help?: string;
  multiline?: boolean;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          rows={3}
          required
          aria-describedby={help ? helpId : undefined}
          spellCheck={false}
        />
      ) : (
        <input
          id={id}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          required
          aria-describedby={help ? helpId : undefined}
          autoComplete="off"
          spellCheck={false}
        />
      )}
      {help && (
        <p className="field__help" id={helpId}>
          {help}
        </p>
      )}
    </div>
  );
}

export function Setup(props: ScreenProps) {
  const { snapshot, run, navigate, openAction } = props;
  const [name, setName] = useState("");
  const [oldMembers, setOldMembers] = useState("");
  const [newMembers, setNewMembers] = useState("");
  const [funder, setFunder] = useState("");
  const [reviewers, setReviewers] = useState("");
  const [formError, setFormError] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [beneficiary, setBeneficiary] = useState("");
  const [contract, setContract] = useState("");
  const [grantId, setGrantId] = useState("");
  const workspace = snapshot.workspace;
  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError("");
    const parse = (input: string) =>
      input
        .split(/[\s,;]+/)
        .map((value) => value.trim())
        .filter(Boolean);
    const old = parse(oldMembers);
    const next = parse(newMembers);
    const judges = parse(reviewers);
    if (old.length !== 3 || next.length !== 3) {
      setFormError(
        "Потрібні три різні акаунти в кожній групі. Підтримується поріг 2 із 3.",
      );
      return;
    }
    if (new Set(old).size !== 3 || new Set(next).size !== 3) {
      setFormError("У межах групи акаунти не можуть повторюватися.");
      return;
    }
    if (judges.length !== 2 || new Set(judges).size !== 2) {
      setFormError("Вкажіть двох різних рецензентів.");
      return;
    }
    const input: WorkspaceInput = {
      name: name.trim(),
      oldMembers: old,
      newMembers: next,
      threshold: 2,
      funder: funder.trim(),
      reviewers: judges,
    };
    if (beneficiary.trim()) input.beneficiary = beneficiary.trim();
    if (contract.trim()) input.contract = contract.trim();
    if (grantId.trim()) input.grantId = grantId.trim();
    try {
      await run({ type: "create-workspace", input });
    } catch {
      /* Parent renders the command error. */
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Налаштування команди"
        title="Почніть зі сталого бенефіціара"
        description="Спочатку визначте команду. Кожна дія створення, фінансування та mapping проходить окремий перегляд."
      />
      <div className="overview-grid">
        <Card
          title={
            workspace ? "Відомості про новий простір" : "Назва, команда та ролі"
          }
        >
          <form onSubmit={(event) => void submit(event)}>
            <AddressField
              label="Назва простору"
              value={name}
              onChange={setName}
              help="Зрозуміла команді назва, до 80 символів."
            />
            <div className="equal-grid">
              <AddressField
                label="Початкова група M0 — три адреси"
                value={oldMembers}
                onChange={setOldMembers}
                multiline
                help="Одна native-адреса або AccountId32 на рядок. Поріг: 2 із 3."
              />
              <AddressField
                label="Нова група M1 — три адреси"
                value={newMembers}
                onChange={setNewMembers}
                multiline
                help="Замініть одного учасника. Група отримує окрему адресу контролера."
              />
            </div>
            <AddressField
              label="Акаунт фонду F"
              value={funder}
              onChange={setFunder}
              help="Прямий відправник, який створює й фінансує грант."
            />
            <AddressField
              label="Два акаунти рецензентів"
              value={reviewers}
              onChange={setReviewers}
              multiline
              help="Підтримується два рецензенти з порогом два. Вони схвалюють від власних акаунтів."
            />
            <button
              type="button"
              className="text-button"
              aria-expanded={advanced}
              onClick={() => setAdvanced(!advanced)}
            >
              {advanced
                ? "Приховати відомі адреси"
                : "Маю відомі адреси P та гранту"}
              <Icon name="chevron" size={14} />
            </button>
            {advanced && (
              <div className="advanced-fields">
                <p className="muted">
                  Ці значення потребують перевірки походження та актуального
                  стану. Введення адреси не підтверджує повноваження.
                </p>
                <div className="field">
                  <label htmlFor="known-pure">
                    Відомий native-бенефіціар P
                  </label>
                  <input
                    id="known-pure"
                    value={beneficiary}
                    onChange={(event) => setBeneficiary(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="known-contract">
                    Відомий контракт гранту
                  </label>
                  <input
                    id="known-contract"
                    value={contract}
                    onChange={(event) => setContract(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="known-grant">Ідентифікатор гранту</label>
                  <input
                    id="known-grant"
                    value={grantId}
                    onChange={(event) => setGrantId(event.target.value)}
                    inputMode="numeric"
                  />
                </div>
              </div>
            )}
            {formError && (
              <p className="form-error" role="alert">
                {formError}
              </p>
            )}
            <div className="actions">
              <Button
                variant="primary"
                type="submit"
                icon="arrow"
                disabled={
                  !!snapshot.busy || !name.trim() || name.trim().length > 80
                }
              >
                Зберегти команду
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => navigate("workspaces")}
              >
                Назад
              </Button>
            </div>
          </form>
        </Card>
        <div>
          <Card eyebrow="Послідовність" title="Один простір, окремі дії">
            <ol className="setup-steps">
              <li>
                <span>1</span>
                <div>
                  <strong>Визначте команду</strong>
                  <p>Початкова та наступна групи, фонд і рецензенти.</p>
                </div>
              </li>
              <li>
                <span>2</span>
                <div>
                  <strong>Створіть бенефіціара P</strong>
                  <p>Резерв, створення через M0, ліквідність і mapping.</p>
                </div>
              </li>
              <li>
                <span>3</span>
                <div>
                  <strong>Прив’яжіть грант</strong>
                  <p>Фонд створює грант для h(P) та фінансує етапи.</p>
                </div>
              </li>
            </ol>
          </Card>
          <Notice title="Бенефіціар від початку">
            Цей сценарій створює грант для сталого P. Він не змінює бенефіціара
            вже створеного персонального гранту.
          </Notice>
        </div>
      </div>
      {workspace && (
        <>
          <div className="section-heading">
            <h2>Налаштування: {workspace.name}</h2>
            <Button onClick={() => navigate("overview")}>
              Відкрити простір
            </Button>
          </div>
          <ReadinessCards rows={workspace.setupProgress} />
          <Card title="Наступні операції">
            <div className="operation-grid">
              {snapshot.actions
                .filter(
                  (action) =>
                    action.category === "setup" ||
                    action.category === "funding",
                )
                .map((action) => (
                  <div className="operation-tile" key={action.id}>
                    <h3>{action.title}</h3>
                    <p>{action.description}</p>
                    <Button onClick={() => openAction(action.id)}>
                      Перевірити дію
                    </Button>
                  </div>
                ))}
            </div>
          </Card>
        </>
      )}
    </>
  );
}
