import type { ISubmittableResult } from "dedot/types";
import { blake2AsHex } from "dedot/utils";
import type { NativeConnection } from "./connection";
import type {
  Hex,
  NativeEvent,
  NativeMetadataBinding,
  NativeReceipt,
} from "./types";
import { account, hex, object, plain } from "./values";

function eventData(value: unknown): Record<string, unknown> {
  const p = plain(value);
  return typeof p === "object" && p !== null && !Array.isArray(p)
    ? (p as Record<string, unknown>)
    : { value: p };
}
export function normalizeEvents(result: ISubmittableResult): NativeEvent[] {
  return result.events.map((record, index) => ({
    pallet: record.event.pallet,
    name:
      typeof record.event.palletEvent === "string"
        ? record.event.palletEvent
        : record.event.palletEvent.name,
    data: eventData(
      typeof record.event.palletEvent === "string"
        ? {}
        : record.event.palletEvent.data,
    ),
    index,
  }));
}
export function classifyNativeReceipt(
  result: ISubmittableResult,
): NativeReceipt {
  if (result.status.type !== "Finalized")
    throw new Error("A finalized result is required");
  const events = normalizeEvents(result);
  const fail = events.find(
    (e) => e.pallet === "System" && e.name === "ExtrinsicFailed",
  );
  const nested = events.filter(
    (e) =>
      (e.pallet === "Proxy" && e.name === "ProxyExecuted") ||
      (e.pallet === "Multisig" && e.name === "MultisigExecuted"),
  );
  const nestedFailure = nested.find((e) => {
    const value = e.data["result"];
    return (
      typeof value !== "object" ||
      value === null ||
      object(value)["isErr"] === true ||
      object(value)["type"] === "Err"
    );
  });
  const outerSuccess =
    !fail &&
    events.some((e) => e.pallet === "System" && e.name === "ExtrinsicSuccess");
  return {
    txHash: hex(result.txHash, 32),
    blockHash: hex(result.status.value.blockHash, 32),
    blockNumber: result.status.value.blockNumber,
    txIndex: result.status.value.txIndex,
    events,
    outerSuccess,
    nestedSuccess: outerSuccess && !nestedFailure,
    businessExecuted:
      outerSuccess &&
      !nestedFailure &&
      !events.some(
        (e) =>
          e.pallet === "Multisig" &&
          (e.name === "NewMultisig" || e.name === "MultisigApproval"),
      ),
    failure: fail
      ? JSON.stringify(fail.data)
      : nestedFailure
        ? JSON.stringify(nestedFailure.data)
        : null,
  };
}

export async function send(
  connection: NativeConnection,
  binding: NativeMetadataBinding | undefined,
  signedBytes: Hex,
  onProgress?: (result: ISubmittableResult) => void,
  observationTimeoutMs = 120_000,
): Promise<NativeReceipt> {
  if (!binding)
    throw new Error("Sending requires an explicit verified metadata binding");
  await connection.fingerprint();
  const pending = connection.api.sendTx(signedBytes, onProgress ?? (() => {}));
  let unsubscribe: (() => Promise<void>) | undefined;
  let unsubscribed = false;
  let expired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const stopWatching = async () => {
    if (unsubscribe && !unsubscribed) {
      unsubscribed = true;
      await unsubscribe().catch(() => {});
    }
  };
  try {
    const subscribed = pending.then(async (stop) => {
      unsubscribe = stop;
      if (expired) await stopWatching();
    });
    // Observe both promises: an RPC rejection rejects the subscription promise,
    // while a finalized/rejected extrinsic settles the finality promise.
    const completion = Promise.all([subscribed, pending.untilFinalized()]);
    const [, result] = await Promise.race([
      completion,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          expired = true;
          reject(
            new Error(
              "Transaction observation timed out. Reconcile the saved transaction; do not submit it again.",
            ),
          );
        }, observationTimeoutMs);
      }),
    ]);
    if (result.status.type !== "Finalized")
      throw new Error("Finalized result is unavailable");
    return await connection.receiptAt(
      result.status.value.blockHash,
      result.txHash,
    );
  } finally {
    if (timer) clearTimeout(timer);
    await stopWatching();
  }
}

export async function receiptAt(
  connection: NativeConnection,
  blockHash: Hex,
  txHash: Hex,
): Promise<NativeReceipt> {
  await connection.fingerprint(blockHash);
  const [raw, head, header] = await Promise.all([
    connection.api.provider.send("chain_getBlock", [blockHash]),
    connection.api.rpc.chain_getFinalizedHead(),
    connection.api.rpc.chain_getHeader(blockHash),
  ]);
  if (!header) throw new Error("Receipt block is unavailable");
  const finalHeader = await connection.api.rpc.chain_getHeader(head);
  if (
    !finalHeader ||
    header.number > finalHeader.number ||
    (await connection.api.rpc.chain_getBlockHash(header.number)) !== blockHash
  )
    throw new Error("Receipt block is not on the finalized chain");
  const body = object(object(raw)["block"]);
  if (!Array.isArray(body["extrinsics"]))
    throw new Error("Receipt block body is unavailable");
  const txIndex = body["extrinsics"].findIndex(
    (bytes) => blake2AsHex(hex(bytes)) === txHash,
  );
  if (txIndex < 0)
    throw new Error("Exact extrinsic was not found in the receipt block");
  const at = await connection.api.at(blockHash);
  const all = await at.query.system.events();
  const events = all.filter(
    (e) => e.phase.type === "ApplyExtrinsic" && e.phase.value === txIndex,
  );
  const receipt = classifyNativeReceipt({
    txHash,
    txIndex,
    events,
    status: {
      type: "Finalized",
      value: { blockHash, blockNumber: header.number, txIndex },
    },
  });
  receipt.events.forEach((event, index) => {
    event.index = all.indexOf(events[index]!);
  });
  return receipt;
}

export async function inspectExtrinsic(
  connection: NativeConnection,
  blockHash: Hex,
  txIndex: number,
): Promise<{ bytes: Hex; signer: Hex | null; call: unknown; callHex: Hex }> {
  if (!Number.isSafeInteger(txIndex) || txIndex < 0)
    throw new Error("Invalid transaction index");
  await connection.fingerprint(blockHash);
  const block = object(
    object(await connection.api.provider.send("chain_getBlock", [blockHash]))[
      "block"
    ],
  );
  if (!Array.isArray(block["extrinsics"]))
    throw new Error("Block extrinsics unavailable");
  const bytes = hex(block["extrinsics"][txIndex]);
  const at = await connection.api.at(blockHash);
  const tx = at.registry.$Extrinsic.tryDecode(bytes);
  let signer: Hex | null = null;
  if (tx.signature) {
    const address = plain(tx.signature.address);
    if (typeof address === "string") signer = account(address);
    else {
      const value = object(address);
      if (value["type"] === "Id" && typeof value["value"] === "string")
        signer = account(value["value"]);
    }
  }
  return { bytes, signer, call: plain(tx.call), callHex: tx.callHex };
}

export async function findReceipt(
  connection: NativeConnection,
  txHash: Hex,
  lookback = 256,
): Promise<NativeReceipt | null> {
  const finalized = await connection.api.rpc.chain_getFinalizedHead();
  const header = await connection.api.rpc.chain_getHeader(finalized);
  if (!header) throw new Error("Finalized head is unavailable");
  for (
    let height = header.number;
    height >= Math.max(0, header.number - lookback);
    height--
  ) {
    const hash = await connection.api.rpc.chain_getBlockHash(height);
    if (!hash) continue;
    const raw = object(
      object(await connection.api.provider.send("chain_getBlock", [hash]))[
        "block"
      ],
    );
    if (
      Array.isArray(raw["extrinsics"]) &&
      raw["extrinsics"].some((bytes) => blake2AsHex(hex(bytes)) === txHash)
    )
      return connection.receiptAt(hash, txHash);
  }
  return null;
}
