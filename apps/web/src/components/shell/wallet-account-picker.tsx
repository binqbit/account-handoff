import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { AppSnapshot } from "../../ui-contract";
import { useWalletCopy } from "./use-wallet-copy";
import { compactAddress } from "../addresses/format";
import { Icon } from "../icon";

export function WalletAccountPicker({
  wallet,
  disabled,
  onSelect,
}: {
  wallet: AppSnapshot["wallet"];
  disabled: boolean;
  onSelect(address: string): void;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  // One address is one choice; the wallet coordinator preserves its connected source.
  const available = new Map<
    string,
    AppSnapshot["wallet"]["accounts"][number]
  >();
  for (const account of wallet.accounts) {
    if (!available.has(account.address) || account.source === wallet.source)
      available.set(account.address, account);
  }
  const accounts = [...available.values()];
  const selectedIndex = accounts.findIndex(
    (account) => account.address === wallet.selectedAddress,
  );
  const selected = accounts[selectedIndex];
  const name = (account: typeof selected) =>
    account?.label?.trim() || account?.name?.trim() || "Account";
  const activeIndex = Math.min(active, accounts.length - 1);
  const clipboard = useWalletCopy(selected?.address ?? null);

  useEffect(() => {
    if (!open && clipboard.state !== "failed") return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) {
        setOpen(false);
        clipboard.clear();
      }
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open, clipboard.state, clipboard.clear]);
  useEffect(() => {
    if (open && activeIndex >= 0)
      document
        .getElementById(`${id}-account-${activeIndex}`)
        ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, id]);

  function choose(index: number) {
    const account = accounts[index];
    if (!account || disabled) return;
    setOpen(false);
    trigger.current?.focus();
    onSelect(account.address);
  }
  function keyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!accounts.length) {
        setOpen(true);
        return;
      }
      const initial = selectedIndex >= 0 ? selectedIndex : 0;
      const next =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? accounts.length - 1
            : open
              ? (activeIndex +
                  (event.key === "ArrowDown" ? 1 : -1) +
                  accounts.length) %
                accounts.length
              : initial;
      setActive(next);
      setOpen(true);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (open) choose(activeIndex);
      else {
        setActive(Math.max(0, selectedIndex));
        setOpen(true);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    } else if (event.key === "Tab") setOpen(false);
  }

  return (
    <div
      className="wallet-details wallet-account-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="wallet-account-summary">
        <button
          ref={trigger}
          className="wallet-account-trigger"
          type="button"
          role="combobox"
          aria-label="Personal account"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={`${id}-accounts`}
          aria-describedby={selected ? `${id}-selection` : undefined}
          aria-activedescendant={
            open && activeIndex >= 0
              ? `${id}-account-${activeIndex}`
              : undefined
          }
          data-selected-address={selected?.address ?? ""}
          disabled={disabled}
          onKeyDown={keyDown}
          onClick={() => {
            setActive(Math.max(0, selectedIndex));
            setOpen(!open);
          }}
        >
          <span className="wallet-account-identity">
            <strong>{selected ? name(selected) : "Select an account"}</strong>
            {selected && <code>{compactAddress(selected.address)}</code>}
          </span>
          <Icon name="down" size={14} />
        </button>
        {selected && (
          <button
            type="button"
            className="wallet-account-copy"
            disabled={disabled}
            aria-label={
              clipboard.state === "copied"
                ? "Copied signing account address"
                : "Copy signing account address"
            }
            onClick={() => {
              setOpen(false);
              void clipboard.copy();
            }}
          >
            <Icon
              name={clipboard.state === "copied" ? "check" : "copy"}
              size={14}
            />
          </button>
        )}
      </div>
      {selected && (
        <span className="sr-only" id={`${id}-selection`}>
          {name(selected)}: {selected.address}
        </span>
      )}
      <span className="sr-only" role="status">
        {clipboard.state === "copied" ? "Signing account address copied" : ""}
      </span>
      {selected && clipboard.state === "failed" && !open && (
        <div className="wallet-copy-error" role="alert">
          Copy failed. Select this address to copy it manually.
          <code>{selected.address}</code>
        </div>
      )}
      {open && (
        <div
          className="wallet-account-list"
          id={`${id}-accounts`}
          role="listbox"
          aria-label="Wallet accounts"
        >
          {accounts.length ? (
            accounts.map((account, index) => (
              <div
                key={account.address}
                className={`wallet-account-option${activeIndex === index ? " wallet-account-option--active" : ""}`}
                id={`${id}-account-${index}`}
                role="option"
                aria-selected={selectedIndex === index}
                aria-label={`${name(account)}: ${account.address}`}
                data-address={account.address}
                onMouseDown={(event) => event.preventDefault()}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(index)}
              >
                <span>
                  <strong>{name(account)}</strong>
                  <code>{compactAddress(account.address)}</code>
                </span>
                {selectedIndex === index && <Icon name="check" size={16} />}
              </div>
            ))
          ) : (
            <p>No accounts shared by the wallet.</p>
          )}
        </div>
      )}
    </div>
  );
}
