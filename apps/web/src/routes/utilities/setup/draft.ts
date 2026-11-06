import type { WorkspaceInput } from "../../../ui-contract";

export interface WorkspaceSetupDraft {
  mode: "create" | "connect";
  name: string;
  members: string[];
  membersInput: string;
  controllerAddress: string;
  funder: string;
  reviewers: string[];
  reviewersInput: string;
  existing: Partial<WorkspaceInput>;
}

export function createWorkspaceSetupDraft(): WorkspaceSetupDraft {
  return {
    mode: "create",
    name: "",
    members: [],
    membersInput: "",
    controllerAddress: "",
    funder: "",
    reviewers: [],
    reviewersInput: "",
    existing: {},
  };
}

export interface SetupDraftControls {
  draft: WorkspaceSetupDraft;
  onDraftChange(change: Partial<WorkspaceSetupDraft>): void;
  onDraftReset(): void;
  onConnectNetwork(): void;
}
