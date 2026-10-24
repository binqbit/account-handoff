/** Display-only projections. Authority is established by the application coordinator. */
export type RuntimeMode = "LOCAL" | "DEMO" | "LIVE";
export type Tone = "positive" | "warning" | "negative" | "neutral";
export type Destination =
  | "overview"
  | "milestones"
  | "team"
  | "history"
  | "workspaces"
  | "setup"
  | "handoff"
  | "review"
  | "network"
  | "data"
  | "attention";
export interface IdentityView {
  address: string;
  label?: string;
  mappedAddress?: string | null;
}
export interface WalletAccountView extends IdentityView {
  name?: string;
  source: string;
  role?: string;
}
export interface ControllerView extends IdentityView {
  threshold: number;
  members: IdentityView[];
  active: boolean | null;
}
export interface ReadinessView {
  id: string;
  label: string;
  status: "ready" | "blocked" | "unknown" | "checking";
  detail: string;
}
export interface NetworkView {
  mode: RuntimeMode;
  name: string;
  endpoint: string;
  connected: boolean;
  checking: boolean;
  genesis?: string | null;
  blockNumber?: string | null;
  blockHash?: string | null;
  runtimeVersion?: string | null;
  runId?: string | null;
  updatedAt?: string | null;
  readiness: ReadinessView[];
  error?: string | null;
}
export interface BalanceView {
  identity: IdentityView;
  role: string;
  free: string | null;
  reserved: string | null;
  frozen?: string | null;
  available: string | null;
  symbol: string;
  mapping: "verified" | "missing" | "unknown" | "not-required";
}
export interface MilestoneView {
  id: string;
  index: number;
  title: string;
  amount: string;
  symbol: string;
  state: "Open" | "Submitted" | "Released" | "Reclaimed" | "Unknown";
  round: string | null;
  deadline?: string | null;
  vesting?: string | null;
  evidence?: string | null;
  approvals: string[] | null;
  approvalCount?: number | null;
  requiredApprovals: number;
  actions: string[];
}
export interface HistoryEntryView {
  id: string;
  title: string;
  timestamp?: string | null;
  block?: string | null;
  txHash?: string | null;
  state: string;
  tone: Tone;
  detail: string;
  layers?: { label: string; value: string; tone?: Tone }[];
  evidence?: Record<string, unknown>;
  unresolved?: boolean;
  operationId?: string;
}
export interface WorkspaceView {
  id: string;
  name: string;
  createdAt?: string;
  beneficiary: IdentityView | null;
  oldController: ControllerView;
  newController: ControllerView;
  contract: string | null;
  grantId: string | null;
  authority: "M0" | "DualControl" | "M1" | "Diverged" | "Unknown";
  continuity: "not-started" | "rotated" | "continued" | "drift" | "unknown";
  continuityDetail: string;
  symbol: string;
  grantTotal: string | null;
  milestones: MilestoneView[];
  balances: BalanceView[];
  history: HistoryEntryView[];
  funder: IdentityView | null;
  reviewers: IdentityView[];
  setupProgress: ReadinessView[];
  currentTask: {
    title: string;
    detail: string;
    actionId?: string;
    destination?: Destination;
  };
}
export interface OperationField {
  name: string;
  label: string;
  type: "text" | "textarea" | "number" | "select";
  help?: string;
  placeholder?: string;
  required?: boolean;
  value?: string;
  readOnly?: boolean;
  options?: { value: string; label: string }[];
  maxBytes?: number;
}
export interface ActionView {
  id: string;
  title: string;
  description: string;
  category:
    "setup" | "funding" | "grant" | "handoff" | "maintenance" | "recovery";
  actor: string;
  enabled: boolean;
  blockers: string[];
  fields: OperationField[];
}
export interface OperationView {
  id: string;
  actionId: string;
  title: string;
  description: string;
  stage: string;
  tone: Tone;
  actor: string;
  signer: IdentityView | null;
  route: string[];
  consequences: string[];
  terms: { label: string; value: string }[];
  resources: { label: string; amount: string; payer: string }[];
  blockers: string[];
  callHex?: string | null;
  callHash?: string | null;
  txHash?: string | null;
  approvals?: {
    approved: string[];
    required: number;
    depositor?: string | null;
    timepoint?: string | null;
  } | null;
  canSign: boolean;
  canSend: boolean;
  canReconcile: boolean;
  canDiscard: boolean;
  evidence?: Record<string, unknown>;
}
export interface AppSnapshot {
  revision: number;
  network: NetworkView;
  wallet: {
    connected: boolean;
    connecting: boolean;
    accounts: WalletAccountView[];
    selectedAddress: string | null;
    source?: string | null;
    error?: string | null;
  };
  workspaces: { id: string; name: string; mode: RuntimeMode }[];
  workspace: WorkspaceView | null;
  actions: ActionView[];
  operation: OperationView | null;
  busy: string | null;
  notice?: { id: string; message: string; tone: Tone } | null;
  storageError?: string | null;
}
export interface WorkspaceInput {
  name: string;
  oldMembers: string[];
  newMembers: string[];
  threshold: number;
  funder: string;
  reviewers: string[];
  beneficiary?: string;
  contract?: string;
  grantId?: string;
}
export type AppCommand =
  | { type: "connect-wallet" }
  | { type: "disconnect-wallet" }
  | { type: "select-account"; address: string }
  | { type: "connect-network"; mode: RuntimeMode; endpoint: string }
  | { type: "refresh" }
  | { type: "select-workspace"; id: string }
  | { type: "create-workspace"; input: WorkspaceInput }
  | {
      type: "prepare-operation";
      actionId: string;
      fields: Record<string, string>;
      expectedRevision: number;
    }
  | { type: "sign-operation"; id: string }
  | { type: "send-operation"; id: string }
  | { type: "reconcile-operation"; id: string }
  | { type: "discard-operation"; id: string }
  | { type: "import-package"; contents: string }
  | { type: "export-package" }
  | { type: "dismiss-notice"; id: string };
export interface CommandResult {
  message?: string;
  download?: { name: string; mime: string; contents: string };
}
export interface ApplicationFacade {
  getSnapshot(): AppSnapshot;
  subscribe(listener: () => void): () => void;
  dispatch(command: AppCommand): Promise<CommandResult | void>;
}
