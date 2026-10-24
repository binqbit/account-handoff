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
        throw new Error("Use a ws:// or wss:// address.");
      if (url.username || url.password)
        throw new Error("The address must not contain a username or password.");
      await run({ type: "connect-network", mode, endpoint: endpoint.trim() });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Could not connect to the network.",
      );
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Network and readiness"
        title="Check the environment before acting"
        description="A node connection and readiness for an operation are separate checks. Each environment has its own data and evidence."
      />
      <div className="overview-grid">
        <Card title="Native node connection">
          <form onSubmit={(event) => void submit(event)}>
            <div className="mode-picker" role="group" aria-label="Environment">
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
                      ? "Local native stack"
                      : value === "DEMO"
                        ? "Real test network"
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
                The address is stored locally. An imported package does not
                change the endpoint.
              </p>
            </div>
            {mode === "LIVE" && (
              <Notice
                tone="warning"
                title="Mainnet requires separate qualification"
              >
                Local and test results do not authorize LIVE execution.
                Readiness is verified for the specific runtime and contract.
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
                ? "Checking the connection…"
                : "Connect and verify"}
            </Button>
          </form>
        </Card>
        <Card
          title="Current profile"
          action={
            <Badge tone={network.connected ? "positive" : "warning"}>
              {network.connected ? "Connected" : "Disconnected"}
            </Badge>
          }
        >
          <KeyValues
            rows={[
              { label: "Environment", value: network.mode },
              { label: "Network", value: network.name },
              { label: "Local run", value: network.runId ?? "—" },
              {
                label: "Finalized block",
                value: network.blockNumber ?? "Not received",
              },
              {
                label: "Runtime",
                value: network.runtimeVersion ?? "Not set",
              },
              {
                label: "Genesis",
                value: <Address value={network.genesis} compact />,
              },
              {
                label: "Block",
                value: <Address value={network.blockHash} compact />,
              },
            ]}
          />
          {network.error && <Notice tone="negative">{network.error}</Notice>}
        </Card>
      </div>
      <Card title="Capability readiness">
        <ReadinessCards rows={network.readiness} />
        {!network.readiness.length && (
          <p className="muted">
            Connect a node to verify the runtime, mapping, contract and
            available operations.
          </p>
        )}
      </Card>
    </>
  );
}
