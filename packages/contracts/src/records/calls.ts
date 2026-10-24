/** Closed native and ABI call trees, including their permitted wrapper composition. */
import type {
  AccountId32,
  Decimal,
  EvidenceRef,
  H160,
  Hash32,
  HexBytes,
  Timepoint,
  Weight,
} from "./primitives.js";
import type { MilestoneInput } from "./intents.js";

export type CallTree =
  | Tree_Transfer
  | Tree_CreatePure
  | Tree_MapAccount
  | Tree_AddProxy
  | Tree_RemoveProxy
  | Tree_Vest
  | Tree_VestOther
  | Tree_Cancel
  | Tree_AbiCreate
  | Tree_AbiSubmit
  | Tree_AbiApprove
  | Tree_AbiReclaim
  | Tree_ReviveCreate
  | Tree_ReviveSubmit
  | Tree_ReviveApprove
  | Tree_ReviveReclaim
  | Tree_ProxyMap
  | Tree_ProxyAdd
  | Tree_ProxyRemove
  | Tree_ProxySubmit
  | Tree_ProxyVest;

export type Tree_Transfer = {
  kind: "native_call";
  palletOrContract: "Balances";
  method: "transfer_keep_alive";
  parameters: { dest: AccountId32; valueNative: Decimal };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_CreatePure = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "create_pure";
  parameters: { proxyType: "Any"; delay: "0"; index: Decimal };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_MapAccount = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "map_account";
  parameters: {};
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AddProxy = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "add_proxy";
  parameters: { delegate: AccountId32; proxyType: "Any"; delay: "0" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_RemoveProxy = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "remove_proxy";
  parameters: { delegate: AccountId32; proxyType: "Any"; delay: "0" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_Vest = {
  kind: "native_call";
  palletOrContract: "Vesting";
  method: "vest";
  parameters: {};
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_VestOther = {
  kind: "native_call";
  palletOrContract: "Vesting";
  method: "vest_other";
  parameters: { target: AccountId32 };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_Cancel = {
  kind: "native_call";
  palletOrContract: "Multisig";
  method: "cancel_as_multi";
  parameters: {
    threshold: "2";
    otherSignatories: Array<AccountId32>;
    timepoint: Timepoint;
    callHash: Hash32;
  };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiCreate = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "createGrant(address,address,address[],uint8,(uint128,uint64,uint32,address,bytes4,uint64)[])";
  parameters: {
    grantee: H160;
    token: "0x0000000000000000000000000000000000000000";
    reviewers: Array<H160>;
    threshold: "2";
    inputs: [MilestoneInput, MilestoneInput];
  };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiSubmit = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "submitMilestone(uint256,uint256,string)";
  parameters: { grantId: Decimal; index: "0" | "1"; evidence: string };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiApprove = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "approveMilestone(uint256,uint256)";
  parameters: { grantId: Decimal; index: "0" | "1" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_AbiReclaim = {
  kind: "abi_call";
  palletOrContract: "VESTRY";
  method: "reclaim(uint256,uint256)";
  parameters: { grantId: Decimal; index: "0" | "1" };
  children: Array<CallTree>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveCreate = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiCreate>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveSubmit = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiSubmit>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveApprove = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiApprove>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ReviveReclaim = {
  kind: "native_call";
  palletOrContract: "Revive";
  method: "call";
  parameters: {
    dest: H160;
    valueNative: Decimal;
    weightLimit: Weight;
    storageDepositLimitNative: Decimal;
    data: HexBytes;
  };
  children: Array<Tree_AbiReclaim>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyMap = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_MapAccount>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyAdd = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_AddProxy>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyRemove = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_RemoveProxy>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxySubmit = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_ReviveSubmit>;
  sourceEvidence: Array<EvidenceRef>;
};

export type Tree_ProxyVest = {
  kind: "native_call";
  palletOrContract: "Proxy";
  method: "proxy";
  parameters: {
    real: AccountId32;
    forceProxyType: { variant: "Some"; value: "Any" };
  };
  children: Array<Tree_Vest>;
  sourceEvidence: Array<EvidenceRef>;
};
