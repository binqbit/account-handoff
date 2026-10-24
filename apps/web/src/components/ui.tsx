import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { IdentityView, OperationField, Tone } from "../ui-contract";
import { Icon } from "./icon";
export { Icon } from "./icon";

export function Button({
  variant = "secondary",
  icon,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  icon?: string;
}) {
  return (
    <button
      {...props}
      className={`button button--${variant} ${props.className ?? ""}`}
    >
      {icon && <Icon name={icon} size={17} />}
      {children}
    </button>
  );
}
export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className={`badge badge--${tone}`}>
      <span className="badge__dot" />
      {children}
    </span>
  );
}
export function Card({
  title,
  eyebrow,
  children,
  className = "",
  action,
}: {
  title?: string;
  eyebrow?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      {(title || eyebrow || action) && (
        <header className="card__heading">
          <div>
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            {title && <h2>{title}</h2>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <p className="eyebrow">{eyebrow}</p>}
        <h1 tabIndex={-1} id="page-heading">
          {title}
        </h1>
        <p className="lede">{description}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
export function KeyValues({
  rows,
}: {
  rows: { label: string; value: ReactNode }[];
}) {
  return (
    <dl className="key-values">
      {rows.map((row, i) => (
        <div key={`${row.label}-${i}`}>
          <dt>{row.label}</dt>
          <dd>{row.value}</dd>
        </div>
      ))}
    </dl>
  );
}
export function Address({
  value,
  label,
  compact = false,
}: {
  value: string | null | undefined;
  label?: string;
  compact?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="unknown-value">Not set yet</span>;
  const display =
    compact && value.length > 24
      ? `${value.slice(0, 10)}…${value.slice(-8)}`
      : value;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <span className="address-wrap">
      <code className="address" title={compact ? value : undefined}>
        {display}
      </code>
      <button
        className="icon-button"
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? "Copied" : `Copy ${label ?? "address"}`}
      >
        <Icon name={copied ? "check" : "copy"} size={14} />
      </button>
      <span className="sr-only" role="status">
        {copied ? "Address copied" : ""}
      </span>
    </span>
  );
}
export function Identity({ identity }: { identity: IdentityView | null }) {
  if (!identity)
    return (
      <span className="unknown-value">A verified address is required</span>
    );
  return (
    <div className="identity">
      {identity.label && (
        <span className="identity__label">{identity.label}</span>
      )}
      <Address value={identity.address} />
    </div>
  );
}
export function Notice({
  children,
  tone = "neutral",
  title,
}: {
  children: ReactNode;
  tone?: Tone;
  title?: string;
}) {
  return (
    <div className={`notice notice--${tone}`}>
      <Icon
        name={
          tone === "positive"
            ? "check"
            : tone === "neutral"
              ? "shield"
              : "alert"
        }
        size={19}
      />
      <div>
        {title && <strong>{title}</strong>}
        <div>{children}</div>
      </div>
    </div>
  );
}
export function EmptyState({
  title,
  children,
  action,
  icon = "overview",
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
  icon?: string;
}) {
  return (
    <div className="empty-state">
      <div className="empty-state__icon">
        <Icon name={icon} size={28} />
      </div>
      <h2>{title}</h2>
      <p>{children}</p>
      {action && <div className="actions">{action}</div>}
    </div>
  );
}
export function OperationInput({
  field,
  value,
  onChange,
}: {
  field: OperationField;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  const helpId = `${id}-help`;
  const count = new TextEncoder().encode(value).length;
  const common = {
    id,
    name: field.name,
    value,
    onChange: (
      event: React.ChangeEvent<
        HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
      >,
    ) => onChange(event.target.value),
    required: field.required,
    readOnly: field.readOnly,
    "aria-describedby": field.help || field.maxBytes ? helpId : undefined,
    "aria-invalid": field.maxBytes ? count > field.maxBytes : undefined,
  };
  return (
    <div className="field">
      <label htmlFor={id}>
        {field.label}
        {field.required && <span aria-hidden="true"> *</span>}
      </label>
      {field.type === "textarea" ? (
        <textarea {...common} placeholder={field.placeholder} rows={5} />
      ) : field.type === "select" ? (
        <select {...common} disabled={field.readOnly}>
          {field.options?.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...common}
          type="text"
          inputMode={field.type === "number" ? "numeric" : undefined}
          placeholder={field.placeholder}
          autoComplete="off"
        />
      )}
      {(field.help || field.maxBytes) && (
        <p
          id={helpId}
          className={`field__help ${field.maxBytes && count > field.maxBytes ? "text-negative" : ""}`}
        >
          {field.help}
          {field.maxBytes && (
            <span className="byte-count">
              {count.toLocaleString("en-US")} /{" "}
              {field.maxBytes.toLocaleString("en-US")} bytes
            </span>
          )}
        </p>
      )}
    </div>
  );
}
export function Evidence({
  value,
  title = "Technical details",
}: {
  value: unknown;
  title?: string;
}) {
  return (
    <details className="evidence">
      <summary>{title}</summary>
      <pre>
        {JSON.stringify(
          value,
          (_key, item: unknown) =>
            typeof item === "bigint" ? item.toString() : item,
          2,
        )}
      </pre>
    </details>
  );
}
