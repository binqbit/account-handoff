import type { Destination } from "../../ui-contract";
import type { ScreenProps } from "../../routes/screen-types";
import { navigation } from "../../state/navigation";
import { Icon } from "../ui";

export function Sidebar({
  snapshot,
  navigate,
  destination,
}: Pick<ScreenProps, "snapshot" | "navigate"> & { destination: Destination }) {
  const activeDestination =
    destination === "handoff"
      ? "team"
      : destination === "review"
        ? ""
        : destination;
  return (
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
            {snapshot.workspace ? "Простір команди" : "Відкрити або створити"}
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
            aria-current={activeDestination === item.id ? "page" : undefined}
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
  );
}
