import { useId } from "react";
import type { OperationField } from "../../ui-contract";
import { AddressPicker } from "../addresses/address-picker";
import { Icon } from "../icon";

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
  if (field.type === "contract") {
    return (
      <AddressPicker
        label={field.label}
        value={value}
        onChange={onChange}
        kind="contract"
        options={
          field.value
            ? [
                {
                  address: field.value,
                  label: "Vestry contract",
                  detail: "Current workspace",
                },
              ]
            : []
        }
        help={
          field.help ??
          "Paste the deployed contract address for the selected network."
        }
        required={field.required ?? false}
        disabled={field.readOnly ?? false}
      />
    );
  }
  const selected = field.options?.find((option) => option.value === value);
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
          inputMode={
            field.inputMode ?? (field.type === "number" ? "numeric" : undefined)
          }
          placeholder={field.placeholder}
          autoComplete="off"
        />
      )}
      {field.type === "select" && selected?.detail && (
        <p className="selected-option-detail">
          <Icon name="wallet" size={14} />
          <code>{selected.detail}</code>
        </p>
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
