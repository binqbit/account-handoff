import type { Destination } from "../../ui-contract";
import type { ScreenProps } from "../../routes/screen-types";
import { titles } from "../../state/navigation";
import { Address, Button, Icon } from "../ui";
import { compactAddress } from "../addresses/format";

export function Topbar({
  snapshot,
  navigate,
  run,
  destination,
}: Pick<ScreenProps, "snapshot" | "navigate" | "run"> & {
  destination: Destination;
}) {
  const unresolved =
    snapshot.workspace?.history.filter((entry) => entry.unresolved).length ?? 0;
  return (
    <header className="topbar">
      <div className="breadcrumb">
        <span>{snapshot.workspace?.name ?? "Account Handoff"}</span>
        <Icon name="chevron" size={13} />
        <strong>{titles[destination]}</strong>
      </div>
      <div className="topbar-actions">
        <button
          type="button"
          className="attention-button"
          onClick={() => navigate("attention")}
          aria-label={`Needs attention${unresolved ? `: ${unresolved}` : ""}`}
        >
          <Icon name="history" size={17} />
          <span>Needs attention</span>
          {unresolved > 0 && <span className="count">{unresolved}</span>}
        </button>
        <span className="topbar-divider" />
        {snapshot.wallet.connected ? (
          <div className="wallet-control">
            <span className="wallet-avatar">
              <Icon name="wallet" size={17} />
            </span>
            <div className="wallet-details">
              <label className="sr-only" htmlFor="selected-wallet-account">
                Personal account
              </label>
              <select
                id="selected-wallet-account"
                value={snapshot.wallet.selectedAddress ?? ""}
                onChange={(event) =>
                  void run({
                    type: "select-account",
                    address: event.target.value,
                  })
                }
                disabled={!!snapshot.busy}
              >
                {!snapshot.wallet.selectedAddress && (
                  <option value="">Select an account</option>
                )}
                {snapshot.wallet.accounts.map((account) => {
                  const name = account.label?.trim() || account.name?.trim();
                  const duplicateName =
                    name &&
                    snapshot.wallet.accounts.filter(
                      (other) =>
                        (other.label?.trim() || other.name?.trim()) === name,
                    ).length > 1;
                  return (
                    <option
                      key={`${account.source}-${account.address}`}
                      value={account.address}
                      title={account.address}
                    >
                      {name ?? compactAddress(account.address)}
                      {duplicateName
                        ? ` · ${compactAddress(account.address)}`
                        : ""}
                      {account.role ? ` · ${account.role}` : ""}
                    </option>
                  );
                })}
              </select>
              <Address
                value={snapshot.wallet.selectedAddress}
                compact
                label="signing account address"
              />
            </div>
            <button
              type="button"
              className="disconnect-button"
              disabled={!!snapshot.busy}
              onClick={() => void run({ type: "disconnect-wallet" })}
              aria-label="Disconnect wallet"
            >
              <Icon name="close" size={15} />
            </button>
          </div>
        ) : (
          <Button
            icon="wallet"
            variant="primary"
            disabled={snapshot.wallet.connecting || !!snapshot.busy}
            onClick={() => void run({ type: "connect-wallet" })}
          >
            {snapshot.wallet.connecting ? "Connecting…" : "Connect wallet"}
          </Button>
        )}
      </div>
    </header>
  );
}
