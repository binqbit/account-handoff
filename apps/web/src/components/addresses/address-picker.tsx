import {
  useEffect,
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
} from "react";
import { Icon } from "../ui";
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
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [touched, setTouched] = useState(false);
  const [active, setActive] = useState(-1);
  const query = value.trim().toLowerCase();
  const matches = options.filter((option) =>
    `${option.label} ${option.detail} ${option.address}`
      .toLowerCase()
      .includes(query),
  );
  const error = touched ? addressError(value, kind) : null;
  const chosen = options.find(
    (option) => addressKey(option.address, kind) === addressKey(value, kind),
  );
  const activeIndex = active >= 0 && active < matches.length ? active : -1;
  useEffect(() => {
    if (open && activeIndex >= 0)
      document
        .getElementById(`${id}-option-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, id, open]);

  function select(address: string) {
    onChange(address);
    onSelect?.(address);
    setOpen(false);
    setActive(-1);
    setTouched(false);
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
      className="field address-picker"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setOpen(false);
          setActive(-1);
          setTouched(true);
        }
      }}
    >
      <label htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </label>
      <div
        className={`address-picker__input ${error ? "address-picker__input--invalid" : ""}`}
      >
        <Icon name={kind === "contract" ? "contract" : "search"} size={18} />
        <input
          ref={input}
          id={id}
          type="text"
          role="combobox"
          value={value}
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
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
          aria-invalid={!!error}
          placeholder={
            placeholder ??
            (kind === "contract"
              ? "Select or paste a contract address (0x…)"
              : "Search accounts or paste a native address")
          }
          onFocus={() => setOpen(true)}
          onPaste={onPaste}
          onKeyDown={keyDown}
          onChange={(event) => {
            onChange(event.target.value);
            setActive(-1);
            setTouched(false);
            setOpen(true);
          }}
        />
        <button
          type="button"
          className="icon-button"
          aria-label={`Show suggestions for ${label}`}
          disabled={disabled}
          onMouseDown={(event) => event.preventDefault()}
          aria-expanded={open}
          aria-controls={`${id}-options`}
          onClick={() => {
            setOpen(!open);
            input.current?.focus();
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
                  <small>{option.detail}</small>
                  <code>{option.address}</code>
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
      {chosen && !open && (
        <p className="address-picker__selected">
          <Icon name="check" size={13} />
          {chosen.label} <span>· {chosen.detail}</span>
        </p>
      )}
      <p className="field__help" id={`${id}-help`}>
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
