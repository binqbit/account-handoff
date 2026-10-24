import { beforeEach, describe, expect, it, vi } from "vitest";
import { createKeyMulti } from "@polkadot/util-crypto";
import { blake2AsHex, u8aToHex, encodeAddress } from "dedot/utils";
import { keccak256 } from "viem";
import {
  contractAddress,
  type Hex,
  type NativeAccountState,
  type NativeConnection,
  type NativeFingerprint,
  type NativeReceipt,
} from "@account-handoff/native-adapter";
import type {
  GrantHistory,
  GrantHistoryEntry,
  GrantState,
} from "@account-handoff/grant-adapter";
import type { LocalDescriptor } from "../../../apps/web/src/application/models";
const readers = vi.hoisted(() => ({ history: vi.fn(), grant: vi.fn() }));
vi.mock("@account-handoff/grant-adapter", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@account-handoff/grant-adapter")>()),
  scanGrantHistory: readers.history,
  readGrant: readers.grant,
}));
import {
  validateLocalWorkspaceImport,
  verifyWorkspaceConnection,
} from "../../../apps/web/src/application/local-import";
const h = (digit: string, bytes = 32) => `0x${digit.repeat(bytes * 2)}` as Hex;
const A = h("1"),
  B = h("2"),
  C = h("3"),
  D = h("4"),
  F = h("5"),
  R1 = h("6"),
  R2 = h("7"),
  P = h("8"),
  V = h("9", 20);
const M0 = u8aToHex(createKeyMulti([A, B, C].sort(), 2));
const creationBlock = h("a"),
  grantBlock = h("b"),
  finalBlock = h("c"),
  creationHash = h("d"),
  rawGrant = "0x0102";
function fixture() {
  const code = "0x6000" as Hex;
  const expected: LocalDescriptor = {
    mode: "LOCAL",
    runId: "browser",
    generation: 1,
    status: "running",
    nativeRpc: "ws://127.0.0.1:9955",
    gatewayRpc: "http://127.0.0.1:8555",
    namespace: "test",
    buildHash: "f".repeat(64),
    runtime: {
      specName: "account-handoff-local",
      specVersion: 1,
      nativeDecimals: 14,
      nativeToEthRatio: "10000",
      autoMap: false,
    },
    genesisHash: h("e"),
    runtimeCodeHash: h("f"),
    metadataSha256: "1".repeat(64),
    qualified: true,
    contract: {
      address: V,
      sourceSha256: "2".repeat(64),
      runtimeCodeHash: keccak256(code),
      abiSha256: "3".repeat(64),
    },
  };
  const raw = {
    format: "account-handoff-local-workspace",
    version: 1,
    mode: "LOCAL",
    runId: "browser",
    generation: 1,
    genesisHash: h("e"),
    endpoint: "ws://127.0.0.1:9955",
    input: {
      name: "Local test",
      oldMembers: [A, B, C],
      newMembers: [A, B, D],
      threshold: 2,
      funder: F,
      reviewers: [R1, R2],
      beneficiary: P,
      contract: V,
      grantId: "0",
    },
    creation: {
      transactionHash: creationHash,
      blockHash: creationBlock,
      blockNumber: 10,
      transactionIndex: 1,
    },
  };
  const state: NativeAccountState = {
    address: P,
    free: 0n,
    reserved: 0n,
    frozen: 0n,
    nonce: 0,
    proxies: [{ delegate: M0 as Hex, proxyType: "Any", delay: 0 }],
    proxyDeposit: 0n,
    mappedAddress: contractAddress(P),
    mappedTo: null,
    holds: [],
    vesting: [],
  };
  const receipt: NativeReceipt = {
    txHash: creationHash,
    blockHash: creationBlock,
    blockNumber: 10,
    txIndex: 1,
    events: [
      {
        pallet: "Multisig",
        name: "MultisigExecuted",
        data: { multisig: M0 },
        index: 2,
      },
      {
        pallet: "Proxy",
        name: "PureCreated",
        data: { pure: P, who: M0, proxyType: "Any" },
        index: 1,
      },
    ],
    outerSuccess: true,
    nestedSuccess: true,
    businessExecuted: true,
    failure: null,
  };
  const grantReceipt: NativeReceipt = {
    ...receipt,
    txHash: blake2AsHex(rawGrant),
    blockHash: grantBlock,
    blockNumber: 12,
    txIndex: 0,
    events: [],
  };
  const created: GrantHistoryEntry = {
    blockNumber: 12,
    blockHash: grantBlock,
    eventIndex: 0,
    txIndex: 0,
    eventName: "GrantCreated",
    args: {
      grantId: 0n,
      funder: contractAddress(F),
      grantee: contractAddress(P),
      token: h("0", 20),
      reviewers: [contractAddress(R1), contractAddress(R2)],
      threshold: 2,
    },
    contract: V,
    grantId: "0",
    rawExtrinsic: rawGrant,
    decodedCall: {
      pallet: "Revive",
      palletCall: { name: "Call", params: { dest: V } },
    },
    signer: F,
    roundBefore: null,
  };
  const history: GrantHistory = {
    complete: true,
    fromBlock: 10,
    toBlock: 20,
    scannedThrough: 20,
    entries: [created],
    blockers: [],
    scope: "EligibleSingleRound",
    rounds: [0, 0],
    milestoneStates: ["Open", "Open"],
    firstVestingRelease: null,
  };
  const grant: GrantState = {
    funder: contractAddress(F),
    grantee: contractAddress(P),
    threshold: 2,
    milestoneCount: 2,
    token: h("0", 20),
    milestones: [],
  };
  const fingerprint = vi.fn(
    async (block?: Hex): Promise<NativeFingerprint> => ({
      genesis: h("e"),
      specName: "account-handoff-local",
      specVersion: 1,
      transactionVersion: 1,
      metadataVersion: 15,
      metadataHash: h("0"),
      metadataSha256: "1".repeat(64),
      rawMetadata: "0x00",
      runtimeCodeHash: h("f"),
      signedExtensions: [],
      runtimeApis: {},
      anchor: {
        hash: block ?? finalBlock,
        number: block === creationBlock ? 10 : block === grantBlock ? 12 : 20,
      },
      tokenDecimals: 14,
      tokenSymbol: "UNIT",
      ss58Prefix: 42,
    }),
  );
  const pristine = vi.fn(async () => code);
  const connection = {
    mode: "LOCAL",
    endpoint: expected.nativeRpc,
    fingerprint,
    receiptAt: vi.fn(async (_hash: Hex, tx: Hex) =>
      tx === creationHash ? receipt : grantReceipt,
    ),
    inspectExtrinsic: vi.fn(async () => ({
      bytes: "0x0304",
      signer: A,
      call: {
        pallet: "Multisig",
        palletCall: {
          name: "AsMulti",
          params: {
            threshold: 2,
            otherSignatories: [B, C],
            call: {
              pallet: "Proxy",
              palletCall: {
                name: "CreatePure",
                params: { proxyType: "Any", delay: 0, index: 0 },
              },
            },
          },
        },
      },
      callHex: "0x05",
    })),
    readAccount: vi.fn(async () => state),
    api: {
      at: vi.fn(async () => ({
        query: {
          revive: {
            accountInfoOf: vi.fn(async () => ({
              accountType: { type: "Contract", value: { codeHash: h("4") } },
            })),
            pristineCode: pristine,
          },
        },
      })),
    },
  } as unknown as NativeConnection;
  readers.history.mockResolvedValue(history);
  readers.grant.mockResolvedValue(grant);
  return {
    raw,
    expected,
    connection,
    state,
    receipt,
    created,
    history,
    grant,
    fingerprint,
    pristine,
  };
}
beforeEach(() => vi.clearAllMocks());
describe("LOCAL workspace import verifies original chain provenance", () => {
  it("connects an existing Pure without preconfiguring a replacement or grant", async () => {
    const f = fixture();
    const {
      newMembers: _next,
      contract: _contract,
      grantId: _grant,
      ...input
    } = f.raw.input;
    const result = await verifyWorkspaceConnection(
      input,
      { blockHash: creationBlock, transactionHash: creationHash },
      f.connection,
      f.expected,
    );
    expect(result.input.newMembers).toBeUndefined();
    expect(result.input.contract).toBeUndefined();
    expect(result.creationEvidence).toHaveLength(1);
    expect(result.grantCreationBlock).toBeNull();
    expect(readers.grant).not.toHaveBeenCalled();
  });
  it("checks the current controller and persistent mapping when connecting a grant", async () => {
    const f = fixture();
    const { newMembers: _next, ...input } = f.raw.input;
    f.state.mappedTo = P;
    expect(
      (
        await verifyWorkspaceConnection(
          input,
          { blockHash: creationBlock, transactionHash: creationHash },
          f.connection,
          f.expected,
        )
      ).input.grantId,
    ).toBe("0");
    f.state.mappedTo = null;
    await expect(
      verifyWorkspaceConnection(
        input,
        { blockHash: creationBlock, transactionHash: creationHash },
        f.connection,
        f.expected,
      ),
    ).rejects.toThrow("persistent mapping");
  });
  it("rejects an unrelated current controller and a partial grant locator", async () => {
    const f = fixture();
    const { newMembers: _next, ...input } = f.raw.input;
    f.state.proxies.push({ delegate: D, proxyType: "Any", delay: 0 });
    await expect(
      verifyWorkspaceConnection(
        input,
        { blockHash: creationBlock, transactionHash: creationHash },
        f.connection,
        f.expected,
      ),
    ).rejects.toThrow(/initial authority|sole/);
    const { grantId: _grant, ...partial } = input;
    await expect(
      verifyWorkspaceConnection(
        partial,
        { blockHash: creationBlock, transactionHash: creationHash },
        f.connection,
        f.expected,
      ),
    ).rejects.toThrow("Grant ID");
  });
  it("returns normalized input and two chain-bound evidence references without mutation", async () => {
    const f = fixture();
    const result = await validateLocalWorkspaceImport(
      f.raw,
      f.connection,
      f.expected,
    );
    expect(result.input.oldMembers).toEqual([A, B, C]);
    expect(result.creationBlock).toBe(10);
    expect(result.grantCreationBlock).toBe(12);
    expect(result.creationEvidence[0]!.sourceId).toBe(creationHash);
    expect(result.grantCreationEvidence[0]!.locator).toBe(`${grantBlock}/0/0`);
    expect(f.raw.input.name).toBe("Local test");
  });
  it("normalizes SS58 event identities emitted by the native codec", async () => {
    const f = fixture();
    f.receipt.events[0]!.data["multisig"] = encodeAddress(M0);
    f.receipt.events[1]!.data["pure"] = encodeAddress(P);
    f.receipt.events[1]!.data["who"] = encodeAddress(M0);
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).resolves.toMatchObject({ creationBlock: 10 });
  });
  it("rejects another run or genesis before reading any chain state", async () => {
    const f = fixture();
    f.raw.generation = 2;
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("another LOCAL run");
    expect(f.fingerprint).not.toHaveBeenCalled();
  });
  it("rejects a caller-supplied different M0 creator", async () => {
    const f = fixture();
    f.raw.input.oldMembers = [A, B, F];
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("different beneficiary, creator");
  });
  it("requires exactly the initial M0 Any0 inventory", async () => {
    const f = fixture();
    f.state.proxies.push({ delegate: F, proxyType: "Any", delay: 0 });
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("initial authority");
  });
  it("rejects a grant created before Pure rather than claiming retrofit continuity", async () => {
    const f = fixture();
    f.created.blockNumber = 9;
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("not created after");
  });
  it("rejects a different original funder even if the current getter claims the expected one", async () => {
    const f = fixture();
    f.created.args["funder"] = contractAddress(A);
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("different funder");
  });
  it("rejects a missing or substituted contract bytecode", async () => {
    const f = fixture();
    f.pristine.mockResolvedValue("0x6001");
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("runtime bytecode differs");
  });
  it("binds contract code again at the original grant-creation block", async () => {
    const f = fixture();
    f.pristine.mockResolvedValueOnce("0x6000").mockResolvedValueOnce("0x6001");
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("runtime bytecode differs");
    expect(f.pristine).toHaveBeenCalledTimes(2);
  });
  it("rejects a changed runtime at the Pure creation anchor", async () => {
    const f = fixture();
    const original = f.fingerprint.getMockImplementation()!;
    f.fingerprint.mockImplementation(async (block) => ({
      ...(await original(block)),
      ...(block === creationBlock ? { runtimeCodeHash: h("7") } : {}),
    }));
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("Runtime/codecs differ");
  });
  it("requires the same reviewers in original contract creation", async () => {
    const f = fixture();
    f.created.args["reviewers"] = [contractAddress(R1), contractAddress(A)];
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("reviewers differ");
  });
  it("requires complete historical observation", async () => {
    const f = fixture();
    f.history.complete = false;
    f.history.blockers = ["pruned block"];
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("history is incomplete");
  });
  it("rejects an origin-changing wrapper around grant creation", async () => {
    const f = fixture();
    f.created.decodedCall = {
      pallet: "Proxy",
      palletCall: { name: "Proxy", params: {} },
    };
    await expect(
      validateLocalWorkspaceImport(f.raw, f.connection, f.expected),
    ).rejects.toThrow("not a direct call");
  });
  it("rejects unexpected executable-looking fields rather than silently ignoring them", async () => {
    const f = fixture();
    const input = { ...f.raw, signedExtrinsicBytes: "0xdead" };
    await expect(
      validateLocalWorkspaceImport(input, f.connection, f.expected),
    ).rejects.toThrow("unsupported fields");
    expect(f.fingerprint).not.toHaveBeenCalled();
  });
  it("does not install an endpoint carried by the import", async () => {
    const f = fixture();
    f.raw.endpoint = "wss://untrusted.example";
    await validateLocalWorkspaceImport(f.raw, f.connection, f.expected);
    expect(f.connection.endpoint).toBe("ws://127.0.0.1:9955");
  });
});
