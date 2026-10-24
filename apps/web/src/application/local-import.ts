import { createKeyMulti } from "@polkadot/util-crypto";
import { blake2AsHex, u8aToHex } from "dedot/utils";
import { keccak256 } from "viem";
import {
  canonicalJson,
  sha256,
  type EvidenceRef,
} from "@account-handoff/contracts";
import { makeController } from "@account-handoff/domain";
import {
  account,
  contractAddress,
  hex,
  object,
  plain,
  type Hex,
  type NativeConnection,
  type NativeFingerprint,
  type NativeReceipt,
} from "@account-handoff/native-adapter";
import {
  readGrant,
  scanGrantHistory,
  ZERO_ADDRESS,
  type GrantHistoryEntry,
} from "@account-handoff/grant-adapter";
import type { WorkspaceInput } from "../ui-contract";
import type { LocalDescriptor } from "./models";

export interface VerifiedLocalWorkspaceImport {
  input: WorkspaceInput;
  creationEvidence: EvidenceRef[];
  creationBlock: number;
  grantCreationEvidence: EvidenceRef[];
  grantCreationBlock: number;
}
function requireValue(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function exactFields(
  value: Record<string, unknown>,
  allowed: readonly string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  requireValue(
    unknown.length === 0,
    `${label} contains unsupported fields: ${unknown.join(", ")}`,
  );
}
function text(value: unknown, label: string): string {
  requireValue(
    typeof value === "string" && value.length > 0,
    `${label} is required`,
  );
  return value;
}
function integer(value: unknown, label: string): number {
  requireValue(
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0,
    `${label} must be a nonnegative safe integer`,
  );
  return value;
}
function accounts(value: unknown, count: number, label: string): string[] {
  requireValue(
    Array.isArray(value) && value.length === count,
    `${label} requires exactly ${count} accounts`,
  );
  const result = value.map((item) => account(text(item, label)));
  requireValue(
    new Set(result).size === count,
    `${label} contains duplicate identities`,
  );
  return result;
}
function sameNative(left: unknown, right: string): boolean {
  if (typeof left !== "string") return false;
  try {
    return account(left) === account(right);
  } catch {
    return false;
  }
}
function equalHex(left: unknown, right: unknown): boolean {
  return (
    typeof left === "string" &&
    typeof right === "string" &&
    left.toLowerCase() === right.toLowerCase()
  );
}
function fingerprintMatches(
  fingerprint: NativeFingerprint,
  expected: LocalDescriptor,
): void {
  requireValue(
    fingerprint.genesis === (expected.genesisHash ?? expected.genesis),
    "LOCAL genesis differs from the qualified run",
  );
  requireValue(
    fingerprint.runtimeCodeHash === expected.runtimeCodeHash &&
      fingerprint.metadataSha256 === expected.metadataSha256,
    "Runtime/codecs differ from the qualified LOCAL run",
  );
  requireValue(
    fingerprint.specName === expected.runtime.specName &&
      fingerprint.specVersion === expected.runtime.specVersion,
    "Runtime version differs from the qualified LOCAL run",
  );
}
async function verifyContractAt(
  connection: NativeConnection,
  address: Hex,
  expectedHash: Hex,
  blockHash: Hex,
): Promise<void> {
  await connection.fingerprint(blockHash);
  const at = await connection.api.at(blockHash);
  const readInfo = at.query.revive.accountInfoOf;
  requireValue(
    typeof readInfo === "function",
    "Revive AccountInfoOf is unavailable in the qualified metadata",
  );
  const info = object(plain(await readInfo(address)));
  const variant = object(info["accountType"]);
  requireValue(
    variant["type"] === "Contract",
    "Bound address is not a Revive contract",
  );
  const contract = object(variant["value"]);
  const codeHash = hex(text(contract["codeHash"], "Contract code hash"), 32);
  const readCode = at.query.revive.pristineCode;
  requireValue(
    typeof readCode === "function",
    "Revive PristineCode is unavailable in the qualified metadata",
  );
  const stored: unknown = await readCode(codeHash);
  const code =
    stored instanceof Uint8Array
      ? u8aToHex(stored)
      : hex(text(stored, "Contract code"));
  requireValue(
    code !== "0x" && keccak256(code) === expectedHash,
    "Contract runtime bytecode differs from the qualified unchanged Vestry artifact",
  );
}
function verifyPureCall(
  call: unknown,
  signer: string | null,
  oldMembers: string[],
): void {
  requireValue(
    !!signer && oldMembers.includes(account(signer)),
    "Pure creation was not signed by a known M0 member",
  );
  const top = object(call);
  const multisig = object(top["palletCall"]);
  const params = object(multisig["params"]);
  requireValue(
    top["pallet"] === "Multisig" &&
      multisig["name"] === "AsMulti" &&
      params["threshold"] === 2,
    "Pure creation did not use the expected native multisig route",
  );
  const others = accounts(
    params["otherSignatories"],
    2,
    "Other M0 signatories",
  );
  requireValue(
    JSON.stringify([...others, account(signer!)].sort()) ===
      JSON.stringify([...oldMembers].sort()),
    "Pure creation multisig members differ from M0",
  );
  const inner = object(params["call"]);
  const proxy = object(inner["palletCall"]);
  const pureParams = object(proxy["params"]);
  requireValue(
    inner["pallet"] === "Proxy" &&
      proxy["name"] === "CreatePure" &&
      pureParams["proxyType"] === "Any" &&
      pureParams["delay"] === 0,
    "Pure creation has an unsupported nested call",
  );
}
function verifyGrantCreation(
  entry: GrantHistoryEntry,
  funder: string,
  grantee: Hex,
  reviewers: Hex[],
  contract: Hex,
): void {
  requireValue(
    entry.txIndex !== null && !!entry.rawExtrinsic && entry.signer === funder,
    "Grant creation lacks the direct funder execution route",
  );
  const call = object(entry.decodedCall);
  const method = object(call["palletCall"]);
  const parameters = object(method["params"]);
  requireValue(
    call["pallet"] === "Revive" &&
      method["name"] === "Call" &&
      equalHex(parameters["dest"], contract),
    "Grant creation was not a direct call to the bound contract",
  );
  requireValue(
    equalHex(entry.args["grantee"], grantee) &&
      equalHex(entry.args["funder"], contractAddress(funder)),
    "GrantCreated has a different funder or beneficiary",
  );
  requireValue(
    equalHex(entry.args["token"], ZERO_ADDRESS) &&
      Number(entry.args["threshold"]) === 2,
    "GrantCreated uses unsupported currency or reviewer threshold",
  );
  requireValue(
    Array.isArray(entry.args["reviewers"]),
    "GrantCreated reviewer list is unavailable",
  );
  const actualReviewers = entry.args["reviewers"]
    .map((value) => hex(text(value, "Grant reviewer"), 20))
    .sort();
  requireValue(
    JSON.stringify(actualReviewers) === JSON.stringify([...reviewers].sort()),
    "GrantCreated reviewers differ from the imported roles",
  );
}
async function evidence(receipt: NativeReceipt): Promise<EvidenceRef> {
  return {
    kind: "native_chain",
    locator: `${receipt.blockHash}/${receipt.txIndex}`,
    sourceId: receipt.txHash,
    contentSha256: await sha256(canonicalJson(plain(receipt))),
  };
}

/** Validate only. Imported claims never mutate local records or install an endpoint. */
export async function validateLocalWorkspaceImport(
  raw: unknown,
  connection: NativeConnection,
  expectedRun: LocalDescriptor,
): Promise<VerifiedLocalWorkspaceImport> {
  const packet = object(raw);
  exactFields(
    packet,
    [
      "format",
      "version",
      "mode",
      "runId",
      "generation",
      "genesisHash",
      "endpoint",
      "input",
      "creation",
    ],
    "LOCAL package",
  );
  requireValue(
    connection.mode === "LOCAL" &&
      expectedRun.mode === "LOCAL" &&
      expectedRun.qualified === true,
    "A qualified LOCAL run is required",
  );
  requireValue(
    packet["format"] === "account-handoff-local-workspace" &&
      packet["version"] === 1 &&
      packet["mode"] === "LOCAL",
    "Unsupported LOCAL workspace format",
  );
  requireValue(
    packet["runId"] === expectedRun.runId &&
      packet["generation"] === expectedRun.generation,
    "Imported workspace belongs to another LOCAL run or generation",
  );
  requireValue(
    packet["genesisHash"] === (expectedRun.genesisHash ?? expectedRun.genesis),
    "Imported workspace belongs to another genesis",
  );
  requireValue(
    new URL(connection.endpoint).toString() ===
      new URL(expectedRun.nativeRpc).toString(),
    "Connection differs from the qualified LOCAL endpoint",
  );
  requireValue(
    expectedRun.status === "running" && !!expectedRun.contract,
    "The LOCAL run is retired or has no bound contract",
  );
  const source = object(packet["input"]);
  exactFields(
    source,
    [
      "name",
      "oldMembers",
      "newMembers",
      "threshold",
      "funder",
      "reviewers",
      "beneficiary",
      "contract",
      "grantId",
    ],
    "LOCAL workspace input",
  );
  const name = text(source["name"], "Workspace name").trim();
  requireValue(
    name.length > 0 && name.length <= 80,
    "Workspace name must contain 1–80 characters",
  );
  const oldMembers = accounts(source["oldMembers"], 3, "M0");
  const newMembers = accounts(source["newMembers"], 3, "M1");
  requireValue(
    source["threshold"] === 2 &&
      oldMembers.filter((member) => newMembers.includes(member)).length === 2,
    "Expected two 2-of-3 groups with exactly one replaced participant",
  );
  const reviewers = accounts(source["reviewers"], 2, "Reviewers");
  const funder = account(text(source["funder"], "Funder"));
  const pure = account(text(source["beneficiary"], "Pure beneficiary"));
  requireValue(
    !pure.endsWith("ee".repeat(12)) &&
      ![funder, ...reviewers].some((who) => who.endsWith("ee".repeat(12))),
    "The first profile requires normal persisted account mappings",
  );
  const contract = hex(text(source["contract"], "Contract address"), 20);
  const grantId = text(source["grantId"], "Grant ID");
  requireValue(
    /^(0|[1-9][0-9]*)$/.test(grantId),
    "Grant ID must be a canonical unsigned decimal string",
  );
  requireValue(
    contract === hex(expectedRun.contract.address, 20),
    "Imported contract differs from the qualified runtime binding",
  );
  const expectedCode = hex(expectedRun.contract.runtimeCodeHash, 32);
  const input: WorkspaceInput = {
    name,
    oldMembers,
    newMembers,
    threshold: 2,
    funder,
    reviewers,
    beneficiary: pure,
    contract,
    grantId,
  };
  const M0 = makeController(oldMembers, 2, "M0", {
    deriveMultisig: (members, threshold) =>
      u8aToHex(createKeyMulti([...members], threshold)),
  });
  const creation = object(packet["creation"]);
  exactFields(
    creation,
    ["transactionHash", "blockHash", "blockNumber", "transactionIndex"],
    "Pure creation locator",
  );
  const blockHash = hex(text(creation["blockHash"], "Pure creation block"), 32);
  const txHash = hex(
    text(creation["transactionHash"], "Pure creation transaction"),
    32,
  );
  const blockNumber = integer(
    creation["blockNumber"],
    "Pure creation block number",
  );
  const txIndex = integer(
    creation["transactionIndex"],
    "Pure creation transaction index",
  );
  const current = await connection.fingerprint();
  fingerprintMatches(current, expectedRun);
  const creationFingerprint = await connection.fingerprint(blockHash);
  fingerprintMatches(creationFingerprint, expectedRun);
  requireValue(
    creationFingerprint.anchor.number === blockNumber &&
      current.anchor.number >= blockNumber,
    "Pure creation anchor differs from the imported locator",
  );
  const receipt = await connection.receiptAt(blockHash, txHash);
  requireValue(
    receipt.blockNumber === blockNumber &&
      receipt.txIndex === txIndex &&
      receipt.outerSuccess &&
      receipt.nestedSuccess &&
      receipt.businessExecuted,
    "Pure creation receipt is incomplete or failed",
  );
  const created = receipt.events.filter(
    (item) => item.pallet === "Proxy" && item.name === "PureCreated",
  );
  requireValue(
    created.length === 1,
    "Expected one attributable PureCreated event",
  );
  requireValue(
    sameNative(created[0]!.data["pure"], pure) &&
      sameNative(created[0]!.data["who"], M0.account) &&
      created[0]!.data["proxyType"] === "Any",
    "PureCreated has a different beneficiary, creator or proxy type",
  );
  requireValue(
    receipt.events.some(
      (item) =>
        item.pallet === "Multisig" &&
        item.name === "MultisigExecuted" &&
        sameNative(item.data["multisig"], M0.account),
    ),
    "The M0 execution event is missing from Pure creation",
  );
  const creationTx = await connection.inspectExtrinsic(blockHash, txIndex);
  verifyPureCall(creationTx.call, creationTx.signer, oldMembers);
  const initial = await connection.readAccount(pure, blockHash);
  requireValue(
    initial.proxies.length === 1 &&
      initial.proxies[0]!.delegate === M0.account &&
      initial.proxies[0]!.proxyType === "Any" &&
      initial.proxies[0]!.delay === 0,
    "Pure initial authority was not exactly M0 / Any / 0",
  );
  await verifyContractAt(
    connection,
    contract,
    expectedCode,
    current.anchor.hash,
  );
  const history = await scanGrantHistory(connection, {
    contract,
    grantId,
    fromBlock: blockNumber,
    toBlock: current.anchor.number,
  });
  requireValue(
    history.complete,
    `Grant history is incomplete: ${history.blockers.join("; ")}`,
  );
  const creations = history.entries.filter(
    (entry) => entry.eventName === "GrantCreated",
  );
  requireValue(
    creations.length === 1,
    "Expected one attributable GrantCreated event",
  );
  const grantCreation = creations[0]!;
  requireValue(
    grantCreation.blockNumber > blockNumber ||
      (grantCreation.blockNumber === blockNumber &&
        grantCreation.txIndex !== null &&
        grantCreation.txIndex > txIndex),
    "Grant was not created after the dedicated Pure beneficiary",
  );
  fingerprintMatches(
    await connection.fingerprint(grantCreation.blockHash),
    expectedRun,
  );
  verifyGrantCreation(
    grantCreation,
    funder,
    contractAddress(pure),
    reviewers.map(contractAddress),
    contract,
  );
  await verifyContractAt(
    connection,
    contract,
    expectedCode,
    grantCreation.blockHash,
  );
  const grant = await readGrant(
    connection,
    funder,
    contract,
    BigInt(grantId),
    current.anchor.hash,
  );
  requireValue(
    grant.grantee.toLowerCase() === contractAddress(pure) &&
      grant.funder.toLowerCase() === contractAddress(funder) &&
      grant.token === ZERO_ADDRESS &&
      grant.threshold === 2 &&
      grant.milestoneCount === 2,
    "Current grant identity differs from its original creation",
  );
  const grantReceipt = await connection.receiptAt(
    grantCreation.blockHash,
    blake2AsHex(hex(grantCreation.rawExtrinsic!)),
  );
  requireValue(
    grantReceipt.txIndex === grantCreation.txIndex &&
      grantReceipt.outerSuccess &&
      grantReceipt.nestedSuccess &&
      grantReceipt.businessExecuted,
    "Grant creation transaction did not complete successfully",
  );
  return {
    input,
    creationEvidence: [await evidence(receipt)],
    creationBlock: blockNumber,
    grantCreationEvidence: [
      {
        kind: "native_chain",
        locator: `${grantCreation.blockHash}/${grantCreation.txIndex}/${grantCreation.eventIndex}`,
        sourceId: null,
        contentSha256: await sha256(canonicalJson(plain(grantCreation))),
      },
    ],
    grantCreationBlock: grantCreation.blockNumber,
  };
}
