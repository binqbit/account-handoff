import {
  OPERATION_REQUIREMENTS,
  type EnabledOperationId,
  type GateId,
} from "@account-handoff/contracts";
import type { ActionView, OperationField } from "../../ui-contract";
import type { ChainView, WorkspaceRecord } from "../models";
import { proof } from "./continuity";
import {
  authority,
  eq,
  mapped,
  stateFor,
  roleNames,
  type ParticipantRole,
} from "./shared";

const profileGates = new Set<GateId>([
  "Q-RUNTIME",
  "Q-CURRENCY",
  "Q-MAPPING",
  "Q-REVIVE-API",
  "Q-VESTING",
  "Q-CONTRACT",
  "Q-ADAPTER",
  "Q-RECEIPTS",
]);
function roles(
  workspace: WorkspaceRecord,
  keys: ParticipantRole[],
): { value: string; label: string }[] {
  return keys.map((role) => ({ value: role, label: roleNames[role] }));
}
function amountField(symbol: string): OperationField {
  return {
    name: "amount",
    label: `Сума (${symbol})`,
    type: "number",
    required: true,
    placeholder: "0.00",
    help: "Десяткова сума в токенах мережі. Перед підписом буде показано точні native units і комісію.",
  };
}
function roleField(
  workspace: WorkspaceRecord,
  name: string,
  label: string,
  keys: ParticipantRole[],
  initial?: string,
): OperationField {
  return {
    name,
    label,
    type: "select",
    required: true,
    options: roles(workspace, keys),
    value: initial ?? keys[0]!,
  };
}
export function actionViews(
  workspace: WorkspaceRecord | null,
  chain: ChainView | null,
  selectedSigner: string | null,
): ActionView[] {
  if (!workspace) return [];
  const symbol = chain?.fingerprint.tokenSymbol ?? "native";
  const current = authority(workspace, chain);
  const actorState = stateFor(chain, selectedSigner);
  const pureState = stateFor(chain, workspace.pure);
  const selectedRoles = (
    Object.entries(workspace.participants) as [ParticipantRole, string][]
  )
    .filter(([, address]) => eq(address, selectedSigner))
    .map(([role]) => role);
  const oldMember = workspace.M0.members.some((member) =>
    eq(member, selectedSigner),
  );
  const newMember = workspace.M1.members.some((member) =>
    eq(member, selectedSigner),
  );
  const common: string[] = [];
  if (!chain) common.push("Підключіть мережу та отримайте фіналізований стан.");
  if (chain && chain.profile.status !== "accepted")
    common.push(
      "Профіль мережі заблокований або застарів. Потрібне повторне звіряння.",
    );
  if (!selectedSigner)
    common.push("Підключіть гаманець і виберіть особистий акаунт.");
  if (chain && !eq(chain.fingerprint.genesis, workspace.genesis))
    common.push("Простір належить іншій мережі.");
  if (
    chain &&
    ((workspace.mode === "LOCAL" && chain.localDescriptor?.mode !== "LOCAL") ||
      (workspace.mode !== "LOCAL" && chain.localDescriptor))
  )
    common.push("Профіль середовища не відповідає простору.");
  if (chain?.localDescriptor?.status === "retired")
    common.push("Локальний запуск завершено. Потрібен чинний runId.");
  if (selectedSigner && chain && !actorState)
    common.push("Бюджет вибраного підписанта ще не прочитано.");
  if (actorState && actorState.free <= actorState.frozen)
    common.push(
      "У вибраного підписанта немає відомих доступних коштів для комісії.",
    );
  const requireOld = (): string[] => [
    ...(!oldMember ? ["Потрібен підписант початкової групи M0."] : []),
    ...(!["M0", "DualControl"].includes(current)
      ? ["Повноваження M0 не підтверджені."]
      : []),
  ];
  const requireNew = (): string[] => [
    ...(!newMember ? ["Потрібен підписант нової групи M1."] : []),
    ...(!["M1", "DualControl"].includes(current)
      ? ["Повноваження M1 не підтверджені."]
      : []),
  ];
  const requirePure = (): string[] =>
    !workspace.pure
      ? ["Спочатку створіть і підтвердьте бенефіціара P."]
      : workspace.creationEvidence.some(
            (entry) =>
              entry.kind === "native_chain" &&
              /^0x[0-9a-f]{64}\/\d+$/.test(entry.locator) &&
              /^0x[0-9a-f]{64}$/.test(entry.sourceId ?? ""),
          )
        ? []
        : ["Потрібне підтверджене походження Pure з події PureCreated."];
  const requireMapping = (): string[] =>
    mapped(pureState)
      ? []
      : ["Потрібне підтверджене постійне mapping P → h(P) → P."];
  const requireGrant = (): string[] =>
    workspace.grantId !== null && workspace.contract && chain?.grant
      ? requirePure()
      : ["Спочатку створіть або перевірте грант для бенефіціара P."];
  const grant = chain?.grant;
  const milestone = (index: number) => grant?.milestones[index];
  const requireOpen = (index: number): string[] => {
    const value = milestone(index);
    if (!value) return ["Стан етапу ще не прочитано."];
    return value.state === 0 && value.round === 0
      ? []
      : [
          "Потрібен відкритий етап у початковому раунді. Повторне подання не підтримується.",
        ];
  };
  const directRole = selectedRoles.find((role) =>
    ["F", "R1", "R2"].includes(role),
  );
  const fields: OperationField[] = [
    {
      name: "contract",
      label: "Адреса розгорнутого контракту Vestry",
      type: "text",
      required: true,
      value: workspace.contract ?? "",
      help: "Точна H160-адреса незміненого контракту в поточній мережі.",
    },
    {
      name: "firstAmount",
      label: `Перший транш (${symbol})`,
      type: "number",
      required: true,
      value: "18",
    },
    {
      name: "secondAmount",
      label: `Другий транш (${symbol})`,
      type: "number",
      required: true,
      value: "12",
    },
    {
      name: "vestingBlocks",
      label: "Vesting першого траншу: блоків",
      type: "number",
      required: true,
      value: "1800",
    },
    {
      name: "deadlineDays",
      label: "Строк етапів: днів від підготовки",
      type: "number",
      required: true,
      value: "7",
      help: "Точні Unix-строки будуть зафіксовані в перегляді. Другий транш не має нового vesting.",
    },
  ];
  function action(
    id: EnabledOperationId,
    title: string,
    description: string,
    category: ActionView["category"],
    actor: string,
    ownBlockers: string[],
    inputs: OperationField[] = [],
  ): ActionView {
    const unavailableCapabilities = chain
      ? OPERATION_REQUIREMENTS[id].requiredGateIds
          .filter(
            (gate) =>
              profileGates.has(gate) &&
              !(chain.profile.gateRecords ?? []).some(
                (record) =>
                  record.id === gate &&
                  record.stage === "profile_capability" &&
                  record.status === "accepted" &&
                  record.evidence.length > 0,
              ),
          )
          .map((gate) => `Потрібне підтвердження можливості мережі: ${gate}.`)
      : [];
    const blockers = [...common, ...unavailableCapabilities, ...ownBlockers];
    return {
      id,
      title,
      description,
      category,
      actor,
      enabled: blockers.length === 0,
      blockers,
      fields: inputs,
    };
  }
  const hasBaseline = !!workspace.baseline;
  const proofState = proof(workspace, chain);
  const submittedOptions = [0, 1]
    .filter((index) => milestone(index)?.state === 1)
    .map((index) => ({ value: String(index), label: `Етап ${index + 1}` }));
  return [
    action(
      "GRC-SETUP-FUND-M0",
      "Поповнити резерв M0",
      "Окремо забезпечте контролеру резерв створення Pure. Це не бюджет комісій підписантів.",
      "funding",
      "Вибраний донор",
      [],
      [amountField(symbol)],
    ),
    action(
      "GRC-SETUP-FUND-ACTOR",
      "Поповнити бюджет учасника",
      "Одна визначена адреса та сума. Бюджети учасників не змішуються з коштами гранту.",
      "funding",
      "Вибраний донор",
      [],
      [
        roleField(workspace, "recipientRole", "Отримувач", [
          "A",
          "B",
          "D",
          "F",
          "R1",
          "R2",
        ]),
        amountField(symbol),
      ],
    ),
    action(
      "GRC-SETUP-CREATE-PURE",
      "Створити бенефіціара P",
      "Початкова група M0 створює окремий native Pure. Адреса визначається з фіналізованої квитанції.",
      "setup",
      "Група M0",
      [
        ...(!oldMember ? ["Потрібен підписант M0."] : []),
        ...(workspace.pure
          ? ["Бенефіціар P уже прив’язаний до простору."]
          : []),
      ],
      [
        {
          name: "pureIndex",
          label: "Індекс Pure",
          type: "number",
          required: true,
          value: "0",
          help: "Ціле число 0–65535. Новий індекс не використовується як повтор невідомої спроби.",
        },
      ],
    ),
    action(
      "GRC-SETUP-FUND-P",
      "Поповнити ліквідність P",
      "Окремий незаблокований бюджет бенефіціара для mapping, резервів та native-операцій.",
      "funding",
      "Вибраний донор",
      requirePure(),
      [amountField(symbol)],
    ),
    action(
      "GRC-SETUP-MAP-P",
      "Створити mapping P",
      "Постійне зіставлення native P з адресою h(P). Потрібна перевірка зворотного mapping.",
      "setup",
      "Група M0 через P",
      [
        ...requirePure(),
        ...requireOld(),
        ...(mapped(pureState) ? ["Mapping P уже підтверджено."] : []),
      ],
    ),
    action(
      "GRC-SETUP-MAP-ACTOR",
      "Створити mapping прямого учасника",
      "Фонд і рецензенти викликають контракт від власних native-акаунтів.",
      "setup",
      "Вибраний F / R1 / R2",
      [
        ...(!directRole ? ["Виберіть особистий акаунт F, R1 або R2."] : []),
        ...(mapped(actorState)
          ? ["Mapping вибраного акаунта вже підтверджено."]
          : []),
      ],
      [
        roleField(
          workspace,
          "actorRole",
          "Прямий учасник",
          ["F", "R1", "R2"],
          directRole,
        ),
      ],
    ),
    action(
      "GRC-GRANT-CREATE",
      "Створити та профінансувати грант",
      "Два етапи, два рецензенти. Фонд від початку задає h(P) бенефіціаром.",
      "grant",
      "Фонд F",
      [
        ...requirePure(),
        ...requireMapping(),
        ...(!selectedRoles.includes("F")
          ? ["Створювати грант може визначений фонд F."]
          : []),
        ...(!mapped(actorState) ? ["Потрібне mapping фонду F."] : []),
        ...(["R1", "R2"] as const).flatMap((role) =>
          mapped(stateFor(chain, workspace.participants[role]))
            ? []
            : [`Потрібне підтверджене mapping ${role}.`],
        ),
        ...(workspace.grantId !== null
          ? ["Грант уже прив’язаний до цього простору."]
          : []),
      ],
      fields,
    ),
    action(
      "GRC-GRANT-SUBMIT-M0",
      "Подати перший етап через M0",
      "Доказ буде публічним. Подання не є схваленням або виплатою.",
      "grant",
      "Група M0 через P",
      [
        ...requirePure(),
        ...requireMapping(),
        ...requireGrant(),
        ...requireOld(),
        ...requireOpen(0),
      ],
      [
        {
          name: "evidence",
          label: "Публічний доказ",
          type: "textarea",
          required: true,
          maxBytes: 1024,
          help: "Опис або посилання. Текст записується on-chain; не додавайте секрети.",
        },
      ],
    ),
    action(
      "GRC-GRANT-APPROVE",
      "Схвалити поданий етап",
      "Ваш голос може одразу спричинити виплату та створення vesting у цій самій транзакції.",
      "grant",
      "Прямий рецензент R1 / R2",
      [
        ...requireGrant(),
        ...(!selectedRoles.some((role) => role === "R1" || role === "R2")
          ? ["Виберіть особистий акаунт рецензента."]
          : []),
        ...(!mapped(actorState) ? ["Потрібне mapping рецензента."] : []),
        ...(!submittedOptions.length
          ? ["Немає етапу, що очікує схвалення."]
          : []),
      ],
      [
        {
          name: "index",
          label: "Етап на розгляді",
          type: "select",
          required: true,
          options: submittedOptions,
          value: submittedOptions[0]?.value ?? "0",
        },
      ],
    ),
    action(
      "GRC-ROTATION-ADD-M1",
      "Додати нову групу M1",
      "Після виконання M0 і M1 матимуть повну владу над P до окремого вилучення M0.",
      "handoff",
      "Група M0",
      [
        ...requirePure(),
        ...requireOld(),
        ...requireGrant(),
        ...requireMapping(),
        ...(current !== "M0"
          ? ["Потрібен точний початковий набір із M0."]
          : []),
        ...(!hasBaseline
          ? ["Потрібен перевірений початковий грант і активний vesting."]
          : []),
      ],
    ),
    action(
      "GRC-ROTATION-REMOVE-M0",
      "Вилучити початкову групу M0",
      "Вилучається тільки M0 / Any / 0. Очікується точний залишковий набір із M1.",
      "handoff",
      "Група M1",
      [
        ...requirePure(),
        ...requireNew(),
        ...(current !== "DualControl"
          ? ["Потрібен точний стан DualControl."]
          : []),
        ...(!hasBaseline
          ? ["Початковий стан для порівняння ще не зафіксований."]
          : []),
      ],
    ),
    action(
      "GRC-GRANT-SUBMIT-M1",
      "Подати наступний етап через M1",
      "Окреме подання наступного етапу тим самим бенефіціаром підтверджує продовження роботи.",
      "handoff",
      "Група M1 через P",
      [
        ...requirePure(),
        ...requireMapping(),
        ...requireGrant(),
        ...requireNew(),
        ...(current !== "M1"
          ? ["Спочатку підтвердьте точний залишковий набір із M1."]
          : []),
        ...requireOpen(1),
        ...(!hasBaseline
          ? ["Потрібен збережений початковий стан гранту."]
          : []),
      ],
      [
        {
          name: "evidence",
          label: "Публічний доказ",
          type: "textarea",
          required: true,
          maxBytes: 1024,
          help: "Це окреме подання M1 на тому самому гранті. Дані записуються on-chain.",
        },
      ],
    ),
    action(
      "GRC-VESTING-VEST-OTHER",
      "Оновити vesting-lock P",
      "Окрема післяперевірочна native-операція. Вона не є доказом передачі керування.",
      "maintenance",
      "Оператор S",
      [
        ...requirePure(),
        ...(!selectedRoles.includes("S")
          ? ["Виберіть визначеного оператора S."]
          : []),
        ...(!["continued", "drift"].includes(proofState.continuity)
          ? ["Спочатку заверште й перевірте продовження гранту."]
          : []),
      ],
    ),
    action(
      "GRC-MULTISIG-CANCEL",
      "Скасувати native-пропозицію",
      "Потрібен оригінальний depositor та точний timepoint. Скасування може програти гонку виконанню.",
      "recovery",
      "Початковий депозитор",
      [
        ...(!oldMember && !newMember
          ? ["Потрібен учасник відповідного контролера."]
          : []),
      ],
      [
        {
          name: "targetController",
          label: "Контролер пропозиції",
          type: "select",
          required: true,
          value: "M0",
          options: [
            { value: "M0", label: "M0 · початкова група" },
            { value: "M1", label: "M1 · нова група" },
          ],
        },
        {
          name: "callHash",
          label: "Точний native call hash",
          type: "text",
          required: true,
          placeholder: "0x…",
          help: "Час створення й depositor будуть прочитані з актуальної native-пропозиції.",
        },
      ],
    ),
  ];
}
