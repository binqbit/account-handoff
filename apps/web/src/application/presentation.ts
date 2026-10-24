import type { NativeAccountState } from "@account-handoff/native-adapter";
import {
  OPERATION_REQUIREMENTS,
  validateRecord,
} from "@account-handoff/contracts";
import type {
  Controller,
  EnabledOperationId,
  GateId,
} from "@account-handoff/contracts";
import type {
  ActionView,
  BalanceView,
  HistoryEntryView,
  IdentityView,
  MilestoneView,
  OperationField,
  ReadinessView,
  WorkspaceView,
} from "../ui-contract";
import type { ChainView, WorkspaceHistory, WorkspaceRecord } from "./models";

type ParticipantRole = keyof WorkspaceRecord["participants"];
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
const eq = (
  left: string | null | undefined,
  right: string | null | undefined,
): boolean => !!left && !!right && left.toLowerCase() === right.toLowerCase();
const roleNames: Record<ParticipantRole, string> = {
  A: "A · початковий підписант",
  B: "B · підписант",
  C: "C · учасник початкової групи",
  D: "D · новий підписант",
  F: "F · фонд",
  R1: "R1 · рецензент",
  R2: "R2 · рецензент",
  S: "S · оператор vesting",
};
function stateFor(
  chain: ChainView | null,
  address: string | null,
): NativeAccountState | undefined {
  if (!chain || !address) return undefined;
  return (
    chain.accounts[address] ??
    Object.values(chain.accounts).find((state) => eq(state.address, address))
  );
}
function mapped(state: NativeAccountState | undefined): boolean {
  return !!state && eq(state.mappedTo, state.address);
}
function ratioFor(chain: ChainView | null): bigint | null {
  const raw = chain?.localDescriptor?.runtime.nativeToEthRatio;
  if (!raw || !/^[1-9][0-9]*$/.test(raw)) return null;
  return BigInt(raw);
}
function decimal(value: bigint, decimals: number): string {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 38)
    return value.toString();
  const sign = value < 0n ? "-" : "";
  const absolute = value < 0n ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, "0")
    .replace(/0+$/, "");
  return `${sign}${absolute / scale}${fraction ? `.${fraction}` : ""}`;
}
function identity(workspace: WorkspaceRecord, address: string): IdentityView {
  const role = (
    Object.entries(workspace.participants) as [ParticipantRole, string][]
  ).find(([, account]) => eq(account, address))?.[0];
  return role ? { address, label: roleNames[role] } : { address };
}
function authority(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): WorkspaceView["authority"] {
  const state = stateFor(chain, workspace.pure);
  if (!state) return "Unknown";
  const known = state.proxies.every(
    (proxy) =>
      proxy.proxyType === "Any" &&
      proxy.delay === 0 &&
      (eq(proxy.delegate, workspace.M0.account) ||
        eq(proxy.delegate, workspace.M1.account)),
  );
  if (!known) return "Diverged";
  const old = state.proxies.filter((proxy) =>
    eq(proxy.delegate, workspace.M0.account),
  ).length;
  const next = state.proxies.filter((proxy) =>
    eq(proxy.delegate, workspace.M1.account),
  ).length;
  if (old === 1 && next === 0 && state.proxies.length === 1) return "M0";
  if (old === 0 && next === 1 && state.proxies.length === 1) return "M1";
  if (old === 1 && next === 1 && state.proxies.length === 2)
    return "DualControl";
  return "Diverged";
}
function after(left: WorkspaceHistory, right: WorkspaceHistory): boolean {
  return (
    left.receipt.blockNumber > right.receipt.blockNumber ||
    (left.receipt.blockNumber === right.receipt.blockNumber &&
      left.receipt.txIndex > right.receipt.txIndex)
  );
}
function sameController(left: Controller, right: Controller): boolean {
  return (
    eq(left.account, right.account) &&
    left.role === right.role &&
    left.threshold === right.threshold &&
    left.members.length === right.members.length &&
    left.members.every((member, index) => eq(member, right.members[index]))
  );
}
/** The application supplies a certificate only after reconstructing its native evidence. */
function hasBoundCertificate(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): boolean {
  const certificate = workspace.continuityCertificate;
  const baseline = workspace.baseline;
  if (!chain || !certificate || !baseline || !validateRecord(certificate).ok)
    return false;
  return (
    ["verified", "historically_verified_current_drift"].includes(
      certificate.verdict,
    ) &&
    Object.values(certificate.criteria).every(
      (criterion) => criterion === "passed",
    ) &&
    certificate.removalReceiptId !== null &&
    certificate.milestone1SubmissionReceiptId !== null &&
    certificate.removalReceiptId !==
      certificate.milestone1SubmissionReceiptId &&
    certificate.removalParticipationEvidence.length > 0 &&
    certificate.continuationParticipationEvidence.length > 0 &&
    certificate.grantScopeAtSubmission === "EligibleSingleRound" &&
    certificate.profileId === chain.profile.profileId &&
    certificate.profileDigest === chain.profile.digest &&
    sameController(certificate.M0, workspace.M0) &&
    sameController(certificate.M1, workspace.M1) &&
    eq(certificate.identity.P, workspace.pure) &&
    eq(certificate.identity.reverseMappingAccount, workspace.pure) &&
    eq(certificate.identity.originalAccountEntry, workspace.pure) &&
    eq(certificate.identity.hP, baseline.account.mappedAddress) &&
    eq(certificate.identity.grantee, baseline.grant.grantee) &&
    eq(certificate.identity.contractAddress, workspace.contract) &&
    certificate.identity.grantId === workspace.grantId &&
    eq(certificate.before.blockHash, baseline.blockHash) &&
    BigInt(certificate.after.blockNumber) <=
      BigInt(chain.fingerprint.anchor.number) &&
    [certificate.before, certificate.after].every((anchor) =>
      Object.values(anchor.contextBindings).every(
        (context) =>
          eq(context.genesis, workspace.genesis) &&
          eq(context.genesis, chain.fingerprint.genesis) &&
          context.metadataSha256 === chain.profile.metadataSha256 &&
          eq(context.runtimeCodeHash, chain.profile.runtimeCodeHash),
      ),
    )
  );
}
function proof(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): { continuity: WorkspaceView["continuity"]; detail: string } {
  const removals = workspace.history.filter(
    (row) =>
      row.operationId === "GRC-ROTATION-REMOVE-M0" &&
      row.receipt.businessExecuted &&
      row.receipt.outerSuccess &&
      row.receipt.nestedSuccess &&
      eq(row.grantId, workspace.grantId),
  );
  const submissions = workspace.history.filter(
    (row) =>
      row.operationId === "GRC-GRANT-SUBMIT-M1" &&
      row.receipt.businessExecuted &&
      row.receipt.outerSuccess &&
      row.receipt.nestedSuccess &&
      eq(row.grantId, workspace.grantId),
  );
  const baseline = workspace.baseline;
  const identityPreserved =
    !!baseline &&
    eq(baseline.account.address, workspace.pure) &&
    !!workspace.grantId;
  const continued =
    identityPreserved &&
    hasBoundCertificate(workspace, chain) &&
    submissions.some((submission) =>
      removals.some(
        (removal) =>
          submission.attemptId !== removal.attemptId &&
          submission.receipt.txHash !== removal.receipt.txHash &&
          after(submission, removal),
      ),
    );
  if (continued) {
    const state = authority(workspace, chain);
    const grantMatches =
      !!chain?.grant &&
      eq(chain.grant.grantee, baseline.grant.grantee) &&
      eq(chain.grant.funder, baseline.grant.funder) &&
      chain.grant.milestones.every((milestone) => milestone.round === 0);
    if (
      state !== "M1" ||
      !mapped(stateFor(chain, workspace.pure)) ||
      !grantMatches ||
      workspace.continuityCertificate?.verdict ===
        "historically_verified_current_drift"
    )
      return {
        continuity: "drift",
        detail:
          "Збережено окремі фіналізовані квитанції вилучення M0 і подання M1 після нього для того самого гранту. Поточний стан відрізняється або потребує повторної перевірки; історичні квитанції залишаються доступними.",
      };
    return {
      continuity: "continued",
      detail:
        "Збережено початковий стан, окрему квитанцію вилучення M0 та пізніше подання M1 на тому самому гранті. Поточний бенефіціар і контролер узгоджені. Це не означає схвалення чи виплату наступного траншу.",
    };
  }
  if (removals.length && identityPreserved)
    return {
      continuity: "rotated",
      detail:
        "Вилучення M0 має окрему фіналізовану квитанцію. Для завершення потрібно подати наступний етап через M1 та перевірити його результат.",
    };
  if (!chain && workspace.history.length)
    return {
      continuity: "unknown",
      detail:
        "Локальна історія доступна. Поточна мережа та повнота доказів ще не перевірені.",
    };
  return {
    continuity: "not-started",
    detail:
      "Початковий стан, вилучення M0 і наступне подання M1 ще не утворюють повного ланцюжка доказів.",
  };
}
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
    workspace.pure ? [] : ["Спочатку створіть і підтвердьте бенефіціара P."];
  const requireMapping = (): string[] =>
    mapped(pureState)
      ? []
      : ["Потрібне підтверджене постійне mapping P → h(P) → P."];
  const requireGrant = (): string[] =>
    workspace.grantId !== null && workspace.contract && chain?.grant
      ? []
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

function deadline(value: bigint): string {
  if (value <= 0n || value > 253402300799n) return `${value} Unix seconds`;
  return new Date(Number(value) * 1000)
    .toISOString()
    .replace("T", " ")
    .replace(".000Z", " UTC");
}
function historyEntry(row: WorkspaceHistory): HistoryEntryView {
  const receipt = row.receipt;
  const success = receipt.outerSuccess && receipt.nestedSuccess;
  return {
    id: row.id,
    title: row.title,
    timestamp: row.at,
    block: String(receipt.blockNumber),
    txHash: receipt.txHash,
    state: !success
      ? "Помилка виконання"
      : receipt.businessExecuted
        ? "Виконано"
        : "Схвалення зафіксовано",
    tone: !success
      ? "negative"
      : receipt.businessExecuted
        ? "positive"
        : "neutral",
    detail:
      receipt.failure ??
      (receipt.businessExecuted
        ? "Бізнес-дію виконано у фіналізованому блоці. Її окремі післяумови доступні в доказах."
        : "Зовнішню транзакцію фіналізовано. Це ще не виконання бізнес-дії."),
    layers: [
      {
        label: "Зовнішня транзакція",
        value: receipt.outerSuccess ? "Успішна" : "Помилка",
        tone: receipt.outerSuccess ? "positive" : "negative",
      },
      {
        label: "Вкладене виконання",
        value: receipt.nestedSuccess ? "Успішне" : "Помилка",
        tone: receipt.nestedSuccess ? "positive" : "negative",
      },
      {
        label: "Бізнес-дія",
        value: receipt.businessExecuted ? "Виконана" : "Не виконана",
        tone: receipt.businessExecuted ? "positive" : "neutral",
      },
    ],
    evidence: {
      operationId: row.operationId,
      signer: row.signer,
      grantId: row.grantId,
      envelopeDigest: row.envelopeDigest,
      blockHash: receipt.blockHash,
      transactionIndex: receipt.txIndex,
      events: receipt.events,
    },
    operationId: row.attemptId,
    unresolved: false,
  };
}
export function workspaceView(
  workspace: WorkspaceRecord,
  chain: ChainView | null,
): WorkspaceView {
  const decimals = chain?.fingerprint.tokenDecimals ?? 0;
  const symbol = chain?.fingerprint.tokenSymbol ?? "native";
  const current = authority(workspace, chain);
  const pureState = stateFor(chain, workspace.pure);
  const grant = chain?.grant;
  const continuity = proof(workspace, chain);
  const balances: BalanceView[] = [];
  const entries: { address: string; role: string; mappingRequired: boolean }[] =
    [
      {
        address: workspace.M0.account,
        role: "Резерв створення Pure",
        mappingRequired: false,
      },
      ...(workspace.pure
        ? [
            {
              address: workspace.pure,
              role: "Ліквідність бенефіціара P",
              mappingRequired: true,
            },
          ]
        : []),
      ...(
        Object.entries(workspace.participants) as [ParticipantRole, string][]
      ).map(([role, address]) => ({
        address,
        role: roleNames[role],
        mappingRequired: ["F", "R1", "R2"].includes(role),
      })),
    ];
  for (const entry of entries) {
    const state = stateFor(chain, entry.address);
    const available = state
      ? state.free > state.frozen
        ? state.free - state.frozen
        : 0n
      : null;
    balances.push({
      identity: identity(workspace, entry.address),
      role: entry.role,
      free: state ? decimal(state.free, decimals) : null,
      reserved: state ? decimal(state.reserved, decimals) : null,
      frozen: state ? decimal(state.frozen, decimals) : null,
      available: available === null ? null : decimal(available, decimals),
      symbol,
      mapping: !entry.mappingRequired
        ? "not-required"
        : !state
          ? "unknown"
          : mapped(state)
            ? "verified"
            : "missing",
    });
  }
  const milestones: MilestoneView[] = (grant?.milestones ?? []).map(
    (milestone, index) => {
      const states: MilestoneView["state"][] = [
        "Open",
        "Submitted",
        "Released",
        "Reclaimed",
      ];
      const actions: string[] = [];
      if (milestone.state === 0 && milestone.round === 0)
        actions.push(
          index === 0 ? "GRC-GRANT-SUBMIT-M0" : "GRC-GRANT-SUBMIT-M1",
        );
      if (milestone.state === 1) actions.push("GRC-GRANT-APPROVE");
      const ratio = ratioFor(chain);
      const nativeAmount =
        ratio !== null && milestone.amount % ratio === 0n
          ? milestone.amount / ratio
          : null;
      return {
        id: `${workspace.grantId}:${index}`,
        index,
        title: index === 0 ? "Початковий результат" : "Продовження роботи",
        amount:
          nativeAmount === null
            ? `${milestone.amount} ABI units`
            : decimal(nativeAmount, decimals),
        symbol: nativeAmount === null ? "" : symbol,
        state: states[milestone.state] ?? "Unknown",
        round: String(milestone.round),
        deadline: deadline(milestone.deadline),
        vesting:
          milestone.vestingBlocks > 0
            ? `${milestone.vestingBlocks} counted blocks`
            : "Без нового vesting",
        approvals: null,
        approvalCount: milestone.approvals,
        requiredApprovals: grant?.threshold ?? 2,
        actions,
      };
    },
  );
  const setupProgress: ReadinessView[] = [
    {
      id: "team",
      label: "Команда й контролери",
      status: "ready",
      detail: "Склад M0/M1 збережено. Поточні повноваження читаються окремо.",
    },
    {
      id: "pure",
      label: "Бенефіціар P",
      status:
        workspace.pure && workspace.creationEvidence.length
          ? "ready"
          : "blocked",
      detail: workspace.pure
        ? workspace.creationEvidence.length
          ? "Збережена адреса та квитанція створення Pure."
          : "Адреса відома, потрібна перевірка походження."
        : "Потрібно створити P через M0.",
    },
    {
      id: "mapping",
      label: "Постійне mapping P",
      status: mapped(pureState) ? "ready" : !pureState ? "unknown" : "blocked",
      detail: mapped(pureState)
        ? "Зворотне зіставлення підтверджує той самий P."
        : "Потрібне актуальне читання P → h(P) → P.",
    },
    {
      id: "grant",
      label: "Грант для h(P)",
      status:
        grant &&
        mapped(pureState) &&
        eq(grant.grantee, pureState?.mappedAddress)
          ? "ready"
          : "blocked",
      detail: grant
        ? "Стан контракту прочитано; перевіряється точний бенефіціар."
        : "Фонд створює грант після підготовки бенефіціара.",
    },
    {
      id: "baseline",
      label: "Початковий стан і vesting",
      status: workspace.baseline ? "ready" : "blocked",
      detail: workspace.baseline
        ? "Початковий стан збережено з прив’язкою до блока."
        : "Потрібна виплата першого траншу з активним native vesting.",
    },
  ];
  let currentTask: WorkspaceView["currentTask"];
  if (!chain || !eq(chain.fingerprint.genesis, workspace.genesis))
    currentTask = {
      title: "Перевірте мережу простору",
      detail:
        "Оберіть відповідний native endpoint і отримайте фіналізовані дані.",
      destination: "network",
    };
  else if (!workspace.pure)
    currentTask = {
      title: "Створіть сталого бенефіціара",
      detail:
        "Спочатку забезпечте M0 резервом створення, потім створіть P через початкову групу.",
      actionId: "GRC-SETUP-CREATE-PURE",
    };
  else if (!mapped(pureState))
    currentTask = {
      title: "Підготуйте mapping бенефіціара",
      detail:
        "Забезпечте P ліквідністю та підтвердьте його постійне зіставлення з h(P).",
      actionId: "GRC-SETUP-MAP-P",
    };
  else if (!grant || workspace.grantId === null)
    currentTask = {
      title: "Створіть грант для h(P)",
      detail: "Фонд фінансує два етапи для підготовленого бенефіціара.",
      actionId: "GRC-GRANT-CREATE",
    };
  else if (current === "Diverged")
    currentTask = {
      title: "Перевірте неочікувані повноваження",
      detail:
        "Фактичний список делегатів не відповідає дозволеному набору M0/M1.",
      destination: "team",
    };
  else if (
    milestones.some((item) => item.state === "Submitted") &&
    !workspace.baseline
  )
    currentTask = {
      title: "Перший етап очікує рецензентів",
      detail:
        "R1 та R2 окремо перевіряють доказ і схвалюють виплату першого траншу.",
      actionId: "GRC-GRANT-APPROVE",
    };
  else if (!workspace.baseline)
    currentTask = {
      title: "Підготуйте початковий стан гранту",
      detail:
        "Перший етап має створити активний vesting перед передачею керування.",
      actionId: "GRC-GRANT-SUBMIT-M0",
    };
  else if (current === "DualControl")
    currentTask = {
      title: "Вилучіть початкову групу M0",
      detail:
        "Зараз обидві групи мають повноваження. Наступний крок виконує M1.",
      actionId: "GRC-ROTATION-REMOVE-M0",
    };
  else if (current === "M1" && continuity.continuity !== "continued")
    currentTask = {
      title: "Продовжіть грант новою групою",
      detail:
        "Подайте наступний етап через M1. Це окрема дія після вилучення M0.",
      actionId: "GRC-GRANT-SUBMIT-M1",
    };
  else if (
    continuity.continuity === "continued" ||
    continuity.continuity === "drift"
  )
    currentTask = {
      title: "Перегляньте збережений доказ",
      detail: continuity.detail,
      destination: "history",
    };
  else
    currentTask = {
      title: "Підготуйте нову групу керування",
      detail:
        "Додайте M1 через початкову групу. Потім окремо вилучіть M0 та продовжіть грант.",
      actionId: "GRC-ROTATION-ADD-M1",
    };
  const totals = grant?.milestones.reduce((sum, item) => sum + item.amount, 0n);
  const ratio = ratioFor(chain);
  return {
    id: workspace.id,
    name: workspace.name,
    createdAt: workspace.createdAt,
    beneficiary: workspace.pure
      ? {
          address: workspace.pure,
          label: "Сталий бенефіціар P",
          mappedAddress: mapped(pureState) ? pureState!.mappedAddress : null,
        }
      : null,
    oldController: {
      address: workspace.M0.account,
      label: "M0",
      threshold: Number(workspace.M0.threshold),
      members: workspace.M0.members.map((address) =>
        identity(workspace, address),
      ),
      active:
        current === "Unknown"
          ? null
          : current === "M0" || current === "DualControl",
    },
    newController: {
      address: workspace.M1.account,
      label: "M1",
      threshold: Number(workspace.M1.threshold),
      members: workspace.M1.members.map((address) =>
        identity(workspace, address),
      ),
      active:
        current === "Unknown"
          ? null
          : current === "M1" || current === "DualControl",
    },
    contract: workspace.contract,
    grantId: workspace.grantId,
    authority: current,
    continuity: continuity.continuity,
    continuityDetail: continuity.detail,
    symbol,
    grantTotal:
      totals === undefined || ratio === null || totals % ratio !== 0n
        ? null
        : decimal(totals / ratio, decimals),
    milestones,
    balances,
    history: [...workspace.history]
      .sort(
        (left, right) =>
          right.receipt.blockNumber - left.receipt.blockNumber ||
          right.receipt.txIndex - left.receipt.txIndex,
      )
      .map(historyEntry),
    funder: identity(workspace, workspace.participants.F),
    reviewers: [
      identity(workspace, workspace.participants.R1),
      identity(workspace, workspace.participants.R2),
    ],
    setupProgress,
    currentTask,
  };
}
