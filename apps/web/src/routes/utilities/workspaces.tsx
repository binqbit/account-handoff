import { useId, useState } from "react";
import {
  Button,
  Card,
  EmptyState,
  Icon,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";

export function Workspaces(props: ScreenProps) {
  const { snapshot, navigate, run } = props;
  const [query, setQuery] = useState("");
  const searchId = useId();
  const filtered = snapshot.workspaces.filter((workspace) =>
    workspace.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  return (
    <>
      <PageHeader
        eyebrow="Your workspaces"
        title="Return to your team's work"
        description="Open a saved workspace or create a new one. The wallet provides personal accounts; grant details are stored separately."
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate("setup")}
          >
            New workspace
          </Button>
        }
      />
      <div className="workspace-toolbar">
        <label htmlFor={searchId} className="sr-only">
          Find a workspace
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a workspace by name"
        />
        <Button icon="upload" onClick={() => navigate("data")}>
          Import workspace
        </Button>
      </div>
      {filtered.length ? (
        <div className="workspace-grid">
          {filtered.map((workspace) => (
            <Card
              key={workspace.id}
              eyebrow={`${workspace.mode} · saved workspace`}
              title={workspace.name}
              action={<Icon name="overview" />}
            >
              <p className="muted">
                Saved in this browser. Current authority is verified on the
                network.
              </p>
              <Button
                variant="primary"
                icon="arrow"
                disabled={!!snapshot.busy}
                onClick={() =>
                  void run({ type: "select-workspace", id: workspace.id }).then(
                    () => navigate("overview"),
                  )
                }
              >
                Open workspace
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="overview"
          title={
            query
              ? "No workspace matches this name"
              : "Your first workspace starts here"
          }
          action={
            !query && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => navigate("setup")}
              >
                Set up a team
              </Button>
            )
          }
        >
          {query
            ? "Change the search or open another workspace."
            : "Add the team, verify its controller and create a separate grant beneficiary."}
        </EmptyState>
      )}
    </>
  );
}
