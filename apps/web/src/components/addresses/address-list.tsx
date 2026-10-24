import { useEffect, useId, useRef, useState } from "react";
import { Icon } from "../icon";
import { AddressPicker } from "./address-picker";
import { addressKey, compactAddress, type AddressOption } from "./options";

export function AddressList({
  label,
  values,
  onChange,
  options,
  count,
  help,
  disabled = false,
}: {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  options: AddressOption[];
  count: number;
  help: string;
  disabled?: boolean;
}) {
  const id = useId();
  const group = useRef<HTMLFieldSetElement>(null);
  const focusLastAccount = useRef(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const keys = values.map((value) => addressKey(value));
  useEffect(() => {
    if (focusLastAccount.current && values.length === count) {
      const buttons = group.current?.querySelectorAll<HTMLButtonElement>(
        ".address-chips button",
      );
      buttons?.[buttons.length - 1]?.focus();
      focusLastAccount.current = false;
    }
  }, [values.length, count]);
  function add(addresses: string[]) {
    if (addresses.some((value) => !addressKey(value))) {
      setError(
        "Use native SS58 addresses or 32-byte AccountIds. No addresses were added.",
      );
      return;
    }
    const next = [...values];
    for (const address of addresses) {
      if (!next.some((value) => addressKey(value) === addressKey(address)))
        next.push(address);
    }
    if (next.length > count) {
      setError(
        `Choose exactly ${count} different accounts. Remove an account before adding another.`,
      );
      return;
    }
    if (next.length === values.length) {
      setError("This account is already in the group.");
      return;
    }
    focusLastAccount.current = next.length === count;
    onChange(next);
    setDraft("");
    setError("");
  }
  return (
    <fieldset
      ref={group}
      aria-label={label}
      className="address-list"
      aria-describedby={`${id}-help`}
      disabled={disabled}
    >
      <legend>
        {label}
        <span
          className={`selection-count ${values.length === count ? "selection-count--complete" : ""}`}
        >
          {values.length} / {count}
        </span>
      </legend>
      <p className="field__help" id={`${id}-help`}>
        {help}
      </p>
      <ul
        className="address-chips"
        aria-label={`Selected accounts for ${label}`}
      >
        {values.map((value, index) => {
          const known = options.find(
            (option) => addressKey(option.address) === addressKey(value),
          );
          return (
            <li key={value}>
              <span className="account-mark">
                <Icon name="wallet" size={16} />
              </span>
              <span className="address-chip__body">
                <strong>{known?.label ?? `Account ${index + 1}`}</strong>
                <code title={value}>{compactAddress(value)}</code>
              </span>
              <button
                className="icon-button"
                type="button"
                aria-label={`Remove ${known?.label ?? `account ${index + 1}`} from ${label}`}
                onClick={() => {
                  onChange(values.filter((_, i) => i !== index));
                  setError("");
                }}
              >
                <Icon name="close" size={16} />
              </button>
            </li>
          );
        })}
      </ul>
      {values.length < count && (
        <AddressPicker
          label={`Add account to ${label}`}
          value={draft}
          onChange={setDraft}
          options={options.filter(
            (option) => !keys.includes(addressKey(option.address)),
          )}
          onSelect={(value) => add([value])}
          help="Select an account, or paste an address and press Enter. You can paste a whole list separated by commas or new lines."
          onPaste={(event) => {
            const pasted = event.clipboardData
              .getData("text")
              .trim()
              .split(/[\s,;]+/)
              .filter(Boolean);
            if (pasted.length > 1) {
              event.preventDefault();
              add(pasted);
            }
          }}
        />
      )}
      {values.length === count && (
        <p className="selection-complete">
          <Icon name="check" size={14} />
          All {count} accounts selected. Remove one to change it.
        </p>
      )}
      {error && (
        <p className="field__error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
