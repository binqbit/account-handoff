import type { RuntimeMode } from "../../ui-contract";
import { Badge } from "../ui";

export function Footer({ mode }: { mode: RuntimeMode }) {
  return (
    <footer className="page-footer">
      <div>
        <span className="footer-symbol">⇄</span>
        <span>Account Handoff</span>
        <Badge tone={mode === "LIVE" ? "warning" : "neutral"}>{mode}</Badge>
      </div>
      <span>Сталий бенефіціар. Перевірені повноваження.</span>
    </footer>
  );
}
