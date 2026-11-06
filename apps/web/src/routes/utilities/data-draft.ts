import type { PackageImportPreview, WorkspaceInput } from "../../ui-contract";

export interface DataDraft {
  contents: string;
  fileName: string;
  preview: PackageImportPreview | null;
  workspaceInput: Partial<WorkspaceInput>;
  targetWorkspaceId: string;
  membersInput: string;
  reviewersInput: string;
  replacementInput: string;
  beneficiaryChoice: "" | "existing" | "none";
  grantChoice: "" | "existing" | "none";
  replacementChoice: "" | "planned" | "none";
}

export function createDataDraft(): DataDraft {
  return {
    contents: "",
    fileName: "",
    preview: null,
    workspaceInput: {},
    targetWorkspaceId: "",
    membersInput: "",
    reviewersInput: "",
    replacementInput: "",
    beneficiaryChoice: "",
    grantChoice: "",
    replacementChoice: "",
  };
}

export interface DataDraftControls {
  draft: DataDraft;
  onDraftChange(change: Partial<DataDraft>): void;
  onConnectNetwork(): void;
}
