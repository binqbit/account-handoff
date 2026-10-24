import type { Destination } from "../../ui-contract";
import type { ScreenProps } from "../../routes/screen-types";
import { Button, Icon } from "../ui";
import { WalletAccountPicker } from "./wallet-account-picker";

export function Topbar({
  snapshot,
  navigate,
  run,
  destination,
}: Pick<ScreenProps, "snapshot" | "navigate" | "run"> & {
  destination: Destination;
}) {
  const unresolved =
    snapshot.workspace?.history.filter((entry) => entry.unresolved).length ?? 0;
  return (
    <div className="topbar">
      <div className="topbar-actions">
        <button
          type="button"
          className="header-network"
          aria-label="Network and readiness"
          aria-current={destination === "network" ? "page" : undefined}
          onClick={() => navigate("network")}
        >
          <span
            className={`connection-dot ${snapshot.network.connected ? "connected" : ""}`}
          />
          <span className="header-network__mode">{snapshot.network.mode}</span>
          <span className="header-network__state">
            {snapshot.network.connected ? "RPC online" : "Network disconnected"}
          </span>
        </button>
        <button
          type="button"
          className="header-icon"
          aria-label="Workspace data"
          aria-current={destination === "data" ? "page" : undefined}
          onClick={() => navigate("data")}
        >
          <Icon name="settings" size={18} />
        </button>
        <button
          type="button"
          className="attention-button"
          onClick={() => navigate("attention")}
          aria-label={`Needs attention${unresolved ? `: ${unresolved}` : ""}`}
        >
          <Icon name="history" size={17} />
          {unresolved > 0 && <span className="count">{unresolved}</span>}
        </button>
        {snapshot.wallet.connected ? (
          <div className="wallet-control">
            <span className="wallet-avatar">
              <Icon name="wallet" size={17} />
            </span>
            <WalletAccountPicker
              wallet={snapshot.wallet}
              disabled={!!snapshot.busy}
              onSelect={(address) =>
                void run({ type: "select-account", address })
              }
            />
            <button
              type="button"
              className="disconnect-button"
              disabled={!!snapshot.busy}
              onClick={() => void run({ type: "disconnect-wallet" })}
              aria-label="Disconnect wallet"
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
            {snapshot.wallet.connecting ? "Connecting…" : "Connect wallet"}
          </Button>
        )}
      </div>
    </div>
  );
}
