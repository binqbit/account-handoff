import type {Controller,EvidenceRef,ChainProfile,FrozenEnvelope,ReviewedSigningContext,SignedAttempt,EnabledOperationId} from '@account-handoff/contracts';
import type {NativeAccountState,NativeFingerprint,NativeReceipt,NativeAction,PreparedSigning,Hex} from '@account-handoff/native-adapter';
import type {GrantState} from '@account-handoff/grant-adapter';
import type {Lease} from '@account-handoff/local-store';
import type {RuntimeMode} from '../ui-contract';

export interface WorkspaceRecord {
  id:string; name:string; createdAt:string; mode:RuntimeMode; genesis:Hex;
  M0:Controller; M1:Controller;
  participants:{A:string;B:string;C:string;D:string;F:string;R1:string;R2:string;S:string};
  pure:string|null; contract:Hex|null; grantId:string|null;
  creationEvidence:EvidenceRef[];
  creationBlock?:number;
  history:WorkspaceHistory[];
  baseline:{account:NativeAccountState;grant:GrantState;blockHash:Hex;creatorReserved?:string}|null;
}
export interface WorkspaceHistory {
  id:string;operationId:EnabledOperationId;title:string;at:string;signer:string;receipt:NativeReceipt;
  envelopeDigest:string;attemptId:string;grantId:string|null;
}
export interface ChainView {
  fingerprint:NativeFingerprint;
  accounts:Record<string,NativeAccountState>;
  grant:GrantState|null;
  profile:ChainProfile;
  localDescriptor:LocalDescriptor|null;
}
export interface LocalDescriptor {
  mode:'LOCAL';runId:string;generation:number;status:string;nativeRpc:string;gatewayRpc:string;
  namespace:string;buildHash:string|null;sourceCommit?:string;
  runtime:{specName:string;specVersion:number;nativeDecimals:number;nativeToEthRatio:string;autoMap:boolean};
  genesis?:string;runtimeCodeHash?:string;metadataSha256?:string;
  qualification?:unknown;
  qualified?:boolean;genesisHash?:string;generatedNativeTypesSha256?:string;
  contract?:{address:Hex;sourceSha256:string;runtimeCodeHash:Hex;abiSha256:string}|null;
}
export interface PendingOperation {
  id:string;workspaceId:string;actionId:EnabledOperationId;fields:Record<string,string>;
  stage:'prepared'|'wallet-requested'|'signed'|'broadcast'|'finalized'|'failed'|'unknown'|'stale';
  title:string;description:string;action:NativeAction;innerAction:NativeAction;
  envelope:FrozenEnvelope;prepared:PreparedSigning;context:ReviewedSigningContext;
  signedAttempt:SignedAttempt|null;signedBytes:Hex|null;receipt:NativeReceipt|null;
  lease:Lease;blockers:string[];signer:string;phase:'direct'|'multisig_first'|'multisig_final'|'cancel';
  route:string[];resources:{label:string;amount:string;payer:string}[];
  runScope:string|null;
}
