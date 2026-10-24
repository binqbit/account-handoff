import {
  Component,
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from "react";
import type {
  AppCommand,
  ApplicationFacade,
  CommandResult,
  Destination,
} from "./ui-contract";
import { Badge, Button, Icon, Notice } from "./components/ui";
import { useRoute } from "./state/router";
import {
  Handoff,
  History,
  Milestones,
  Overview,
  Team,
} from "./routes/workspace";
import {
  Attention,
  Data,
  Network,
  Review,
  Setup,
  Workspaces,
} from "./routes/utilities";
import type { ScreenProps } from "./routes/screen-types";
import "./styles/app.css";

const navigation: { id: Destination; label: string; icon: string }[] = [
  { id: "overview", label: "Огляд", icon: "overview" },
  { id: "milestones", label: "Грант і етапи", icon: "milestones" },
  { id: "team", label: "Команда", icon: "team" },
  { id: "history", label: "Історія", icon: "history" },
];
const titles: Record<Destination, string> = {
  overview: "Огляд",
  milestones: "Грант і етапи",
  team: "Команда",
  history: "Історія",
  workspaces: "Робочі простори",
  setup: "Налаштування",
  handoff: "Передача керування",
  review: "Перегляд операції",
  network: "Мережа та готовність",
  data: "Дані простору",
  attention: "Потребує уваги",
};
function saveDownload(download: NonNullable<CommandResult["download"]>) {
  const url = URL.createObjectURL(
    new Blob([download.contents], { type: download.mime }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = download.name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
class InterfaceBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(_error: Error, _info: ErrorInfo) {
    /* Do not log application records or signing context. */
  }
  render() {
    return this.state.failed ? (
      <div className="critical-error">
        <Icon name="alert" size={32} />
        <h1>Інтерфейс не вдалося відкрити</h1>
        <p>
          Записи залишаються у сховищі. Перезавантаження відновить перегляд без
          автоматичного підпису чи надсилання.
        </p>
        <Button onClick={() => window.location.reload()}>Відкрити знову</Button>
      </div>
    ) : (
      this.props.children
    );
  }
}
export function App({ application }: { application: ApplicationFacade }) {
  return (
    <InterfaceBoundary>
      <Application application={application} />
    </InterfaceBoundary>
  );
}
function Application({ application }: { application: ApplicationFacade }) {
  const subscribe = useCallback(
    (listener: () => void) => application.subscribe(listener),
    [application],
  );
  const getSnapshot = useCallback(
    () => application.getSnapshot(),
    [application],
  );
  const sourceSnapshot = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const { destination, actionId, navigate } = useRoute();
  const [localBusy, setLocalBusy] = useState<string | null>(null);
  const pending = useRef(false);
  const [localNotice, setLocalNotice] = useState<{
    message: string;
    error: boolean;
  } | null>(null);
  const snapshot =
    localBusy && !sourceSnapshot.busy
      ? { ...sourceSnapshot, busy: localBusy }
      : sourceSnapshot;
  const run = useCallback(
    async (command: AppCommand): Promise<CommandResult | void> => {
      if (pending.current) return;
      pending.current = true;
      setLocalBusy(command.type);
      setLocalNotice(null);
      try {
        const result = await application.dispatch(command);
        if (result?.download) saveDownload(result.download);
        if (result?.message)
          setLocalNotice({ message: result.message, error: false });
        return result;
      } catch (error) {
        setLocalNotice({
          message:
            error instanceof Error
              ? error.message
              : "Не вдалося завершити дію. Перевірте поточний стан і спробу.",
          error: true,
        });
        return;
      } finally {
        pending.current = false;
        setLocalBusy(null);
      }
    },
    [application],
  );
  const openAction = useCallback(
    (id: string) => navigate("review", id),
    [navigate],
  );
  useEffect(() => {
    document.title = `${titles[destination]} · Account Handoff`;
  }, [destination]);
  const screenProps: ScreenProps = { snapshot, navigate, run, openAction };
  const unresolved =
    snapshot.workspace?.history.filter((entry) => entry.unresolved).length ?? 0;
  const activeDestination =
    destination === "handoff"
      ? "team"
      : destination === "review"
        ? ""
        : destination;
  const notice =
    localNotice ??
    (snapshot.notice
      ? {
          message: snapshot.notice.message,
          error: snapshot.notice.tone === "negative",
        }
      : null);
  function renderScreen() {
    switch (destination) {
      case "overview":
        return <Overview {...screenProps} />;
      case "milestones":
        return <Milestones {...screenProps} />;
      case "team":
        return <Team {...screenProps} />;
      case "history":
        return <History {...screenProps} />;
      case "handoff":
        return <Handoff {...screenProps} />;
      case "workspaces":
        return <Workspaces {...screenProps} />;
      case "setup":
        return <Setup {...screenProps} />;
      case "network":
        return <Network {...screenProps} />;
      case "data":
        return <Data {...screenProps} />;
      case "attention":
        return <Attention {...screenProps} />;
      case "review":
        return <Review {...screenProps} actionId={actionId} />;
    }
  }
  return (
    <>
      <a className="skip-link" href="#main-content">
        До основного вмісту
      </a>
      <div className="app-shell">
        <aside className="sidebar">
          <button
            type="button"
            className="brand"
            onClick={() => navigate("overview")}
            aria-label="Account Handoff — огляд"
          >
            <span className="brand-symbol">⇄</span>
            <span>
              Account<span className="brand-light">Handoff</span>
            </span>
          </button>
          <button
            type="button"
            className="workspace-switcher"
            onClick={() => navigate("workspaces")}
          >
            <span className="workspace-avatar">
              {snapshot.workspace?.name.slice(0, 1) ?? "A"}
            </span>
            <span>
              <strong>{snapshot.workspace?.name ?? "Робочі простори"}</strong>
              <small>
                {snapshot.workspace
                  ? "Простір команди"
                  : "Відкрити або створити"}
              </small>
            </span>
            <Icon name="chevron" size={15} />
          </button>
          <div className="navigation-label">Робочий простір</div>
          <nav className="primary-nav" aria-label="Робочий простір">
            {navigation.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-current={
                  activeDestination === item.id ? "page" : undefined
                }
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} size={19} />
                <span>{item.label}</span>
                {activeDestination === item.id && (
                  <span className="nav-active-mark" />
                )}
              </button>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <button
              type="button"
              className="network-status"
              onClick={() => navigate("network")}
            >
              <span
                className={`connection-dot ${snapshot.network.connected ? "connected" : ""}`}
              />
              <span>
                <strong>{snapshot.network.mode}</strong>
                <small>
                  {snapshot.network.connected
                    ? snapshot.network.name
                    : "Мережа не підключена"}
                </small>
              </span>
              <Icon name="chevron" size={14} />
            </button>
            <nav aria-label="Налаштування простору" className="secondary-nav">
              <button
                type="button"
                aria-current={destination === "network" ? "page" : undefined}
                onClick={() => navigate("network")}
              >
                <Icon name="network" size={17} />
                Мережа та готовність
              </button>
              <button
                type="button"
                aria-current={destination === "data" ? "page" : undefined}
                onClick={() => navigate("data")}
              >
                <Icon name="settings" size={17} />
                Дані простору
              </button>
            </nav>
            <p className="key-assurance">
              <Icon name="shield" size={15} />
              Ключі залишаються
              <br />у вашому гаманці.
            </p>
          </div>
        </aside>
        <div className="main-shell">
          <header className="topbar">
            <div className="breadcrumb">
              <span>{snapshot.workspace?.name ?? "Account Handoff"}</span>
              <Icon name="chevron" size={13} />
              <strong>{titles[destination]}</strong>
            </div>
            <div className="topbar-actions">
              <button
                type="button"
                className="attention-button"
                onClick={() => navigate("attention")}
                aria-label={`Потребує уваги${unresolved ? `: ${unresolved}` : ""}`}
              >
                <Icon name="history" size={17} />
                <span>Потребує уваги</span>
                {unresolved > 0 && <span className="count">{unresolved}</span>}
              </button>
              <span className="topbar-divider" />
              {snapshot.wallet.connected ? (
                <div className="wallet-control">
                  <span className="wallet-avatar">
                    <Icon name="wallet" size={17} />
                  </span>
                  <label className="sr-only" htmlFor="selected-wallet-account">
                    Особистий акаунт
                  </label>
                  <select
                    id="selected-wallet-account"
                    value={snapshot.wallet.selectedAddress ?? ""}
                    onChange={(event) =>
                      void run({
                        type: "select-account",
                        address: event.target.value,
                      })
                    }
                    disabled={!!snapshot.busy}
                  >
                    {!snapshot.wallet.selectedAddress && (
                      <option value="">Оберіть акаунт</option>
                    )}
                    {snapshot.wallet.accounts.map((account) => (
                      <option
                        key={`${account.source}-${account.address}`}
                        value={account.address}
                      >
                        {account.label ??
                          account.name ??
                          `${account.address.slice(0, 7)}…${account.address.slice(-5)}`}
                        {account.role ? ` · ${account.role}` : ""}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="disconnect-button"
                    disabled={!!snapshot.busy}
                    onClick={() => void run({ type: "disconnect-wallet" })}
                    aria-label="Від’єднати гаманець"
                  >
                    <Icon name="close" size={15} />
                  </button>
                </div>
              ) : (
                <Button
                  icon="wallet"
                  variant="primary"
                  disabled={snapshot.wallet.connecting || !!snapshot.busy}
                  onClick={() => void run({ type: "connect-wallet" })}
                >
                  {snapshot.wallet.connecting
                    ? "Підключення…"
                    : "Підключити гаманець"}
                </Button>
              )}
            </div>
          </header>
          {notice && (
            <div
              className={`notification ${notice.error ? "notification--error" : ""}`}
              role={notice.error ? "alert" : "status"}
            >
              <span>{notice.message}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Закрити повідомлення"
                onClick={() => {
                  setLocalNotice(null);
                  if (snapshot.notice)
                    void run({
                      type: "dismiss-notice",
                      id: snapshot.notice.id,
                    });
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </div>
          )}
          <main className="main-content" id="main-content" tabIndex={-1}>
            {snapshot.storageError && (
              <Notice tone="negative" title="Сховище недоступне">
                {snapshot.storageError} Підпис і надсилання потребують надійного
                локального запису.
              </Notice>
            )}
            {snapshot.wallet.error && (
              <Notice tone="warning" title="Підключення гаманця">
                {snapshot.wallet.error}
              </Notice>
            )}
            {renderScreen()}
            <footer className="page-footer">
              <div>
                <span className="footer-symbol">⇄</span>
                <span>Account Handoff</span>
                <Badge
                  tone={
                    snapshot.network.mode === "LIVE" ? "warning" : "neutral"
                  }
                >
                  {snapshot.network.mode}
                </Badge>
              </div>
              <span>Сталий бенефіціар. Перевірені повноваження.</span>
            </footer>
          </main>
        </div>
      </div>
      {snapshot.busy && (
        <div className="activity-indicator" role="status" aria-live="polite">
          <span className="spinner" />
          Виконуємо запит…
        </div>
      )}
    </>
  );
}
