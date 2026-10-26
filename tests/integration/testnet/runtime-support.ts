import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { Keyring } from "@polkadot/keyring";
import { createKeyMulti, cryptoWaitReady } from "@polkadot/util-crypto";
import { u8aToHex, blake2AsHex } from "dedot/utils";
import {
  NativeConnection,
  account,
  hex,
  plain,
  signatureBytes,
  type NativeAction,
  type NativeReceipt,
} from "@account-handoff/native-adapter";
import { decodeGrantEvent } from "@account-handoff/grant-adapter";
import { buildBlocks } from "./blocks";
export async function setupRuntimeTest() {
  const root = ".agent-workspace/implementation/testnet-pipeline/fork";
  const binding = JSON.parse(
    readFileSync("infra/testnet/metadata-binding.json", "utf8"),
  );
  const network = JSON.parse(
    readFileSync("infra/testnet/network.json", "utf8"),
  );
  const c = await NativeConnection.connect(
    "ws://127.0.0.1:8059",
    "LOCAL",
    binding,
  );
  assert.equal(new URL(c.endpoint).hostname, "127.0.0.1");
  await cryptoWaitReady();
  const ring = new Keyring({ type: "sr25519" });
  const pairs = ["//Alice", "//Bob", "//Charlie", "//Dave", "//Eve"].map(
    (uri) => ring.addFromUri(uri),
  );
  const [A, B, C, D, F] = pairs.map((p) => account(p.address));
  const unit = 10n ** 14n;
  const M0 = account(u8aToHex(createKeyMulti([A!, B!, C!], 2))),
    M1 = account(u8aToHex(createKeyMulti([A!, B!, D!], 2)));
  const report: any = {
    status: "running",
    scope:
      "Isolated fork of PortalDot runtime. Real cryptographic signatures; no public-network submission. Local balance fixtures; mocked consensus/inherents.",
    runtimeCodeHash: binding.runtimeCodeHash,
    metadataSha256: binding.metadataSha256,
    steps: [],
  };
  async function build(params: { count?: number } = {}) {
    return buildBlocks(params.count ?? 1);
  }
  const save = () =>
    writeFileSync(
      `${root}/cycle.json`,
      JSON.stringify(plain(report), null, 2) + "\n",
    );
  async function tx(
    name: string,
    signer: number,
    action: NativeAction,
    expectedFailure = false,
  ): Promise<NativeReceipt> {
    const t = c.transaction(action),
      p = await c.prepareSigning(t, pairs[signer]!.address);
    const signed = c.attachSignature(
      p,
      hex(
        "0x01" +
          u8aToHex(pairs[signer]!.sign(signatureBytes(p.rawPayload))).slice(2),
      ),
    );
    const hash = await c.api.provider.send("author_submitExtrinsic", [signed]);
    const block = await build();
    const r = await c.receiptAt(block, hash);
    report.steps.push({
      name,
      signer: account(pairs[signer]!.address),
      callHash: blake2AsHex(t.callHex),
      receipt: r,
      expectedFailure,
    });
    save();
    console.log(name, r.outerSuccess, r.nestedSuccess, r.failure);
    assert(r.outerSuccess, name + ":outer");
    assert.equal(r.nestedSuccess, !expectedFailure, name + ":nested");
    return r;
  }
  async function multi(
    name: string,
    controller: string,
    members: string[],
    inner: NativeAction,
    second: number,
    expectedFailure = false,
  ) {
    const h = blake2AsHex(c.transaction(inner).callHex);
    const w = await c.dispatchWeight(c.transaction(inner));
    const weight = {
      refTime: w.refTime + w.refTime / 5n + 1n,
      proofSize: w.proofSize + w.proofSize / 5n + 1024n,
    };
    await tx(name + "-proposal", 0, {
      kind: "multisig",
      threshold: 2,
      others: members.filter((x) => x !== A).sort(),
      timepoint: undefined,
      inner,
      weight,
    });
    const prop = await c.proposal(controller, h);
    assert(prop);
    return tx(
      name + "-execute",
      second,
      {
        kind: "multisig",
        threshold: 2,
        others: members
          .filter((x) => x !== account(pairs[second]!.address))
          .sort(),
        timepoint: prop.when,
        inner,
        weight,
      },
      expectedFailure,
    );
  }
  async function call(
    origin: string,
    data: `0x${string}`,
    value = 0n,
  ): Promise<NativeAction> {
    const e = await c.estimateContract(
      origin,
      network.contractAddress,
      value,
      data,
    );
    return {
      kind: "revive-call",
      destination: network.contractAddress,
      value,
      data,
      weight: e.weight,
      storage: e.storage,
    };
  }
  function event(r: NativeReceipt, name: string) {
    for (const e of r.events)
      if (e.pallet === "Revive" && e.name === "ContractEmitted")
        try {
          const d = decodeGrantEvent(
            hex(String(e.data.data)),
            e.data.topics as `0x${string}`[],
          ) as { eventName: string; args: Record<string, unknown> };
          if (d.eventName === name)
            return d.args as unknown as Record<string, unknown>;
        } catch {}
    throw Error("Missing " + name);
  }
  const proxy = (pure: string, inner: NativeAction): NativeAction => ({
    kind: "proxy",
    beneficiary: pure,
    inner,
  });
  return {
    c,
    pairs,
    A,
    B,
    C,
    D,
    F,
    unit,
    M0,
    M1,
    report,
    save,
    tx,
    multi,
    call,
    event,
    proxy,
    build,
    network,
  };
}
