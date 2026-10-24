import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icon";
import { compactAddress } from "./format";

/** Display formatting never changes the value used for copying or signing. */
export function Address({
  value,
  label = "address",
  compact = true,
}: {
  value: string | null | undefined;
  label?: string;
  compact?: boolean;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const latestValue = useRef(value);
  latestValue.current = value;
  const [expanded, setExpanded] = useState(false);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );
  useEffect(() => {
    setExpanded(false);
    setCopyState("idle");
  }, [value]);
  useEffect(() => {
    if (copyState !== "copied") return;
    const timer = window.setTimeout(() => setCopyState("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copyState]);
  if (!value) return <span className="unknown-value">Not set yet</span>;
  const shortened = compact && compactAddress(value) !== value;
  async function copy() {
    try {
      await navigator.clipboard.writeText(value!);
      if (latestValue.current === value) setCopyState("copied");
    } catch {
      if (latestValue.current === value) {
        setCopyState("failed");
        setExpanded(true);
      }
    }
  }
  return (
    <span
      className={`address-wrap ${shortened ? "address-wrap--compact" : ""}`}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      {shortened ? (
        <button
          ref={trigger}
          type="button"
          className="address-value"
          aria-label={`${expanded ? "Hide" : "Show"} full ${label}`}
          aria-expanded={expanded}
          aria-controls={id}
          onClick={() => setExpanded(!expanded)}
        >
          <code className="address">{compactAddress(value)}</code>
          <Icon name="down" size={12} />
        </button>
      ) : (
        <code className="address">{value}</code>
      )}
      <button
        type="button"
        className="icon-button address-copy"
        onClick={() => void copy()}
        aria-label={
          copyState === "copied" ? `Copied ${label}` : `Copy ${label}`
        }
      >
        <Icon
          name={
            copyState === "copied"
              ? "check"
              : copyState === "failed"
                ? "alert"
                : "copy"
          }
          size={14}
        />
      </button>
      {shortened && (
        <span id={id} className="address-full" hidden={!expanded}>
          <code className="address">{value}</code>
        </span>
      )}
      {copyState === "failed" && (
        <span className="address-feedback" role="alert">
          Copy failed. Select the full value to copy it manually.
        </span>
      )}
      <span className="sr-only" role="status">
        {copyState === "copied" ? `${label} copied` : ""}
      </span>
    </span>
  );
}
