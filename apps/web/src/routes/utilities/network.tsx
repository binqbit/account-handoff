import { useEffect, useState, type FormEvent } from "react";
import {
  Address,
  Badge,
  Button,
  Card,
  KeyValues,
  Notice,
  PageHeader,
} from "../../components/ui";
import type { RuntimeMode } from "../../ui-contract";
import type { ScreenProps } from "../screen-types";
import { ReadinessCards } from "../../components/readiness";

export function Network(props: ScreenProps) {
  const { snapshot, run } = props;
  const network = snapshot.network;
  const [mode, setMode] = useState<RuntimeMode>(network.mode);
  const [endpoint, setEndpoint] = useState(network.endpoint);
  const [error, setError] = useState("");
  useEffect(() => {
    setMode(network.mode);
    setEndpoint(network.endpoint);
  }, [network.mode, network.endpoint]);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const url = new URL(endpoint);
      if (!["ws:", "wss:"].includes(url.protocol))
        throw new Error("Використайте адресу ws:// або wss://.");
      if (url.username || url.password)
        throw new Error("Адреса не може містити логін чи пароль.");
      await run({ type: "connect-network", mode, endpoint: endpoint.trim() });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Не вдалося підключити мережу.",
      );
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Мережа та готовність"
        title="Перевірте середовище перед діями"
        description="З’єднання з вузлом і готовність конкретної операції — різні перевірки. Кожне середовище має окремі дані та докази."
      />
      <div className="overview-grid">
        <Card title="Підключення до native-вузла">
          <form onSubmit={(event) => void submit(event)}>
            <div className="mode-picker" role="group" aria-label="Середовище">
              {(["LOCAL", "DEMO", "LIVE"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  className={mode === value ? "selected" : ""}
                  aria-pressed={mode === value}
                  onClick={() => {
                    setMode(value);
                    if (value === "LOCAL") setEndpoint("ws://127.0.0.1:9944");
                    else if (value !== network.mode) setEndpoint("");
                  }}
                >
                  <span>{value}</span>
                  <small>
                    {value === "LOCAL"
                      ? "Локальний native-стек"
                      : value === "DEMO"
                        ? "Реальна тестова мережа"
                        : "Mainnet"}
                  </small>
                </button>
              ))}
            </div>
            <div className="field">
              <label htmlFor="native-endpoint">Native WebSocket endpoint</label>
              <input
                id="native-endpoint"
                type="url"
                value={endpoint}
                onChange={(event) => setEndpoint(event.target.value)}
                placeholder={
                  mode === "LOCAL" ? "ws://127.0.0.1:9944" : "wss://…"
                }
                required
                autoComplete="url"
              />
              <p className="field__help">
                Адреса зберігається локально. Імпортований пакет не змінює
                endpoint.
              </p>
            </div>
            {mode === "LIVE" && (
              <Notice
                tone="warning"
                title="Mainnet потребує окремої кваліфікації"
              >
                Локальні та тестові результати не дозволяють виконання в LIVE.
                Готовність перевіряється для конкретного runtime і контракту.
              </Notice>
            )}
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <Button
              variant="primary"
              icon="network"
              type="submit"
              disabled={network.checking || !!snapshot.busy}
            >
              {network.checking
                ? "Перевіряємо з’єднання…"
                : "Підключити та перевірити"}
            </Button>
          </form>
        </Card>
        <Card
          title="Поточний профіль"
          action={
            <Badge tone={network.connected ? "positive" : "warning"}>
              {network.connected ? "Підключено" : "Не підключено"}
            </Badge>
          }
        >
          <KeyValues
            rows={[
              { label: "Середовище", value: network.mode },
              { label: "Мережа", value: network.name },
              { label: "Локальний запуск", value: network.runId ?? "—" },
              {
                label: "Фіналізований блок",
                value: network.blockNumber ?? "Не отримано",
              },
              {
                label: "Runtime",
                value: network.runtimeVersion ?? "Не встановлено",
              },
              {
                label: "Genesis",
                value: <Address value={network.genesis} compact />,
              },
              {
                label: "Блок",
                value: <Address value={network.blockHash} compact />,
              },
            ]}
          />
          {network.error && <Notice tone="negative">{network.error}</Notice>}
        </Card>
      </div>
      <Card title="Готовність можливостей">
        <ReadinessCards rows={network.readiness} />
        {!network.readiness.length && (
          <p className="muted">
            Підключіть вузол, щоб перевірити runtime, mapping, контракт і
            доступні операції.
          </p>
        )}
      </Card>
    </>
  );
}
