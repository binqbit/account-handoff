import { decodeGrantEvent } from "./index.js";
import { account, hex, number, plain } from "@account-handoff/native-adapter";
import type { Hex, NativeConnection } from "@account-handoff/native-adapter";

export interface HistoryEvent {
  pallet: string;
  name: string;
  data: Record<string, unknown>;
  eventIndex: number;
  txIndex: number | null;
}
export interface HistoryBlock {
  number: number;
  hash: Hex;
  executionCompatible: boolean;
  events: HistoryEvent[];
  extrinsics: Array<{ bytes: Hex; call: unknown; signer: string | null }>;
}
export interface FinalizedHistorySource {
  finalizedHeight(): Promise<number>;
  block(height: number): Promise<HistoryBlock>;
}
export interface GrantHistoryEntry {
  blockNumber: number;
  blockHash: Hex;
  eventIndex: number;
  txIndex: number | null;
  eventName: string;
  args: Record<string, unknown>;
  contract: Hex;
  grantId: string;
  rawExtrinsic: Hex | null;
  decodedCall: unknown;
  signer: string | null;
  roundBefore: number | null;
}
export interface GrantHistory {
  complete: boolean;
  fromBlock: number;
  toBlock: number;
  scannedThrough: number | null;
  entries: GrantHistoryEntry[];
  blockers: string[];
  scope: "EligibleSingleRound" | "ScopeBreached" | "ReconciliationRequired";
  rounds: [number, number];
  milestoneStates: [string, string];
  firstVestingRelease: GrantHistoryEntry | null;
}
export interface ScanOptions {
  contract: Hex;
  grantId: string;
  fromBlock: number;
  toBlock: number;
  maxBlocks?: number;
  signal?: AbortSignal;
  onProgress?: (completed: number, total: number) => void;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Expected structured chain evidence");
  return value as Record<string, unknown>;
}
function asText(value: unknown): string {
  if (typeof value !== "string")
    throw new Error("Missing hexadecimal log field");
  return value;
}
function decimal(value: unknown): string {
  if (typeof value === "bigint" && value >= 0n) return value.toString();
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0)
    return String(value);
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value))
    return value;
  throw new Error("Invalid grant log integer");
}

/** The pure reducer relies on event order, never the current getter's round. */
export function reduceGrantHistory(
  entries: GrantHistoryEntry[],
  complete: boolean,
  blockers: string[],
): Pick<
  GrantHistory,
  "scope" | "rounds" | "milestoneStates" | "firstVestingRelease"
> {
  const rounds: [number, number] = [0, 0];
  const milestoneStates: [string, string] = ["Open", "Open"];
  let created = false;
  let breached = false;
  let firstVestingRelease: GrantHistoryEntry | null = null;
  const submissions = [0, 0];
  for (const entry of entries) {
    if (entry.eventName === "GrantCreated") {
      if (created) {
        blockers.push("Duplicate grant creation event");
        complete = false;
      }
      created = true;
      continue;
    }
    if (!created) {
      blockers.push("Grant event precedes observed creation");
      complete = false;
    }
    const indexText =
      entry.args.index === undefined ? null : decimal(entry.args.index);
    if (indexText !== "0" && indexText !== "1") {
      blockers.push(
        "Event references a milestone outside the supported profile",
      );
      complete = false;
      continue;
    }
    const index = Number(indexText) as 0 | 1;
    entry.roundBefore = rounds[index];
    switch (entry.eventName) {
      case "ChangesRequested":
        rounds[index] += 1;
        milestoneStates[index] = "Open";
        breached = true;
        break;
      case "MilestoneSubmitted":
        if (
          milestoneStates[index] !== "Open" ||
          submissions[index]! > 0 ||
          rounds[index] !== 0
        )
          breached = true;
        submissions[index] = submissions[index]! + 1;
        milestoneStates[index] = "Submitted";
        break;
      case "MilestoneApproved":
        if (milestoneStates[index] !== "Submitted") {
          blockers.push("Approval has no causally observed submission");
          complete = false;
        }
        break;
      case "MilestoneReleased":
        if (milestoneStates[index] !== "Submitted") {
          blockers.push("Release has no causally observed submission");
          complete = false;
        }
        milestoneStates[index] = "Released";
        if (index === 0 && BigInt(decimal(entry.args.vestingBlocks)) > 0n)
          firstVestingRelease = entry;
        break;
      case "MilestoneReclaimed":
        milestoneStates[index] = "Reclaimed";
        breached = true;
        break;
      case "AwaitingMetric":
        breached = true;
        break;
      default:
        blockers.push(`Unsupported grant event ${entry.eventName}`);
        complete = false;
    }
  }
  if (!created) {
    blockers.push("The scanned history does not contain this grant’s creation");
    complete = false;
  }
  return {
    scope: breached
      ? "ScopeBreached"
      : complete && blockers.length === 0
        ? "EligibleSingleRound"
        : "ReconciliationRequired",
    rounds,
    milestoneStates,
    firstVestingRelease,
  };
}

export async function scanGrantHistoryWithSource(
  source: FinalizedHistorySource,
  options: ScanOptions,
): Promise<GrantHistory> {
  const maxBlocks = options.maxBlocks ?? 4096;
  if (
    !Number.isSafeInteger(maxBlocks) ||
    maxBlocks < 1 ||
    maxBlocks > 4096 ||
    !Number.isSafeInteger(options.fromBlock) ||
    !Number.isSafeInteger(options.toBlock) ||
    options.fromBlock < 0 ||
    options.toBlock < options.fromBlock
  )
    throw new Error("Invalid bounded history range");
  const count = options.toBlock - options.fromBlock + 1;
  if (count > maxBlocks)
    throw new Error(`History range exceeds the ${maxBlocks}-block bound`);
  const contract = hex(options.contract, 20);
  const grantId = decimal(options.grantId);
  const output: GrantHistory = {
    complete: true,
    fromBlock: options.fromBlock,
    toBlock: options.toBlock,
    scannedThrough: null,
    entries: [],
    blockers: [],
    scope: "ReconciliationRequired",
    rounds: [0, 0],
    milestoneStates: ["Open", "Open"],
    firstVestingRelease: null,
  };
  if (options.toBlock > (await source.finalizedHeight()))
    throw new Error("History cannot include unfinalized blocks");
  for (let height = options.fromBlock; height <= options.toBlock; height += 1) {
    if (options.signal?.aborted) {
      output.complete = false;
      output.blockers.push("History scan canceled");
      break;
    }
    try {
      const block = await source.block(height);
      if (block.number !== height || !block.executionCompatible)
        throw new Error(
          "Execution/runtime context changed or mismatched at history block",
        );
      if (block.events.length > 65536)
        throw new Error("History block exceeds event budget");
      if (
        block.events.some(
          (event, index) =>
            !Number.isSafeInteger(event.eventIndex) ||
            event.eventIndex < 0 ||
            (index > 0 &&
              event.eventIndex <= block.events[index - 1]!.eventIndex),
        )
      )
        throw new Error(
          "Historical event indices are duplicated or out of order",
        );
      for (const event of block.events) {
        if (event.pallet !== "Revive" || event.name !== "ContractEmitted")
          continue;
        if (hex(asText(event.data.contract), 20) !== contract) continue;
        if (!Array.isArray(event.data.topics))
          throw new Error("Contract log topics are unavailable");
        const decoded = object(
          decodeGrantEvent(
            hex(asText(event.data.data)),
            event.data.topics.map((topic) => hex(asText(topic), 32)),
          ),
        );
        const args = object(decoded.args);
        if (decimal(args.grantId) !== grantId) continue;
        const tx =
          event.txIndex === null ? null : block.extrinsics[event.txIndex];
        if (event.txIndex !== null && !tx)
          throw new Error("Matching event has no corresponding extrinsic");
        output.entries.push({
          blockNumber: height,
          blockHash: block.hash,
          eventIndex: event.eventIndex,
          txIndex: event.txIndex,
          eventName: asText(decoded.eventName),
          args,
          contract,
          grantId,
          rawExtrinsic: tx?.bytes ?? null,
          decodedCall: tx?.call ?? null,
          signer: tx?.signer ?? null,
          roundBefore: null,
        });
        if (output.entries.length > 8192)
          throw new Error("Grant history exceeds event budget");
      }
      output.scannedThrough = height;
      options.onProgress?.(height - options.fromBlock + 1, count);
    } catch (error) {
      output.complete = false;
      output.blockers.push(
        `Block ${height}: ${error instanceof Error ? error.message : String(error)}`,
      );
      break;
    }
  }
  Object.assign(
    output,
    reduceGrantHistory(output.entries, output.complete, output.blockers),
  );
  output.complete = output.complete && output.blockers.length === 0;
  return output;
}

/** Uses only the explicitly selected native connection; no endpoint can be supplied by imported history. */
export async function scanGrantHistory(
  connection: NativeConnection,
  options: ScanOptions,
): Promise<GrantHistory> {
  const source: FinalizedHistorySource = {
    async finalizedHeight() {
      return number(
        (await connection.api.rpc.chain_getHeader(
          await connection.api.rpc.chain_getFinalizedHead(),
        ))!.number,
      );
    },
    async block(height) {
      const blockHash = await connection.api.rpc.chain_getBlockHash(height);
      if (!blockHash) throw new Error("Historical block hash is unavailable");
      const signedBlock = await connection.api.rpc.chain_getBlock(blockHash);
      if (!signedBlock) throw new Error("Historical block is unavailable");
      const at = await connection.api.at(blockHash);
      const [events, currentCodeHash, parentCodeHash] = await Promise.all([
        at.query.system.events(),
        connection.api.rpc.state_getStorageHash("0x3a636f6465", blockHash),
        height === 0
          ? Promise.resolve(null)
          : connection.api.rpc.state_getStorageHash(
              "0x3a636f6465",
              signedBlock.block.header.parentHash,
            ),
      ]);
      const executionCompatible =
        currentCodeHash !== null &&
        (height === 0 || currentCodeHash === parentCodeHash);
      return {
        number: number(signedBlock.block.header.number),
        hash: hex(blockHash, 32),
        executionCompatible,
        events: events.map((entry, eventIndex) => {
          const rawEvent = entry.event;
          return {
            pallet: rawEvent.pallet,
            name:
              typeof rawEvent.palletEvent === "string"
                ? rawEvent.palletEvent
                : rawEvent.palletEvent.name,
            data:
              typeof rawEvent.palletEvent === "string" ||
              !("data" in rawEvent.palletEvent)
                ? {}
                : object(plain(rawEvent.palletEvent.data)),
            eventIndex,
            txIndex:
              entry.phase.type === "ApplyExtrinsic" ? entry.phase.value : null,
          };
        }),
        extrinsics: signedBlock.block.extrinsics.map((bytes) => {
          const extrinsic = at.registry.$Extrinsic.tryDecode(bytes);
          let signer: string | null = null;
          if (extrinsic.signature) {
            const address = object(plain(extrinsic.signature.address));
            if (address.type === "Id" && typeof address.value === "string")
              signer = account(address.value);
          }
          return { bytes: hex(bytes), call: plain(extrinsic.call), signer };
        }),
      };
    },
  };
  return scanGrantHistoryWithSource(source, options);
}

export function roundAtSubmission(
  history: GrantHistory,
  target: { blockHash: string; txIndex: number; eventIndex?: number },
): number | null {
  if (!history.complete) return null;
  const entries = history.entries.filter(
    (entry) =>
      entry.eventName === "MilestoneSubmitted" &&
      entry.blockHash === target.blockHash &&
      entry.txIndex === target.txIndex &&
      (target.eventIndex === undefined ||
        entry.eventIndex === target.eventIndex),
  );
  return entries.length === 1 ? entries[0]!.roundBefore : null;
}
