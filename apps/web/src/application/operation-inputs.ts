import type { AccountingLedger } from "@account-handoff/contracts";
import { type FreshOperationInput } from "@account-handoff/domain";
import {
  NativeConnection,
  hex,
  contractAddress,
  object,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import {
  readGrant,
  scanGrantHistory,
  isGrantReviewer,
} from "@account-handoff/grant-adapter";
import type { ChainView, WorkspaceRecord, PendingOperation } from "./models";
import { workspaceView } from "./presentation";
import { schedules } from "./values";
export async function loadOperationInputs(
  {
    connection,
    chain,
    workspace: w,
    accounting,
  }: {
    connection: NativeConnection;
    chain: ChainView;
    workspace: WorkspaceRecord;
    accounting: (
      f: NativeFingerprint,
      accounts: ChainView["accounts"],
    ) => Promise<AccountingLedger | undefined>;
  },
  p: Pick<
    PendingOperation,
    "envelope" | "action" | "signer" | "phase" | "actionId"
  >,
  f: NativeFingerprint,
): Promise<FreshOperationInput & { accounts: ChainView["accounts"] }> {
  const wanted = new Set([
    ...Object.values(w.participants).filter((a): a is string => a !== null),
    w.M0.account,
    ...(w.creator ? [w.creator.account] : []),
    ...(w.M1 ? [w.M1.account] : []),
    p.signer,
    ...(w.pure ? [w.pure] : []),
  ]);
  const accounts = Object.fromEntries(
    await Promise.all(
      [...wanted].map(async (address) => [
        address,
        await connection.readAccount(address, f.anchor.hash),
      ]),
    ),
  );
  const grant =
    w.contract && w.grantId !== null && w.pure
      ? await readGrant(
          connection,
          w.pure,
          w.contract,
          BigInt(w.grantId),
          f.anchor.hash,
        )
      : null;
  const history =
    w.contract && w.grantId !== null && w.creationBlock !== undefined
      ? await scanGrantHistory(connection, {
          contract: w.contract,
          grantId: w.grantId,
          fromBlock: w.creationBlock,
          toBlock: f.anchor.number,
        })
      : null;
  const target =
    p.action.kind === "cancel"
      ? String(
          p.envelope.intent.parameters["targetController"] &&
            object(p.envelope.intent.parameters["targetController"])["account"],
        )
      : p.envelope.controller?.account;
  const hash =
    p.action.kind === "cancel"
      ? p.action.callHash
      : p.envelope.innerRuntimeCallHash;
  const proposal =
    target && hash
      ? await connection.proposal(target, hex(hash, 32), f.anchor.hash)
      : null;
  const expected =
    p.action.kind === "multisig"
      ? p.action.timepoint
      : p.action.kind === "cancel"
        ? p.action.timepoint
        : undefined;
  const ledger = await accounting(f, accounts);
  const pure = w.pure ? accounts[w.pure] : null;
  const reviewer =
    p.actionId === "GRC-GRANT-APPROVE" &&
    w.contract &&
    w.grantId !== null &&
    w.pure
      ? await isGrantReviewer(
          connection,
          w.pure,
          w.contract,
          BigInt(w.grantId),
          contractAddress(p.signer),
          f.anchor.hash,
        )
      : false;
  const rotation = ["GRC-ROTATION-ADD-M1", "GRC-ROTATION-REMOVE-M0"].includes(
    p.actionId,
  );
  const baseline = rotation ? (w.handoffBaseline ?? w.baseline) : w.baseline;
  return {
    envelope: p.envelope,
    signer: p.signer,
    phase: p.phase,
    profileDigest: chain.profile.digest,
    timeUnixSeconds: (await connection.currentBlockTime(f.anchor.hash)) / 1000n,
    authorityTuples: pure?.proxies ?? null,
    accounts,
    grant,
    grantScope: history?.scope ?? "Unverified",
    grantHistoryComplete: history?.complete ?? false,
    proposal: proposal ? { ...proposal, callHash: hash! } : null,
    ...(expected ? { expectedProposalTimepoint: expected } : {}),
    pure: w.pure,
    mappedPure: w.pure ? contractAddress(w.pure) : null,
    M0: w.M0.account,
    M1: w.M1?.account ?? null,
    existentialDepositNative: connection.api.consts.balances.existentialDeposit,
    proposalDepositNative:
      connection.api.consts.multisig.depositBase +
      connection.api.consts.multisig.depositFactor * 2n,
    pureCreationDepositNative:
      connection.api.consts.proxy.proxyDepositBase +
      connection.api.consts.proxy.proxyDepositFactor,
    mappingDepositNative:
      connection.api.consts.revive.depositPerItem +
      connection.api.consts.revive.depositPerByte * 52n,
    proxyIncrementNative: connection.api.consts.proxy.proxyDepositFactor,
    ...(ledger ? { accounting: ledger } : {}),
    ...(baseline
      ? { baselineVesting: schedules(baseline.account.vesting) }
      : {}),
    ...(pure ? { currentVesting: schedules(pure.vesting) } : {}),
    vestingBlockNumber: BigInt(f.anchor.number),
    reviewerAuthorized: reviewer,
    // Both states require the same independently verified historical certificate.
    // Drift is assessed separately by this operation's fresh account/runtime guards.
    continuityVerified: ["continued", "drift"].includes(
      workspaceView(w, chain).continuity,
    ),
  };
}
