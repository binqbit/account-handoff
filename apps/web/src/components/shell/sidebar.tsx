import type { Destination } from "../../ui-contract";
import type { ScreenProps } from "../../routes/screen-types";
import { navigation } from "../../state/navigation";
import { Icon } from "../ui";

export function Sidebar({
  snapshot,
  navigate,
  destination,
}: Pick<ScreenProps, "snapshot" | "navigate"> & { destination: Destination }) {
  const activeDestination = destination === "review" ? "" : destination;
  return (
    <aside className="sidebar">
      <button
        type="button"
        className="brand"
        onClick={() => navigate("overview")}
        aria-label="Account Handoff — overview"
      >
        <span className="brand-symbol">
          <Icon name="handoff" size={22} />
        </span>
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
          <strong>{snapshot.workspace?.name ?? "Workspaces"}</strong>
          <small>
            {snapshot.workspace ? "Team workspace" : "Open or create"}
          </small>
        </span>
        <Icon name="chevron" size={15} />
      </button>
      <div className="navigation-label">Workspace</div>
      <nav className="primary-nav" aria-label="Workspace">
        {navigation.map((item) => (
          <button
            type="button"
            key={item.id}
            aria-label={item.label}
            aria-current={activeDestination === item.id ? "page" : undefined}
            onClick={() => navigate(item.id)}
          >
            <Icon name={item.icon} size={19} />
            <span className="nav-copy">
              <strong>{item.label}</strong>
            </span>
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
                : "Network disconnected"}
            </small>
          </span>
          <Icon name="chevron" size={14} />
        </button>
        <nav aria-label="Workspace settings" className="secondary-nav">
          <button
            type="button"
            aria-current={destination === "network" ? "page" : undefined}
            onClick={() => navigate("network")}
          >
            <Icon name="network" size={17} />
            Network and readiness
          </button>
          <button
            type="button"
            aria-current={destination === "data" ? "page" : undefined}
            onClick={() => navigate("data")}
          >
            <Icon name="settings" size={17} />
            Workspace data
          </button>
        </nav>
        <p className="key-assurance">
          <Icon name="shield" size={15} />
          Your keys stay
          <br />
          in your wallet.
        </p>
      </div>
    </aside>
  );
}
