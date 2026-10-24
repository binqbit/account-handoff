import { Badge, Icon } from "./ui";
import type { ReadinessView } from "../ui-contract";

export function ReadinessCards({ rows }: { rows: ReadinessView[] }) {
  return (
    <div className="readiness-list">
      {rows.map((row) => (
        <div key={row.id} className="readiness-row">
          <span className={`readiness-icon readiness-icon--${row.status}`}>
            <Icon
              name={
                row.status === "ready"
                  ? "check"
                  : row.status === "checking"
                    ? "refresh"
                    : "alert"
              }
              size={17}
            />
          </span>
          <div>
            <strong>{row.label}</strong>
            <p>{row.detail}</p>
          </div>
          <Badge
            tone={
              row.status === "ready"
                ? "positive"
                : row.status === "blocked"
                  ? "warning"
                  : "neutral"
            }
          >
            {
              {
                ready: "Готово",
                blocked: "Потрібна дія",
                unknown: "Не перевірено",
                checking: "Перевіряємо",
              }[row.status]
            }
          </Badge>
        </div>
      ))}
    </div>
  );
}
