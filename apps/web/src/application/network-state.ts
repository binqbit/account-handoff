import type { ChainProfile } from "@account-handoff/contracts";
import {
  NativeConnection,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import {
  readGrant,
  scanGrantHistory,
  type GrantHistory,
} from "@account-handoff/grant-adapter";
import type { AppSnapshot } from "../ui-contract";
import type { ChainView, WorkspaceRecord, LocalDescriptor } from "./models";
import type { WalletAccount } from "@account-handoff/wallet-adapter";
export async function readWorkspaceState(
  connection: NativeConnection,
  f: NativeFingerprint,
  w: WorkspaceRecord | null,
  walletAccounts: WalletAccount[],
): Promise<{
  accounts: ChainView["accounts"];
  grant: ChainView["grant"];
  history: GrantHistory | null;
  baselineChanged: boolean;
}> {
  let baselineChanged = false;
  const addresses = new Set<string>(walletAccounts.map((a) => a.address));
  if (w) {
    Object.values(w.participants).forEach((a) => {
      if (a) addresses.add(a);
    });
    addresses.add(w.M0.account);
    if (w.creator) addresses.add(w.creator.account);
    if (w.M1) addresses.add(w.M1.account);
    if (w.pure) addresses.add(w.pure);
  }
  const entries = await Promise.all(
    [...addresses].map(
      async (address) =>
        [
          address,
          await connection.readAccount(address, f.anchor.hash),
        ] as const,
    ),
  );
  const accounts = Object.fromEntries(entries);
  let grant = null;
  if (
    w?.contract &&
    w.grantId !== null &&
    w.pure &&
    accounts[w.pure]?.mappedTo === w.pure
  )
    grant = await readGrant(
      connection,
      w.pure,
      w.contract,
      BigInt(w.grantId),
      f.anchor.hash,
    );
  let history: GrantHistory | null = null;
  if (w?.contract && w.grantId !== null && w.creationBlock !== undefined) {
    history = await scanGrantHistory(connection, {
      contract: w.contract,
      grantId: w.grantId,
      fromBlock: w.creationBlock,
      toBlock: f.anchor.number,
    });
    const release = history.firstVestingRelease;
    if (!w.baseline && release && w.pure && history.complete) {
      w.baseline = {
        account: await connection.readAccount(w.pure, release.blockHash),
        grant: await readGrant(
          connection,
          w.pure,
          w.contract,
          BigInt(w.grantId),
          release.blockHash,
        ),
        blockHash: release.blockHash,
        creatorReserved: String(
          (
            await connection.readAccount(
              w.creator?.account ?? w.M0.account,
              release.blockHash,
            )
          ).reserved,
        ),
      };
      baselineChanged = true;
    }
  }

  return { accounts, grant, history, baselineChanged };
}
export function connectedNetwork(
  current: AppSnapshot["network"],
  f: NativeFingerprint,
  d: LocalDescriptor | null,
  profile: ChainProfile,
  walletConnected: boolean,
): AppSnapshot["network"] {
  return {
    ...current,
    connected: true,
    checking: false,
    genesis: f.genesis,
    blockHash: f.anchor.hash,
    blockNumber: String(f.anchor.number),
    runtimeVersion: `${f.specName} / ${f.specVersion}`,
    runId: d?.runId ?? null,
    updatedAt: new Date().toISOString(),
    error: null,
    readiness: [
      {
        id: "native",
        label: "Native RPC",
        status: "ready",
        detail: `Finalized block ${f.anchor.number}`,
      },
      {
        id: "profile",
        label: "Runtime profile",
        status: profile.status === "accepted" ? "ready" : "blocked",
        detail:
          profile.status === "accepted"
            ? "Code, metadata, and generated types match the qualified runtime."
            : current.mode === "LOCAL"
              ? "Run local:qualify and generate the native types."
              : "Network reads are available. Transactions require separate qualification for this runtime and contract.",
      },
      {
        id: "wallet",
        label: "Wallet",
        status: walletConnected ? "ready" : "blocked",
        detail: "Select the signer separately from the network.",
      },
    ],
  };
}
