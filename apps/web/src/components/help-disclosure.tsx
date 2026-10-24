import type { ReactNode } from "react";
import { Icon } from "./icon";

export function HelpDisclosure({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <details className="help-disclosure">
      <summary>
        <Icon name="info" size={17} />
        <span>{title}</span>
        <Icon name="down" size={14} />
      </summary>
      <div className="help-disclosure__content">{children}</div>
    </details>
  );
}
