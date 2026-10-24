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
        eyebrow="Ваші простори"
        title="Поверніться до роботи команди"
        description="Відкрийте збережений простір або створіть новий. Гаманець надає особисті акаунти; відомості про грант зберігаються окремо."
        actions={
          <Button
            variant="primary"
            icon="plus"
            onClick={() => navigate("setup")}
          >
            Новий простір
          </Button>
        }
      />
      <div className="workspace-toolbar">
        <label htmlFor={searchId} className="sr-only">
          Знайти робочий простір
        </label>
        <input
          id={searchId}
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Знайти простір за назвою"
        />
        <Button icon="upload" onClick={() => navigate("data")}>
          Імпортувати простір
        </Button>
      </div>
      {filtered.length ? (
        <div className="workspace-grid">
          {filtered.map((workspace) => (
            <Card
              key={workspace.id}
              eyebrow={`${workspace.mode} · відомий простір`}
              title={workspace.name}
              action={<Icon name="overview" />}
            >
              <p className="muted">
                Збережений у цьому браузері. Поточні повноваження перевіряються
                в мережі.
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
                Відкрити простір
              </Button>
            </Card>
          ))}
        </div>
      ) : (
        <EmptyState
          icon="overview"
          title={
            query
              ? "За цією назвою нічого не знайдено"
              : "Перший простір починається тут"
          }
          action={
            !query && (
              <Button
                variant="primary"
                icon="plus"
                onClick={() => navigate("setup")}
              >
                Налаштувати команду
              </Button>
            )
          }
        >
          {query
            ? "Змініть пошуковий запит або відкрийте інший простір."
            : "Додайте склад команди, перевірте контролера та створіть окремого бенефіціара для гранту."}
        </EmptyState>
      )}
    </>
  );
}
