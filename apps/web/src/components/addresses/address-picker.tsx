import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { Icon } from "../icon";
import { Address } from "./address";
import { compactAddress } from "./format";
import {
  addressError,
  addressKey,
  type AddressKind,
  type AddressOption,
} from "./options";

export function AddressPicker({
  label,
  value,
  onChange,
  options,
  help,
  kind = "native",
  required = false,
  disabled = false,
  onSelect,
  onPaste,
  placeholder,
  compact = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: AddressOption[];
  help: string;
  kind?: AddressKind;
  required?: boolean;
  disabled?: boolean;
  onSelect?: (value: string) => void;
  onPaste?: (event: ClipboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  compact?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [editing, setEditing] = useState(false);
  const [active, setActive] = useState(-1);
  const [filtering, setFiltering] = useState(false);
  const query = filtering ? value.trim().toLowerCase() : "";
  const matches = options.filter((option) =>
    `${option.label} ${option.detail} ${option.address}`
      .toLowerCase()
      .includes(query),
  );
  const error = touched ? addressError(value, kind) : null;
  const chosen = options.find(
    (option) => addressKey(option.address, kind) === addressKey(value, kind),
  );
  const hasSelection = !onSelect && !!addressKey(value, kind);
  const displayValue =
    hasSelection && !editing
      ? (chosen?.label ??
        (kind === "contract" ? "Contract address" : "Custom account"))
      : value;
  const activeIndex = active >= 0 && active < matches.length ? active : -1;
  useEffect(() => {
    if (open && activeIndex >= 0)
      document
        .getElementById(`${id}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open]);

  function openOptions() {
    setEditing(true);
    setFiltering(!!value.trim() && !addressKey(value, kind));
    setOpen(true);
  }
  function select(address: string) {
    onChange(address);
    onSelect?.(address);
    setOpen(false);
    setActive(-1);
    setTouched(false);
    setFiltering(false);
    input.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      const next =
        activeIndex < 0
          ? event.key === "ArrowDown"
            ? 0
            : matches.length - 1
          : event.key === "ArrowDown"
            ? activeIndex + 1
            : activeIndex - 1;
      setActive(matches.length ? (next + matches.length) % matches.length : -1);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActive(-1);
    } else if (event.key === "Enter") {
      const option =
        open && activeIndex >= 0 ? matches[activeIndex] : undefined;
      if (option || onSelect) {
        event.preventDefault();
        if (option) select(option.address);
        else if (addressKey(value, kind)) select(value.trim());
        else setTouched(true);
      }
    }
  }
  return (
    <div
      className={`field address-picker ${compact ? "address-picker--compact" : ""}`}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
          setTouched(true);
        }
      }}
    >
      <label htmlFor={id} className={compact ? "sr-only" : undefined}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div
        className={`address-picker__input ${error ? "address-picker__input--invalid" : ""}`}
        onClick={(event) => {
          if ((event.target as Element).closest("button")) return;
          input.current?.focus();
          openOptions();
        }}
      >
        <Icon name={kind === "contract" ? "contract" : "search"} size={18} />
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          value={value}
          className={
            hasSelection && !editing ? "address-picker__named" : undefined
          }
          required={required}
          disabled={disabled}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          aria-autocomplete="list"
          aria-expanded={open}
          aria-controls={`${id}-options`}
          aria-activedescendant={
            open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined
          }
          aria-describedby={`${id}-help${hasSelection ? ` ${id}-selected` : ""}${error ? ` ${id}-error` : ""}`}
          aria-invalid={!!error}
          placeholder={
            placeholder ??
            (kind === "contract"
              ? "Select or paste a contract address (0x…)"
              : "Search accounts or paste a native address")
          }
          onFocus={openOptions}
          onBlur={() => setEditing(false)}
          onPaste={onPaste}
          onKeyDown={keyDown}
          onChange={(event) => {
            onChange(event.target.value);
            setFiltering(true);
            setActive(-1);
            setTouched(false);
            setOpen(true);
          }}
        />
        {hasSelection && !editing && (
          <span className="address-picker__name" aria-hidden="true">
            {displayValue}
          </span>
        )}
        <button
          type="button"
          className="icon-button"
          aria-label={`Show suggestions for ${label}`}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          aria-expanded={open}
          aria-controls={`${id}-options`}
          onClick={() => {
            const next = !open;
            input.current?.focus();
            if (next && addressKey(value, kind)) setFiltering(false);
            setOpen(next);
          }}
        >
          <Icon name="down" size={16} />
        </button>
      </div>
      {open && (
        <div className="address-picker__panel">
          <div className="address-picker__caption">
            {matches.length ? "Known accounts" : "Enter an address"}
          </div>
          <div
            role="listbox"
            id={`${id}-options`}
            aria-label={`${label} suggestions`}
            className="address-picker__options"
          >
            {matches.map((option, index) => (
              <div
                key={option.address}
                id={`${id}-option-${index}`}
                role="option"
                aria-selected={chosen?.address === option.address}
                className={`address-option ${index === activeIndex ? "address-option--active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option.address)}
              >
                <span className="account-mark">
                  <Icon name="wallet" size={17} />
                </span>
                <span className="address-option__body">
                  <strong>{option.label}</strong>
                  <small title={option.detail}>{option.detail}</small>
                  <code title={option.address}>
                    {compactAddress(option.address)}
                  </code>
                  <span className="sr-only">
                    Full address: {option.address}
                  </span>
                </span>
                {chosen?.address === option.address && (
                  <Icon name="check" size={16} />
                )}
              </div>
            ))}
          </div>
          {!matches.length && (
            <p className="address-picker__empty">
              {options.length
                ? "No matching account. "
                : "No known accounts yet. Connect a wallet to see suggestions, or "}
              Paste a public {kind === "contract" ? "contract" : "native"}{" "}
              address.{onSelect ? " Press Enter to add it." : ""}
            </p>
          )}
        </div>
      )}
      {hasSelection && (
        <span id={`${id}-selected`} className="sr-only">
          Selected address: {value}
        </span>
      )}
      {hasSelection && !editing && !open && (
        <div className="address-picker__selected">
          <Address value={value} label={`${label} address`} />
        </div>
      )}
      <p className={compact ? "sr-only" : "field__help"} id={`${id}-help`}>
        {help}
      </p>
      {error && (
        <p className="field__error" id={`${id}-error`} role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
