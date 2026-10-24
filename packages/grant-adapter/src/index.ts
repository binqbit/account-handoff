import {
  parseAbi,
  encodeFunctionData,
  decodeFunctionResult,
  decodeEventLog,
  keccak256,
} from "viem";
import type { Hex } from "@account-handoff/native-adapter";
import type { NativeConnection } from "@account-handoff/native-adapter";

export const vestryAbi = parseAbi([
  "function WEI_PER_PLANCK() view returns (uint256)",
  "function VESTING() view returns (address)",
  "function grantCount() view returns (uint256)",
  "function grants(uint256) view returns (address funder, uint8 threshold, uint8 milestoneCount, address grantee, address token)",
  "function getMilestone(uint256 grantId,uint256 index) view returns ((uint128 amount,uint64 deadline,uint32 vestingBlocks,uint8 approvals,uint8 round,uint8 state,address metricTarget,bytes4 metricSelector,uint64 metricMin))",
  "function isReviewer(uint256 grantId,address reviewer) view returns (bool)",
  "function createGrant(address grantee,address token,address[] reviewers,uint8 threshold,(uint128 amount,uint64 deadline,uint32 vestingBlocks,address metricTarget,bytes4 metricSelector,uint64 metricMin)[] inputs) payable returns(uint256)",
  "function submitMilestone(uint256 grantId,uint256 index,string evidence)",
  "function approveMilestone(uint256 grantId,uint256 index)",
  "event GrantCreated(uint256 indexed grantId,address indexed funder,address indexed grantee,address token,uint256 total,address[] reviewers,uint8 threshold)",
  "event MilestoneSubmitted(uint256 indexed grantId,uint256 indexed index,string evidence)",
  "event MilestoneApproved(uint256 indexed grantId,uint256 indexed index,address indexed reviewer,uint8 approvals)",
  "event ChangesRequested(uint256 indexed grantId,uint256 indexed index,address indexed reviewer,string reason)",
  "event AwaitingMetric(uint256 indexed grantId,uint256 indexed index)",
  "event MilestoneReleased(uint256 indexed grantId,uint256 indexed index,uint256 amount,uint32 vestingBlocks,uint256 metricValue)",
  "event MilestoneReclaimed(uint256 indexed grantId,uint256 indexed index,uint256 amount)",
]);
export const ZERO_ADDRESS =
  "0x0000000000000000000000000000000000000000" as const;
export interface MilestoneInput {
  amount: bigint;
  deadline: bigint;
  vestingBlocks: number;
  metricTarget: Hex;
  metricSelector: Hex;
  metricMin: bigint;
}
export interface GrantState {
  funder: Hex;
  threshold: number;
  milestoneCount: number;
  grantee: Hex;
  token: Hex;
  milestones: MilestoneState[];
}
export interface MilestoneState {
  amount: bigint;
  deadline: bigint;
  vestingBlocks: number;
  approvals: number;
  round: number;
  state: number;
  metricTarget: Hex;
  metricSelector: Hex;
  metricMin: bigint;
}

export function encodeCreateGrant(
  grantee: Hex,
  reviewers: Hex[],
  milestones: MilestoneInput[],
): Hex {
  if (
    reviewers.length !== 2 ||
    new Set(reviewers.map((a) => a.toLowerCase())).size !== 2 ||
    milestones.length !== 2
  )
    throw new Error(
      "The supported grant requires two distinct reviewers and two milestones",
    );
  if (reviewers.some((a) => a.toLowerCase() === grantee.toLowerCase()))
    throw new Error("A reviewer cannot be the grant beneficiary");
  if (
    milestones.some(
      (m) =>
        m.amount <= 0n ||
        m.amount % 10000n !== 0n ||
        m.metricTarget !== ZERO_ADDRESS ||
        m.metricSelector !== "0x00000000" ||
        m.metricMin !== 0n,
    )
  )
    throw new Error("Unsupported grant amounts or metric gate");
  if (milestones[0]!.vestingBlocks <= 0 || milestones[1]!.vestingBlocks !== 0)
    throw new Error(
      "The first milestone must vest and the second must remain unvested",
    );
  return encodeFunctionData({
    abi: vestryAbi,
    functionName: "createGrant",
    args: [grantee, ZERO_ADDRESS, reviewers, 2, milestones],
  });
}
export function encodeSubmission(
  grantId: bigint,
  index: number,
  evidence: string,
): Hex {
  if (grantId < 0n || ![0, 1].includes(index))
    throw new Error("Invalid grant or milestone");
  if (!evidence.trim() || new TextEncoder().encode(evidence).length > 1024)
    throw new Error("Evidence must contain 1–1024 UTF-8 bytes");
  return encodeFunctionData({
    abi: vestryAbi,
    functionName: "submitMilestone",
    args: [grantId, BigInt(index), evidence],
  });
}
export function encodeApproval(grantId: bigint, index: number): Hex {
  if (grantId < 0n || ![0, 1].includes(index))
    throw new Error("Invalid grant or milestone");
  return encodeFunctionData({
    abi: vestryAbi,
    functionName: "approveMilestone",
    args: [grantId, BigInt(index)],
  });
}
export async function readGrant(
  connection: NativeConnection,
  origin: string,
  contract: Hex,
  id: bigint,
  blockHash?: Hex,
): Promise<GrantState> {
  const anchor =
    blockHash ?? (await connection.api.rpc.chain_getFinalizedHead());
  const data = await connection.readContract(
    origin,
    contract,
    encodeFunctionData({ abi: vestryAbi, functionName: "grants", args: [id] }),
    anchor,
  );
  const [funder, threshold, milestoneCount, grantee, token] =
    decodeFunctionResult({ abi: vestryAbi, functionName: "grants", data });
  if (milestoneCount !== 2 || threshold !== 2 || token !== ZERO_ADDRESS)
    throw new Error("Grant is outside the supported controlled profile");
  const milestones = await Promise.all(
    [0, 1].map(async (index) =>
      decodeFunctionResult({
        abi: vestryAbi,
        functionName: "getMilestone",
        data: await connection.readContract(
          origin,
          contract,
          encodeFunctionData({
            abi: vestryAbi,
            functionName: "getMilestone",
            args: [id, BigInt(index)],
          }),
          anchor,
        ),
      }),
    ),
  );
  return { funder, threshold, milestoneCount, grantee, token, milestones };
}
export async function verifyGrantConstants(
  connection: NativeConnection,
  origin: string,
  contract: Hex,
): Promise<void> {
  const ratio = decodeFunctionResult({
    abi: vestryAbi,
    functionName: "WEI_PER_PLANCK",
    data: await connection.readContract(
      origin,
      contract,
      encodeFunctionData({ abi: vestryAbi, functionName: "WEI_PER_PLANCK" }),
    ),
  });
  const vesting = decodeFunctionResult({
    abi: vestryAbi,
    functionName: "VESTING",
    data: await connection.readContract(
      origin,
      contract,
      encodeFunctionData({ abi: vestryAbi, functionName: "VESTING" }),
    ),
  });
  if (
    ratio !== 10000n ||
    vesting.toLowerCase() !== "0x0000000000000000000000000000000009020000"
  )
    throw new Error(
      "Vestry constant binding differs from the supported source",
    );
}
export function decodeGrantEvent(data: Hex, topics: readonly Hex[]): unknown {
  return decodeEventLog({
    abi: vestryAbi,
    data,
    topics: topics as [Hex, ...Hex[]],
  });
}
export function abiFingerprint(): Hex {
  return keccak256(new TextEncoder().encode(JSON.stringify(vestryAbi)));
}
export async function isGrantReviewer(
  connection: NativeConnection,
  origin: string,
  contract: Hex,
  grantId: bigint,
  reviewer: Hex,
  blockHash?: Hex,
): Promise<boolean> {
  return decodeFunctionResult({
    abi: vestryAbi,
    functionName: "isReviewer",
    data: await connection.readContract(
      origin,
      contract,
      encodeFunctionData({
        abi: vestryAbi,
        functionName: "isReviewer",
        args: [grantId, reviewer],
      }),
      blockHash,
    ),
  });
}

export * from "./history.js";
