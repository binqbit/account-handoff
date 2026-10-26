import { DedotClient, WsProvider } from "dedot";
import type { ISubmittableResult } from "dedot/types";
import { $Metadata } from "dedot/codecs";
import type {
  Hex,
  NativeAction,
  NativeAccountState,
  NativeFingerprint,
  NativeMetadataBinding,
  NativeMetadataCapture,
  NativeReceipt,
  NativeTx,
  PreparedSigning,
  Timepoint,
  Weight,
} from "./types";
import { createTransaction } from "./calls";
import {
  assertRuntimeAt,
  captureMetadata,
  readFingerprint,
  validateMetadataBinding,
} from "./metadata";
import { attachSignature, prepareSigning } from "./signing";
import {
  dispatchWeight,
  estimateContract,
  proposal,
  readAccount,
  readContract,
  currentBlockTime,
} from "./state";
import { findReceipt, inspectExtrinsic, receiptAt, send } from "./receipts";

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

export class NativeConnection {
  private constructor(
    readonly api: DedotClient,
    readonly endpoint: string,
    readonly mode: "LOCAL" | "DEMO" | "LIVE",
    private readonly metadataBinding?: NativeMetadataBinding,
  ) {}
  static async connect(
    endpoint: string,
    mode: "LOCAL" | "DEMO" | "LIVE",
    binding?: NativeMetadataBinding,
  ): Promise<NativeConnection> {
    const url = safeEndpoint(endpoint, mode);
    const pinned = binding ? await validateMetadataBinding(binding) : undefined;
    const provider = new WsProvider({
      endpoint: url,
      retryDelayMs: 1000,
      maxRetryAttempts: 3,
      // Immutable remote metadata/runtime responses can be several megabytes.
      timeout: mode === "LOCAL" ? 15000 : 60000,
    });
    const api = await DedotClient.legacy({
      provider,
      cacheMetadata: false,
      throwOnUnknownApi: true,
      ...(pinned
        ? {
            metadata: {
              [`RAW_META/${pinned.genesis}/${pinned.specVersion}`]:
                pinned.rawMetadata,
            },
          }
        : {}),
    }).catch(async (error) => {
      // The SDK factory may reject before returning an API to disconnect.
      await provider.disconnect().catch(() => {});
      throw error;
    });
    const connection = new NativeConnection(api, url, mode, pinned);
    if (pinned) {
      try {
        const source = await connection.captureMetadata(
          pinned.sourceAnchor.blockHash,
          $Metadata.tryDecode(pinned.rawMetadata).versionNumber as 14 | 15 | 16,
        );
        if (
          source.genesis !== pinned.genesis ||
          source.blockNumber !== pinned.sourceAnchor.blockNumber ||
          source.specVersion !== pinned.specVersion ||
          source.runtimeCodeHash !== pinned.runtimeCodeHash ||
          source.metadataSha256 !== pinned.metadataSha256 ||
          source.rawMetadata !== pinned.rawMetadata
        )
          throw new Error(
            "Pinned metadata does not match its immutable native source",
          );
        await connection.fingerprint();
      } catch (error) {
        await api.disconnect().catch(() => {});
        throw error;
      }
    }
    return connection;
  }
  close(): Promise<void> {
    return this.api.disconnect();
  }
  async assertRuntimeAt(blockHash: Hex): Promise<void> {
    return assertRuntimeAt(this.api, this.metadataBinding, blockHash);
  }
  transaction(action: NativeAction): NativeTx {
    return createTransaction(this.api, action);
  }
  async fingerprint(atHash?: Hex): Promise<NativeFingerprint> {
    return readFingerprint(this, this.metadataBinding, atHash);
  }
  async captureMetadata(
    blockHash: Hex,
    metadataVersion: 14 | 15 | 16 = 16,
  ): Promise<NativeMetadataCapture> {
    return captureMetadata(this.api, blockHash, metadataVersion);
  }
  async readAccount(
    address: string,
    blockHash?: Hex,
  ): Promise<NativeAccountState> {
    return readAccount(this, address, blockHash);
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
    return proposal(this, controller, callHash, blockHash);
  }
  async dispatchWeight(tx: NativeTx): Promise<Weight> {
    return dispatchWeight(this, tx);
  }
  async estimateContract(
    origin: string,
    destination: Hex,
    value: bigint,
    data: Hex,
    blockHash?: Hex,
  ): Promise<{ weight: Weight; storage: bigint; data: Hex }> {
    return estimateContract(this, origin, destination, value, data, blockHash);
  }
  async readContract(
    origin: string,
    destination: Hex,
    data: Hex,
    blockHash?: Hex,
  ): Promise<Hex> {
    return readContract(this, origin, destination, data, blockHash);
  }
  async prepareSigning(tx: NativeTx, signer: string): Promise<PreparedSigning> {
    return prepareSigning(this, this.metadataBinding, tx, signer);
  }
  attachSignature(prepared: PreparedSigning, signature: Hex): Hex {
    return attachSignature(this.api, prepared, signature);
  }
  async send(
    signedBytes: Hex,
    onProgress?: (result: ISubmittableResult) => void,
  ): Promise<NativeReceipt> {
    return send(this, this.metadataBinding, signedBytes, onProgress);
  }
  async receiptAt(blockHash: Hex, txHash: Hex): Promise<NativeReceipt> {
    return receiptAt(this, blockHash, txHash);
  }
  async inspectExtrinsic(
    blockHash: Hex,
    txIndex: number,
  ): Promise<{ bytes: Hex; signer: Hex | null; call: unknown; callHex: Hex }> {
    return inspectExtrinsic(this, blockHash, txIndex);
  }
  async findReceipt(
    txHash: Hex,
    lookback = 256,
  ): Promise<NativeReceipt | null> {
    return findReceipt(this, txHash, lookback);
  }
  async currentBlockTime(blockHash?: Hex): Promise<bigint> {
    return currentBlockTime(this, blockHash);
  }
}
