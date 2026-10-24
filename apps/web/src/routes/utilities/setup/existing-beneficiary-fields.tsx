import { useState } from "react";
import { AddressPicker } from "../../../components/addresses/address-picker";
import type { WorkspaceInput } from "../../../ui-contract";

export function ExistingBeneficiaryFields({
  value,
  onChange,
  disabled,
}: {
  value: Partial<WorkspaceInput>;
  onChange(value: Partial<WorkspaceInput>): void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const update = (change: Partial<WorkspaceInput>) =>
    onChange({ ...value, ...change });
  return (
    <>
      <button
        type="button"
        className="text-button"
        aria-expanded={open}
        aria-controls="existing-beneficiary"
        onClick={() => {
          setOpen(!open);
          if (open) onChange({});
        }}
      >
        Attach an existing beneficiary or grant
      </button>
      {open && (
        <div className="advanced-fields" id="existing-beneficiary">
          <AddressPicker
            label="Pure beneficiary address"
            value={value.beneficiary ?? ""}
            onChange={(beneficiary) => update({ beneficiary })}
            options={[]}
            disabled={disabled}
            required
            help="A Pure account controlled by this multisig. Its original creation and current controller will be verified."
          />
          <div className="field">
            <label htmlFor="pure-block">Creation block hash</label>
            <input
              id="pure-block"
              value={value.creation?.blockHash ?? ""}
              onChange={(event) =>
                update({
                  creation: {
                    transactionHash: value.creation?.transactionHash ?? "",
                    blockHash: event.target.value,
                  },
                })
              }
              placeholder="0x…"
              pattern="0x[0-9a-fA-F]{64}"
              required
              disabled={disabled}
            />
          </div>
          <div className="field">
            <label htmlFor="pure-transaction">Creation transaction hash</label>
            <input
              id="pure-transaction"
              value={value.creation?.transactionHash ?? ""}
              onChange={(event) =>
                update({
                  creation: {
                    blockHash: value.creation?.blockHash ?? "",
                    transactionHash: event.target.value,
                  },
                })
              }
              placeholder="0x…"
              pattern="0x[0-9a-fA-F]{64}"
              required
              disabled={disabled}
            />
          </div>
          <AddressPicker
            label="Grant contract (optional)"
            value={value.contract ?? ""}
            onChange={(contract) => {
              const next = { ...value };
              if (contract) next.contract = contract;
              else delete next.contract;
              onChange(next);
            }}
            options={[]}
            kind="contract"
            disabled={disabled}
            help="The verified Vestry deployment on this network."
          />
          <div className="field">
            <label htmlFor="known-grant">Grant ID (optional)</label>
            <input
              id="known-grant"
              value={value.grantId ?? ""}
              onChange={(event) => {
                const next = { ...value };
                if (event.target.value) next.grantId = event.target.value;
                else delete next.grantId;
                onChange(next);
              }}
              inputMode="numeric"
              pattern="0|[1-9][0-9]*"
              placeholder="e.g. 0"
              disabled={disabled}
            />
          </div>
        </div>
      )}
    </>
  );
}
