import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type {
  AppCommand,
  ApplicationFacade,
  CommandResult,
} from "./ui-contract";
import { Icon, Notice } from "./components/ui";
import { InterfaceBoundary } from "./components/shell/interface-boundary";
import { Sidebar } from "./components/shell/sidebar";
import { Topbar } from "./components/shell/topbar";
import { Footer } from "./components/shell/footer";
import { titles } from "./state/navigation";
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
              : "Could not complete the action. Check the current state and attempt.",
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
        Skip to main content
      </a>
      <div className="app-shell">
        <Sidebar
          snapshot={snapshot}
          navigate={navigate}
          destination={destination}
        />
        <div className="main-shell">
          <Topbar
            snapshot={snapshot}
            navigate={navigate}
            run={run}
            destination={destination}
          />
          {notice && (
            <div
              className={`notification ${notice.error ? "notification--error" : ""}`}
              role={notice.error ? "alert" : "status"}
            >
              <span>{notice.message}</span>
              <button
                type="button"
                className="icon-button"
                aria-label="Dismiss notification"
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
              <Notice tone="negative" title="Storage unavailable">
                {snapshot.storageError} Signing and sending require reliable
                local storage.
              </Notice>
            )}
            {snapshot.wallet.error && (
              <Notice tone="warning" title="Wallet connection">
                {snapshot.wallet.error}
              </Notice>
            )}
            {renderScreen()}
            <Footer mode={snapshot.network.mode} />
          </main>
        </div>
      </div>
      {snapshot.busy && (
        <div className="activity-indicator" role="status" aria-live="polite">
          <span className="spinner" />
          Processing request…
        </div>
      )}
    </>
  );
}
