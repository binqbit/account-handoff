import { blake2AsHex } from "dedot/utils";
import {
  createLocalProgress,
  createSignedAttempt,
} from "@account-handoff/contracts";
import { NativeConnection } from "@account-handoff/native-adapter";
import {
  requestSignature,
  WalletRejectedError,
  WalletGuardError,
  type WalletSession,
} from "@account-handoff/wallet-adapter";
import { type Journal } from "@account-handoff/local-store";
import type { PendingOperation } from "./models";
import { errorText } from "./values";
import type { WalletAccount } from "@account-handoff/wallet-adapter";
export interface SigningContext {
  checkPending: (id: string) => Promise<PendingOperation>;
  getSelected: () => WalletAccount | null;
  wallets: WalletSession[];
  journal: Journal;
  connection: NativeConnection;
  saveRecovery: (p: PendingOperation) => Promise<void>;
  clearRecovery: () => void;
  render: () => void;
}
export async function signOperation(
  {
    checkPending,
    getSelected,
    wallets,
    journal,
    connection,
    saveRecovery,
    clearRecovery,
    render,
  }: SigningContext,
  idValue: string,
): Promise<void> {
  const p = await checkPending(idValue);
  if (p.stage !== "prepared")
    throw new Error("Signing the same request again is prohibited");
  const selected = getSelected()!;
  const wallet = wallets.find((s) => s.source === selected.source);
  if (!wallet) throw new Error("Wallet disconnected");
  const progress = await createLocalProgress({
    envelope: p.envelope,
    context: p.context,
    atUnixSeconds: String(Math.floor(Date.now() / 1000)),
  });
  await journal.appendProgress(progress, p.lease);
  p.stage = "wallet-requested";
  await saveRecovery(p);
  render();
  try {
    const signature = await requestSignature(
      wallet,
      selected,
      p.prepared.payload,
      p.prepared.rawPayload,
    );
    await checkPending(idValue);
    const bytes = connection.attachSignature(p.prepared, signature);
    const attempt = await createSignedAttempt({
      envelope: p.envelope,
      context: p.context,
      bytes,
      hash: blake2AsHex(bytes),
    });
    await journal.recordSignedAttempt(attempt, p.lease);
    p.signedBytes = bytes;
    p.signedAttempt = attempt;
    p.stage = "signed";
    await saveRecovery(p);
  } catch (error) {
    // checkPending can expire the request after the asynchronous wallet response.
    if ((p as PendingOperation).stage === "stale") throw error;
    const rejected =
      error instanceof WalletRejectedError || error instanceof WalletGuardError;
    p.stage = rejected ? "failed" : "unknown";
    p.blockers = [errorText(error)];
    await journal.appendProgress(
      await createLocalProgress({
        envelope: p.envelope,
        context: p.context,
        phase:
          error instanceof WalletRejectedError
            ? "WalletRejected"
            : error instanceof WalletGuardError
              ? "GuardRefused"
              : "WalletOutcomeUnknown",
        atUnixSeconds: String(Math.floor(Date.now() / 1000)),
      }),
    );
    if (rejected) {
      await journal.setPreference("recovery", null);
      clearRecovery();
    } else await saveRecovery(p);
    throw error;
  }
}
