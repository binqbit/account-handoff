import type { NativeConnection } from "./connection";
import type {
  Hex,
  NativeAccountState,
  NativeTx,
  Timepoint,
  Weight,
} from "./types";
import {
  account,
  contractAddress,
  hex,
  integer,
  number,
  object,
  plain,
  weight,
} from "./values";

export function decodeContractEstimate(value: unknown): {
  weight: Weight;
  storage: bigint;
  data: Hex;
} {
  const result = object(value);
  const inner = object(result["result"]);
  if (
    inner["isErr"] === true ||
    (inner["isOk"] !== true && inner["type"] !== "Ok")
  )
    throw new Error(
      `Contract simulation failed: ${JSON.stringify(plain(inner))}`,
    );
  const output = object(inner["value"]);
  const flags = output["flags"];
  const flagBits =
    typeof flags === "object" && flags !== null ? object(flags)["bits"] : flags;
  if ((integer(flagBits) & 1n) !== 0n)
    throw new Error(`Contract reverted: ${String(output["data"])}`);
  const gas = weight(result["weightRequired"]);
  const storage = object(result["storageDeposit"]);
  if (storage["type"] !== "Charge" && storage["type"] !== "Refund")
    throw new Error("Unrecognized contract storage deposit result");
  const maximum = object(result["maxStorageDeposit"]);
  if (maximum["type"] !== "Charge")
    throw new Error("Unrecognized maximum contract storage deposit result");
  const peakCharge = integer(maximum["value"]);
  if (storage["type"] === "Charge" && peakCharge < integer(storage["value"]))
    throw new Error("Maximum storage deposit is below its final charge");
  return {
    weight: {
      refTime: gas.refTime + gas.refTime / 5n + 1n,
      proofSize: gas.proofSize + gas.proofSize / 5n + 1024n,
    },
    storage: peakCharge,
    data: hex(output["data"]),
  };
}

export async function readAccount(
  connection: NativeConnection,
  address: string,
  blockHash?: Hex,
): Promise<NativeAccountState> {
  const raw = account(address);
  const hash =
    blockHash ?? hex(await connection.api.rpc.chain_getFinalizedHead(), 32);
  await connection.assertRuntimeAt(hash);
  const at = await connection.api.at(hash);
  const [info, proxies, mapping, holds, vesting, namedReserves] =
    await Promise.all([
      at.query.system.account(raw),
      at.query.proxy.proxies(raw),
      at.query.revive.originalAccount(contractAddress(raw)),
      at.query.balances.holds(raw),
      at.query.vesting.vesting(raw),
      at.query.balances.reserves(raw),
    ]);
  return {
    address: raw,
    free: info.data.free,
    reserved: info.data.reserved,
    frozen: info.data.frozen,
    nonce: info.nonce,
    proxies: proxies[0].map((p) => ({
      delegate: account(p.delegate.raw),
      proxyType: String(p.proxyType),
      delay: p.delay,
    })),
    proxyDeposit: proxies[1],
    mappedAddress: contractAddress(raw),
    mappedTo: mapping ? account(mapping.raw) : null,
    holds: plain(holds),
    vesting: plain(vesting ?? []),
    namedReserves: plain(namedReserves),
  };
}

export async function proposal(
  connection: NativeConnection,
  controller: string,
  callHash: Hex,
  blockHash?: Hex,
): Promise<{
  when: Timepoint;
  deposit: bigint;
  depositor: Hex;
  approvals: Hex[];
} | null> {
  const hash =
    blockHash ?? hex(await connection.api.rpc.chain_getFinalizedHead(), 32);
  await connection.assertRuntimeAt(hash);
  const at = await connection.api.at(hash);
  const proposal = await at.query.multisig.multisigs([
    account(controller),
    callHash,
  ]);
  return proposal
    ? {
        when: proposal.when,
        deposit: proposal.deposit,
        depositor: account(proposal.depositor.raw),
        approvals: proposal.approvals.map((a) => account(a.raw)),
      }
    : null;
}

export async function dispatchWeight(
  connection: NativeConnection,
  tx: NativeTx,
): Promise<Weight> {
  const hash = hex(await connection.api.rpc.chain_getFinalizedHead(), 32);
  await connection.assertRuntimeAt(hash);
  const at = await connection.api.at(hash);
  const query = at.call.transactionPaymentCallApi["queryCallInfo"];
  if (!query)
    throw new Error("TransactionPaymentCallApi.queryCallInfo is unavailable");
  // Explicit versioned overrides use RawBytes; metadata-defined APIs encode RuntimeCall.
  const input = query.meta.params[0]?.codec ? tx.callHex : tx.call;
  const boundQuery = query as unknown as (
    call: unknown,
    length: number,
  ) => Promise<unknown>;
  const info = object(await boundQuery(input, tx.callLength));
  return weight(info["weight"]);
}

export async function estimateContract(
  connection: NativeConnection,
  origin: string,
  destination: Hex,
  value: bigint,
  data: Hex,
  blockHash?: Hex,
): Promise<{ weight: Weight; storage: bigint; data: Hex }> {
  const hash =
    blockHash ?? hex(await connection.api.rpc.chain_getFinalizedHead(), 32);
  await connection.assertRuntimeAt(hash);
  const at = await connection.api.at(hash);
  const result = await at.call.reviveApi.call(
    account(origin),
    destination,
    value,
    undefined,
    undefined,
    data,
  );
  return decodeContractEstimate(result);
}

export async function readContract(
  connection: NativeConnection,
  origin: string,
  destination: Hex,
  data: Hex,
  blockHash?: Hex,
): Promise<Hex> {
  return (
    await connection.estimateContract(origin, destination, 0n, data, blockHash)
  ).data;
}

export async function currentBlockTime(
  connection: NativeConnection,
  blockHash?: Hex,
): Promise<bigint> {
  const hash =
    blockHash ?? hex(await connection.api.rpc.chain_getFinalizedHead(), 32);
  await connection.assertRuntimeAt(hash);
  const at = await connection.api.at(hash);
  return integer(await at.query.timestamp.now());
}
