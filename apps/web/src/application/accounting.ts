import { canonicalJson, sha256 } from "@account-handoff/contracts";
import type {
  EvidenceRef,
  AccountingLedger,
  ReserveReason,
} from "@account-handoff/contracts";
import {
  NativeConnection,
  object,
  type NativeFingerprint,
} from "@account-handoff/native-adapter";
import type { ChainView, WorkspaceRecord } from "./models";
import { buildReadAnchor } from "./record-builders";
import { json } from "./values";
function liabilities(value: unknown, evidence: EvidenceRef[]): ReserveReason[] {
  if (!Array.isArray(value))
    throw new Error("Complete reserve accounting is unavailable");
  return value.map((item) => {
    const v = object(item);
    if (v["amount"] === undefined) throw new Error("Reserve amount is unknown");
    return {
      reason: canonicalJson(v["id"] ?? v["reason"] ?? "unknown"),
      amountNative: String(v["amount"]),
      evidence,
    };
  });
}

export async function accountingLedger(
  w: WorkspaceRecord | null,
  chain: ChainView | null,
  connection: NativeConnection | null,
  f: NativeFingerprint,
  accounts: ChainView["accounts"],
): Promise<AccountingLedger | undefined> {
  if (!w?.pure || !w.baseline || !chain || !connection) return undefined;
  const pure = accounts[w.pure];
  const creator = accounts[w.creator?.account ?? w.M0.account];
  if (!pure || !creator) return undefined;
  const evidence: EvidenceRef = {
    kind: "native_chain",
    locator: `${f.anchor.hash}:accounting:${w.pure}`,
    sourceId: f.metadataSha256,
    contentSha256: await sha256(
      canonicalJson(
        json({
          account: w.pure,
          holds: pure.holds,
          namedReserves: pure.namedReserves ?? [],
          reserved: String(pure.reserved),
          proxies: pure.proxies,
          proxyDeposit: String(pure.proxyDeposit),
        }),
      ),
    ),
  };
  const holds = liabilities(pure.holds, [evidence]);
  const reserves = liabilities(pure.namedReserves ?? [], [evidence]);
  const increment = pure.proxyDeposit - w.baseline.account.proxyDeposit;
  const adjustmentProvenance: EvidenceRef[] =
    increment > 0n
      ? [
          evidence,
          {
            kind: "native_chain",
            locator: `${w.baseline.blockHash}:proxy-baseline:${w.pure}`,
            sourceId: f.metadataSha256,
            contentSha256: await sha256(
              canonicalJson(
                json({
                  proxyDeposit: String(w.baseline.account.proxyDeposit),
                  proxies: w.baseline.account.proxies,
                }),
              ),
            ),
          },
        ]
      : [];
  const backed =
    holds.reduce((sum, r) => sum + BigInt(r.amountNative), 0n) +
    reserves.reduce((sum, r) => sum + BigInt(r.amountNative), 0n) +
    increment;
  const historical =
    connection.api.consts.proxy.proxyDepositBase +
    connection.api.consts.proxy.proxyDepositFactor;
  const difference = pure.reserved - backed;
  return {
    status:
      difference === 0n && increment >= 0n && creator.reserved >= historical
        ? "reconciled"
        : "conflicted",
    pure: w.pure,
    creator: w.creator?.account ?? w.M0.account,
    anchor: buildReadAnchor(chain.profile, f),
    proxyDepositRecordedNative: String(pure.proxyDeposit),
    creatorHistoricalDepositNative: String(historical),
    creatorCurrentAggregateReservedNative: String(creator.reserved),
    pureProxyIncrementNative: String(increment < 0n ? 0n : increment),
    pureFreeNative: String(pure.free),
    pureReservedNative: String(pure.reserved),
    pureFrozenNative: String(pure.frozen),
    pureReasonHolds: holds,
    pureNamedReserves: reserves,
    pureOtherTracedReservedLiabilitiesNative: "0",
    pureBackedLiabilitiesNative: String(backed < 0n ? 0n : backed),
    unexplainedReservedDeltaNative: String(difference),
    constantSetDigest: await sha256(
      canonicalJson({
        base: String(connection.api.consts.proxy.proxyDepositBase),
        factor: String(connection.api.consts.proxy.proxyDepositFactor),
      }),
    ),
    creationProvenance: w.creationEvidence,
    adjustmentProvenance,
    creatorDepositAutomaticallyRefunded: false,
    totalBalanceOnHoldAddedAgain: false,
  };
}
