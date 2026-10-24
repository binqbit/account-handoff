import {
  useId,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import type { IdentityView, OperationField, Tone } from "../ui-contract";

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    overview: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    milestones: (
      <>
        <path d="M9 6h11M9 12h11M9 18h11" />
        <path d="m3 6 1 1 2-2m-3 7 1 1 2-2m-3 7 1 1 2-2" />
      </>
    ),
    team: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v2" />
      </>
    ),
    history: (
      <>
        <path d="M3 10a9 9 0 1 1 2 8M3 4v6h6m3-5v7l4 2" />
      </>
    ),
    arrow: <path d="M5 12h14m-5-5 5 5-5 5" />,
    chevron: <path d="m9 5 7 7-7 7" />,
    back: <path d="M19 12H5m5-5-5 5 5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    alert: (
      <>
        <path d="m12 3 10 18H2L12 3Z" />
        <path d="M12 9v4m0 4h.01" />
      </>
    ),
    network: (
      <>
        <circle cx="12" cy="12" r="3" />
        <circle cx="12" cy="3" r="1" />
        <circle cx="4" cy="18" r="1" />
        <circle cx="20" cy="18" r="1" />
        <path d="M12 4v5m-2 5-5 3m9-3 5 3" />
      </>
    ),
    wallet: (
      <>
        <path d="M4 6V4h15v4M4 6h16v14H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2Z" />
        <path d="M20 11h-6v4h6" />
        <circle cx="16" cy="13" r=".5" />
      </>
    ),
    copy: (
      <>
        <rect x="8" y="8" width="12" height="12" rx="2" />
        <path d="M16 8V4H4v12h4" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    upload: (
      <>
        <path d="M12 16V4m-5 5 5-5 5 5M4 16v5h16v-5" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 2M5 16a8 8 0 0 0 13 2" />
      </>
    ),
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-6" />
      </>
    ),
    settings: (
      <>
        <path d="M4 6h16M4 12h16M4 18h16" />
        <circle cx="9" cy="6" r="2" />
        <circle cx="15" cy="12" r="2" />
        <circle cx="8" cy="18" r="2" />
      </>
    ),
    close: <path d="m6 6 12 12M18 6 6 18" />,
    link: (
      <>
        <path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m4 0 2-2a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.arrow}
    </svg>
  );
}
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
