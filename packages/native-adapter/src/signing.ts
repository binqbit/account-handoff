import { ExtraSignedExtension } from "dedot";
import type { DedotClient } from "dedot";
import type { IRuntimeTxCall, SignerPayloadJSON } from "dedot/types";
import { blake2AsHex, hexToU8a, u8aToHex } from "dedot/utils";
import type { NativeConnection } from "./connection";
import type {
  Hex,
  NativeTx,
  NativeMetadataBinding,
  PreparedSigning,
} from "./types";
import { account, hex } from "./values";

/** Match the JSON object actually transported to injected wallets; retain numeric JSON fields. */
export function normalizeSignerPayload(
  payload: SignerPayloadJSON,
): SignerPayloadJSON {
  return JSON.parse(JSON.stringify(payload)) as SignerPayloadJSON;
}

export async function prepareSigning(
  connection: NativeConnection,
  binding: NativeMetadataBinding | undefined,
  tx: NativeTx,
  signer: string,
): Promise<PreparedSigning> {
  if (!binding)
    throw new Error("Signing requires an explicit verified metadata binding");
  const fingerprint = await connection.fingerprint();
  const raw = account(signer);
  const info = await connection.api.query.system.account(raw);
  const extension = new ExtraSignedExtension(connection.api, {
    signerAddress: raw,
    payloadOptions: {
      nonce: info.nonce,
      tip: 0n,
      mortality: { type: "Mortal", period: 64 },
    },
  });
  await extension.init();
  const payload = normalizeSignerPayload({
    ...extension.toPayload(tx.callHex),
    withSignedTransaction: false,
  });
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

export function attachSignature(
  api: DedotClient,
  prepared: PreparedSigning,
  signature: Hex,
): Hex {
  const call = api.registry
    .findCodec(api.registry.metadata.extrinsic.callTypeId)
    .tryDecode(prepared.callHex) as IRuntimeTxCall;
  const tx = api.toTx(call);
  const codec = api.registry.findCodec(
    api.registry.metadata.extrinsic.signatureTypeId,
  );
  type AttachedSignature = Parameters<NativeTx["attachSignature"]>[0];
  const addressCodec = api.registry.findCodec(
    api.registry.metadata.extrinsic.addressTypeId,
  );
  const extraCodec = api.registry.$Extra();
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
  const decoded = api.registry.$Extrinsic.tryDecode(tx.toHex());
  if (!decoded.signed || decoded.callHex !== prepared.callHex)
    throw new Error("Signed extrinsic verification failed");
  return tx.toHex();
}

export function signatureBytes(rawPayload: Hex): Uint8Array {
  const bytes = hexToU8a(rawPayload);
  return bytes.length > 256 ? hexToU8a(blake2AsHex(bytes)) : bytes;
}
