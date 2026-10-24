import type { Destination } from "../../ui-contract";
import type { ScreenProps } from "../../routes/screen-types";
import { navigation } from "../../state/navigation";
import { Icon } from "../ui";
import { Topbar } from "./topbar";

export function SiteNavigation(
  props: Pick<ScreenProps, "snapshot" | "navigate" | "run"> & {
    destination: Destination;
  },
) {
  const { snapshot, navigate, destination } = props;
  return (
    <header className="site-header">
      <div className="site-header__main">
        <button
          type="button"
          className="brand"
          onClick={() => navigate("home")}
          aria-label="Account Handoff — home"
        >
          <span className="brand-symbol">
            <Icon name="handoff" size={22} />
          </span>
          <span className="brand-name">
            Account<span className="brand-light">Handoff</span>
          </span>
        </button>
        <nav className="site-nav" aria-label="Main">
          {(
            [
              ["home", "Home"],
              ["workspaces", "Workspaces"],
              ["docs", "Docs"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              aria-current={destination === id ? "page" : undefined}
              onClick={() => navigate(id)}
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            className="site-nav__create"
            aria-label="Create a new workspace"
            onClick={() => navigate("setup")}
          >
            <Icon name="plus" size={15} />
            New workspace
          </button>
        </nav>
        <Topbar {...props} />
      </div>
      {snapshot.workspace && (
        <div className="site-header__workspace">
          <button
            type="button"
            className="workspace-choice"
            onClick={() => navigate("workspaces")}
            aria-label="Choose workspace"
          >
            <Icon name="team" size={17} />
            <span>{snapshot.workspace.name}</span>
            <Icon name="down" size={13} />
          </button>
          <nav className="workspace-tabs" aria-label="Workspace">
            {navigation.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-label={item.label}
                aria-current={destination === item.id ? "page" : undefined}
                onClick={() => navigate(item.id)}
              >
                <Icon name={item.icon} size={16} />
                <span>
                  {item.id === "milestones"
                    ? "Grants"
                    : item.id === "handoff"
                      ? "Handoff"
                      : item.label}
                </span>
              </button>
            ))}
          </nav>
        </div>
      )}
    </header>
  );
}
