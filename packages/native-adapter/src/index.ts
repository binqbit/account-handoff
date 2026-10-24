import { DedotClient, ExtraSignedExtension, WsProvider } from "dedot";
import type {
  IRuntimeTxCall,
  SignerPayloadJSON,
  ISubmittableResult,
} from "dedot/types";
import { AccountId32, $Metadata } from "dedot/codecs";
import { blake2AsHex, hexToU8a, u8aToHex } from "dedot/utils";
import { keccak256 } from "viem";
import { sha256 } from "@account-handoff/contracts";

export type Hex = `0x${string}`;
export type NativeTx = ReturnType<DedotClient["toTx"]>;
export type Weight = { refTime: bigint; proofSize: bigint };
export type Timepoint = { height: number; index: number };
export type NativeAction =
  | { kind: "transfer"; destination: string; amount: bigint }
  | { kind: "create-pure"; index: number }
  | { kind: "map-account" }
  | { kind: "add-proxy" | "remove-proxy"; delegate: string }
  | { kind: "proxy"; beneficiary: string; inner: NativeAction }
  | {
      kind: "revive-call";
      destination: Hex;
      value: bigint;
      weight: Weight;
      storage: bigint;
      data: Hex;
    }
  | {
      kind: "multisig";
      threshold: number;
      others: string[];
      timepoint: Timepoint | undefined;
      inner: NativeAction;
      weight: Weight;
    }
  | {
      kind: "cancel";
      threshold: number;
      others: string[];
      timepoint: Timepoint;
      callHash: Hex;
    }
  | { kind: "vest-other"; beneficiary: string };

export interface NativeFingerprint {
  genesis: Hex;
  specName: string;
  specVersion: number;
  transactionVersion: number;
  metadataVersion: number;
  metadataHash: Hex;
  metadataSha256: string;
  rawMetadata: Hex;
  runtimeCodeHash: Hex;
  signedExtensions: string[];
  runtimeApis: Record<string, number>;
  anchor: { hash: Hex; number: number };
  tokenDecimals: number;
  tokenSymbol: string;
  ss58Prefix: number;
}
export interface NativeAccountState {
  address: Hex;
  free: bigint;
  reserved: bigint;
  frozen: bigint;
  nonce: number;
  proxies: { delegate: Hex; proxyType: string; delay: number }[];
  proxyDeposit: bigint;
  mappedAddress: Hex;
  mappedTo: Hex | null;
  holds: unknown;
  vesting: unknown;
  namedReserves?: unknown;
}
export interface NativeEvent {
  pallet: string;
  name: string;
  data: Record<string, unknown>;
  index: number;
}
export interface NativeReceipt {
  txHash: Hex;
  blockHash: Hex;
  blockNumber: number;
  txIndex: number;
  events: NativeEvent[];
  outerSuccess: boolean;
  nestedSuccess: boolean;
  businessExecuted: boolean;
  failure: string | null;
}
export interface PreparedSigning {
  payload: SignerPayloadJSON;
  rawPayload: Hex;
  callHex: Hex;
  callHash: Hex;
  signer: Hex;
  extra: unknown[];
  encodedExtra: Hex;
  additionalSigned: Hex;
  fingerprint: NativeFingerprint;
  createdAt: number;
}

export function plain(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
}
export function object(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("Expected an object from the native codec");
  return value as Record<string, unknown>;
}
export function hex(value: unknown, bytes?: number): Hex {
  if (
    typeof value !== "string" ||
    !/^0x(?:[0-9a-fA-F]{2})*$/.test(value) ||
    (bytes !== undefined && value.length !== 2 + bytes * 2)
  )
    throw new Error("Invalid hexadecimal bytes");
  return value.toLowerCase() as Hex;
}
export function account(value: string): Hex {
  return hex(new AccountId32(value).raw, 32);
}
export function contractAddress(value: string): Hex {
  const raw = account(value);
  if (raw.endsWith("ee".repeat(12))) return hex(raw.slice(0, 42), 20);
  return hex(`0x${keccak256(raw).slice(-40)}`, 20);
}
export function integer(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isSafeInteger(value))
    return BigInt(value);
  if (typeof value === "string" && /^(0|[1-9]\d*)$/.test(value))
    return BigInt(value);
  throw new Error("Invalid exact native integer");
}
export function number(value: unknown): number {
  const n = integer(value);
  if (n < 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error("Native integer exceeds the safe range");
  return Number(n);
}
export function weight(value: unknown): Weight {
  const w = object(value);
  return { refTime: integer(w["refTime"]), proofSize: integer(w["proofSize"]) };
}
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
  const gas = weight(result["gasRequired"]);
  const storage = object(result["storageDeposit"]);
  if (storage["type"] !== "Charge" && storage["type"] !== "Refund")
    throw new Error("Unrecognized contract storage deposit result");
  return {
    weight: {
      refTime: gas.refTime + gas.refTime / 5n + 1n,
      proofSize: gas.proofSize + gas.proofSize / 5n + 1024n,
    },
    storage: storage["type"] === "Charge" ? integer(storage["value"]) : 0n,
    data: hex(output["data"]),
  };
}
export function safeEndpoint(
  endpoint: string,
  mode: "LOCAL" | "DEMO" | "LIVE",
): string {
  const url = new URL(endpoint);
  if (
    !["ws:", "wss:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error(
      "A native WebSocket endpoint without credentials is required",
    );
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (mode === "LOCAL" && !local)
    throw new Error("LOCAL requires a loopback native endpoint");
  if (mode !== "LOCAL" && url.protocol !== "wss:")
    throw new Error("Remote modes require a secure WebSocket endpoint");
  return url.toString();
}

/** Every branch is an application-approved native call; no free-form pallet route is exported. */
function actionCall(action: NativeAction): IRuntimeTxCall {
  switch (action.kind) {
    case "transfer":
      if (action.amount <= 0n)
        throw new Error("Transfer amount must be positive");
      return {
        pallet: "Balances",
        palletCall: {
          name: "TransferKeepAlive",
          params: { dest: account(action.destination), value: action.amount },
        },
      };
    case "create-pure":
      if (
        !Number.isInteger(action.index) ||
        action.index < 0 ||
        action.index > 65535
      )
        throw new Error("Invalid Pure index");
      return {
        pallet: "Proxy",
        palletCall: {
          name: "CreatePure",
          params: { proxyType: "Any", delay: 0, index: action.index },
        },
      };
    case "map-account":
      return { pallet: "Revive", palletCall: { name: "MapAccount" } };
    case "add-proxy":
    case "remove-proxy":
      return {
        pallet: "Proxy",
        palletCall: {
          name: action.kind === "add-proxy" ? "AddProxy" : "RemoveProxy",
          params: {
            delegate: account(action.delegate),
            proxyType: "Any",
            delay: 0,
          },
        },
      };
    case "proxy":
      return {
        pallet: "Proxy",
        palletCall: {
          name: "Proxy",
          params: {
            real: account(action.beneficiary),
            forceProxyType: "Any",
            call: actionCall(action.inner),
          },
        },
      };
    case "revive-call":
      if (
        action.value < 0n ||
        action.storage < 0n ||
        action.weight.refTime <= 0n ||
        action.weight.proofSize <= 0n
      )
        throw new Error("Invalid contract resource limits");
      return {
        pallet: "Revive",
        palletCall: {
          name: "Call",
          params: {
            dest: hex(action.destination, 20),
            value: action.value,
            weightLimit: action.weight,
            storageDepositLimit: action.storage,
            data: hex(action.data),
          },
        },
      };
    case "multisig": {
      if (action.threshold < 2 || action.threshold > action.others.length + 1)
        throw new Error("Invalid multisig threshold");
      const others = action.others.map(account).sort();
      if (new Set(others).size !== others.length)
        throw new Error("Duplicate multisig members");
      return {
        pallet: "Multisig",
        palletCall: {
          name: "AsMulti",
          params: {
            threshold: action.threshold,
            otherSignatories: others,
            maybeTimepoint: action.timepoint,
            call: actionCall(action.inner),
            maxWeight: action.weight,
          },
        },
      };
    }
    case "cancel":
      return {
        pallet: "Multisig",
        palletCall: {
          name: "CancelAsMulti",
          params: {
            threshold: action.threshold,
            otherSignatories: action.others.map(account).sort(),
            timepoint: action.timepoint,
            callHash: hex(action.callHash, 32),
          },
        },
      };
    case "vest-other":
      return {
        pallet: "Vesting",
        palletCall: {
          name: "VestOther",
          params: { target: account(action.beneficiary) },
        },
      };
  }
}

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

export class NativeConnection {
  private constructor(
    readonly api: DedotClient,
    readonly endpoint: string,
    readonly mode: "LOCAL" | "DEMO" | "LIVE",
  ) {}
  static async connect(
    endpoint: string,
    mode: "LOCAL" | "DEMO" | "LIVE",
  ): Promise<NativeConnection> {
    const url = safeEndpoint(endpoint, mode);
    const api = await DedotClient.legacy({
      provider: new WsProvider({
        endpoint: url,
        retryDelayMs: 1000,
        maxRetryAttempts: 3,
        timeout: 15000,
      }),
      cacheMetadata: false,
      throwOnUnknownApi: true,
    });
    return new NativeConnection(api, url, mode);
  }
  close(): Promise<void> {
    return this.api.disconnect();
  }
  transaction(action: NativeAction): NativeTx {
    const tx = this.api.toTx(actionCall(action));
    // Re-decode exact bytes through the metadata registry before exposing them for review.
    const decoded = this.api.registry
      .findCodec(this.api.registry.metadata.extrinsic.callTypeId)
      .tryDecode(tx.callHex);
    const encoded = this.api.registry
      .findCodec(this.api.registry.metadata.extrinsic.callTypeId)
      .tryEncode(decoded);
    if (u8aToHex(encoded) !== tx.callHex)
      throw new Error("Native call does not round-trip exactly");
    return tx;
  }
  async fingerprint(atHash?: Hex): Promise<NativeFingerprint> {
    const hash = atHash ?? hex(await this.api.rpc.chain_getFinalizedHead(), 32);
    const [header, code, version, properties] = await Promise.all([
      this.api.rpc.chain_getHeader(hash),
      this.api.rpc.state_getStorage("0x3a636f6465", hash),
      this.api.rpc.state_getRuntimeVersion(hash),
      this.api.rpc.system_properties(),
    ]);
    if (!header || !code)
      throw new Error("Finalized runtime identity is unavailable");
    if (
      version.specVersion !== this.api.runtimeVersion.specVersion ||
      version.transactionVersion !== this.api.runtimeVersion.transactionVersion
    )
      throw new Error(
        "Runtime changed at the finalized boundary; refresh its exact metadata before preparing operations",
      );
    if (header.number > 0) {
      const before = await this.api.rpc.state_getRuntimeVersion(
        header.parentHash,
      );
      if (
        before.specVersion !== version.specVersion ||
        before.transactionVersion !== version.transactionVersion
      )
        throw new Error(
          "Runtime upgrade boundary requires an independently qualified historical decoder",
        );
    }
    const metadataObject = atHash
      ? (await this.api.at(hash)).metadata
      : this.api.metadata;
    const metadata = u8aToHex($Metadata.tryEncode(metadataObject));
    const symbol = properties.tokenSymbol;
    const decimals = properties.tokenDecimals;
    return {
      genesis: hex(this.api.genesisHash, 32),
      specName: version.specName,
      specVersion: version.specVersion,
      transactionVersion: version.transactionVersion,
      metadataVersion: metadataObject.versionNumber,
      metadataHash: blake2AsHex(hex(metadata)),
      metadataSha256: await sha256(hexToU8a(hex(metadata))),
      rawMetadata: hex(metadata),
      runtimeCodeHash: blake2AsHex(code),
      signedExtensions:
        this.api.registry.metadata.extrinsic.signedExtensions.map(
          (e) => e.ident,
        ),
      runtimeApis: Object.fromEntries(version.apis),
      anchor: { hash, number: number(header.number) },
      tokenDecimals:
        typeof decimals === "number"
          ? decimals
          : Array.isArray(decimals)
            ? number(decimals[0])
            : 0,
      tokenSymbol:
        typeof symbol === "string"
          ? symbol
          : Array.isArray(symbol)
            ? String(symbol[0])
            : "UNIT",
      ss58Prefix: number(properties.ss58Format ?? 42),
    };
  }
  async readAccount(
    address: string,
    blockHash?: Hex,
  ): Promise<NativeAccountState> {
    const raw = account(address);
    const at = await this.api.at(
      blockHash ?? (await this.api.rpc.chain_getFinalizedHead()),
    );
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
      vesting: plain(vesting),
      namedReserves: plain(namedReserves),
    };
  }
  async proposal(
    controller: string,
    callHash: Hex,
    blockHash?: Hex,
  ): Promise<{
    when: Timepoint;
    deposit: bigint;
    depositor: Hex;
    approvals: Hex[];
  } | null> {
    const at = await this.api.at(
      blockHash ?? (await this.api.rpc.chain_getFinalizedHead()),
    );
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
  async dispatchWeight(tx: NativeTx): Promise<Weight> {
    const at = await this.api.at(await this.api.rpc.chain_getFinalizedHead());
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
  async estimateContract(
    origin: string,
    destination: Hex,
    value: bigint,
    data: Hex,
    blockHash?: Hex,
  ): Promise<{ weight: Weight; storage: bigint; data: Hex }> {
    const at = await this.api.at(
      blockHash ?? (await this.api.rpc.chain_getFinalizedHead()),
    );
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
  async readContract(
    origin: string,
    destination: Hex,
    data: Hex,
    blockHash?: Hex,
  ): Promise<Hex> {
    return (
      await this.estimateContract(origin, destination, 0n, data, blockHash)
    ).data;
  }
  async prepareSigning(tx: NativeTx, signer: string): Promise<PreparedSigning> {
    const fingerprint = await this.fingerprint();
    const raw = account(signer);
    const info = await this.api.query.system.account(raw);
    const extension = new ExtraSignedExtension(this.api, {
      signerAddress: raw,
      payloadOptions: {
        nonce: info.nonce,
        tip: 0n,
        mortality: { type: "Mortal", period: 64 },
      },
    });
    await extension.init();
    const payload = {
      ...extension.toPayload(tx.callHex),
      withSignedTransaction: false,
    };
    return {
      payload,
      rawPayload: hex(extension.toRawPayload(tx.callHex).data),
      callHex: tx.callHex,
      callHash: blake2AsHex(tx.callHex),
      signer: raw,
      extra: extension.data,
      encodedExtra: u8aToHex(extension.$Data.tryEncode(extension.data)),
      additionalSigned: u8aToHex(
        extension.$AdditionalSigned.tryEncode(extension.additionalSigned),
      ),
      fingerprint,
      createdAt: Date.now(),
    };
  }
  attachSignature(prepared: PreparedSigning, signature: Hex): Hex {
    const call = this.api.registry
      .findCodec(this.api.registry.metadata.extrinsic.callTypeId)
      .tryDecode(prepared.callHex) as IRuntimeTxCall;
    const tx = this.api.toTx(call);
    const codec = this.api.registry.findCodec(
      this.api.registry.metadata.extrinsic.signatureTypeId,
    );
    type AttachedSignature = Parameters<NativeTx["attachSignature"]>[0];
    const addressCodec = this.api.registry.findCodec(
      this.api.registry.metadata.extrinsic.addressTypeId,
    );
    const extraCodec = this.api.registry.$Extra();
    const address = addressCodec.tryDecode(
      addressCodec.tryEncode(prepared.signer),
    ) as AttachedSignature["address"];
    const decodedSignature = codec.tryDecode(
      signature,
    ) as AttachedSignature["signature"];
    const extra = extraCodec.tryDecode(
      extraCodec.tryEncode(prepared.extra),
    ) as AttachedSignature["extra"];
    tx.attachSignature({ address, signature: decodedSignature, extra });
    if (tx.callHex !== prepared.callHex)
      throw new Error("Signed transaction call changed");
    const decoded = this.api.registry.$Extrinsic.tryDecode(tx.toHex());
    if (!decoded.signed || decoded.callHex !== prepared.callHex)
      throw new Error("Signed extrinsic verification failed");
    return tx.toHex();
  }
  async send(
    signedBytes: Hex,
    onProgress?: (result: ISubmittableResult) => void,
  ): Promise<NativeReceipt> {
    const result = await this.api
      .sendTx(signedBytes, onProgress ?? (() => {}))
      .untilFinalized();
    if (result.status.type !== "Finalized")
      throw new Error("Finalized result is unavailable");
    return this.receiptAt(result.status.value.blockHash, result.txHash);
  }
  async receiptAt(blockHash: Hex, txHash: Hex): Promise<NativeReceipt> {
    const [raw, head, header] = await Promise.all([
      this.api.provider.send("chain_getBlock", [blockHash]),
      this.api.rpc.chain_getFinalizedHead(),
      this.api.rpc.chain_getHeader(blockHash),
    ]);
    if (!header) throw new Error("Receipt block is unavailable");
    const finalHeader = await this.api.rpc.chain_getHeader(head);
    if (
      !finalHeader ||
      header.number > finalHeader.number ||
      (await this.api.rpc.chain_getBlockHash(header.number)) !== blockHash
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
    const at = await this.api.at(blockHash);
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
  async inspectExtrinsic(
    blockHash: Hex,
    txIndex: number,
  ): Promise<{ bytes: Hex; signer: Hex | null; call: unknown; callHex: Hex }> {
    if (!Number.isSafeInteger(txIndex) || txIndex < 0)
      throw new Error("Invalid transaction index");
    await this.fingerprint(blockHash);
    const block = object(
      object(await this.api.provider.send("chain_getBlock", [blockHash]))[
        "block"
      ],
    );
    if (!Array.isArray(block["extrinsics"]))
      throw new Error("Block extrinsics unavailable");
    const bytes = hex(block["extrinsics"][txIndex]);
    const at = await this.api.at(blockHash);
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
  async findReceipt(
    txHash: Hex,
    lookback = 256,
  ): Promise<NativeReceipt | null> {
    const finalized = await this.api.rpc.chain_getFinalizedHead();
    const header = await this.api.rpc.chain_getHeader(finalized);
    if (!header) throw new Error("Finalized head is unavailable");
    for (
      let height = header.number;
      height >= Math.max(0, header.number - lookback);
      height--
    ) {
      const hash = await this.api.rpc.chain_getBlockHash(height);
      if (!hash) continue;
      const raw = object(
        object(await this.api.provider.send("chain_getBlock", [hash]))["block"],
      );
      if (
        Array.isArray(raw["extrinsics"]) &&
        raw["extrinsics"].some((bytes) => blake2AsHex(hex(bytes)) === txHash)
      )
        return this.receiptAt(hash, txHash);
    }
    return null;
  }
  async currentBlockTime(blockHash?: Hex): Promise<bigint> {
    const at = await this.api.at(
      blockHash ?? (await this.api.rpc.chain_getFinalizedHead()),
    );
    return integer(await at.query.timestamp.now());
  }
}

export function signatureBytes(rawPayload: Hex): Uint8Array {
  const bytes = hexToU8a(rawPayload);
  return bytes.length > 256 ? hexToU8a(blake2AsHex(bytes)) : bytes;
}
