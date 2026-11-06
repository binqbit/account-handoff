import { deployment } from "../config/deployment";
import type { ApplicationFacade } from "../ui-contract";

const retryDelays = [2_000, 5_000, 10_000, 30_000] as const;

/** Maintain the testnet's read-only connection; wallet access remains explicit. */
export function connectTestnetAtStartup(
  application: ApplicationFacade,
): () => void {
  if (!deployment.isTestnet) return () => {};
  let stopped = false;
  let initial = true;
  let inFlight = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const online = () => globalThis.navigator?.onLine !== false;
  const clearRetry = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const available = () => {
    const { network, busy } = application.getSnapshot();
    return (
      !stopped &&
      online() &&
      !inFlight &&
      !busy &&
      !network.checking &&
      !network.reconnecting &&
      !network.connected &&
      (initial || network.retryable === true)
    );
  };
  const attempt = () => {
    if (!available()) return;
    clearRetry();
    if (!initial) failures += 1;
    initial = false;
    inFlight = true;
    // Application.create restores the last successful, validated endpoint.
    const { endpoint } = application.getSnapshot().network;
    void application
      .dispatch({ type: "connect-network", mode: "DEMO", endpoint })
      .catch(() => {
        // Application retains the specific error and classifies its retryability.
      })
      .finally(() => {
        inFlight = false;
        observe();
      });
  };
  const observe = () => {
    if (stopped) return;
    const { network } = application.getSnapshot();
    if (network.connected && !network.checking) {
      initial = false;
      failures = 0;
      clearRetry();
      return;
    }
    if (!available()) {
      clearRetry();
      return;
    }
    if (initial) {
      attempt();
    } else if (timer === undefined) {
      const delay = retryDelays[Math.min(failures, retryDelays.length - 1)]!;
      timer = setTimeout(() => {
        timer = undefined;
        attempt();
      }, delay);
    }
  };
  const resume = () => {
    if (available()) attempt();
    else observe();
  };
  const unsubscribe = application.subscribe(observe);
  globalThis.window?.addEventListener("online", resume);
  globalThis.window?.addEventListener("offline", observe);
  observe();
  return () => {
    stopped = true;
    clearRetry();
    unsubscribe();
    globalThis.window?.removeEventListener("online", resume);
    globalThis.window?.removeEventListener("offline", observe);
  };
}
