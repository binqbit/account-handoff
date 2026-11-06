import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  KeyValues,
  Notice,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";
import type { AppCommand } from "../../ui-contract";
import { createDataDraft, type DataDraftControls } from "./data-draft";
import { DataReview } from "./data-review";

export function Data(props: ScreenProps & DataDraftControls) {
  const { snapshot, run, navigate, draft, onDraftChange } = props;
  const { contents, fileName, preview } = draft;
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [applying, setApplying] = useState(false);
  const inputVersion = useRef(0);
  useEffect(
    () => () => {
      inputVersion.current += 1;
    },
    [],
  );
  const maxSize = 5 * 1024 * 1024;
  async function loadFile(file: File | undefined) {
    if (!file) return;
    const version = ++inputVersion.current;
    setError("");
    onDraftChange({ ...createDataDraft(), contents });
    setReading(false);
    if (file.size > maxSize) {
      setError("The package exceeds 5 MiB. The file was not read.");
      return;
    }
    setReading(true);
    try {
      const nextContents = await file.text();
      if (inputVersion.current !== version) return;
      onDraftChange({ contents: nextContents, fileName: file.name });
    } catch {
      if (inputVersion.current === version)
        setError("Could not read the file.");
    } finally {
      if (inputVersion.current === version) setReading(false);
    }
  }
  async function inspect(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (new TextEncoder().encode(contents).length > maxSize) {
      setError("The package exceeds 5 MiB.");
      return;
    }
    const version = inputVersion.current;
    setReviewing(true);
    try {
      const outcome = await run({ type: "inspect-package", contents });
      if (inputVersion.current !== version) return;
      const nextPreview = outcome.succeeded
        ? outcome.result?.importPreview
        : undefined;
      if (outcome.succeeded && nextPreview) {
        onDraftChange({
          preview: nextPreview,
          workspaceInput: structuredClone(nextPreview.workspaceInput ?? {}),
          targetWorkspaceId:
            nextPreview.kind === "evidence"
              ? (nextPreview.matchingWorkspaces[0]?.id ?? "")
              : "",
          membersInput: "",
          reviewersInput: "",
          replacementInput: "",
          beneficiaryChoice: "",
          grantChoice: "",
          replacementChoice: "",
        });
      } else if (outcome.succeeded)
        setError(
          "The package could not be reviewed. Select it again and retry.",
        );
    } finally {
      setReviewing(false);
    }
  }
  async function confirm(
    command: Extract<AppCommand, { type: "import-package" }>,
  ) {
    const version = inputVersion.current;
    setApplying(true);
    try {
      const outcome = await run(command);
      if (outcome.succeeded && inputVersion.current === version) {
        onDraftChange(createDataDraft());
        navigate("overview");
      }
    } finally {
      setApplying(false);
    }
  }
  return (
    <>
      <PageHeader
        icon="download"
        eyebrow="Workspace data"
        title="Restore or back up a workspace"
        description="Review a package, then explicitly restore its public workspace configuration and unsigned evidence. Wallet access, signed transactions and endpoints are excluded."
      />
      <div className="equal-grid">
        <div>
          <Card title="Choose a package" eyebrow="Step 1 of 2">
            <form onSubmit={(event) => void inspect(event)}>
              <input
                type="file"
                ref={fileInput}
                tabIndex={-1}
                accept="application/json,.json"
                className="sr-only"
                disabled={applying}
                aria-label="Choose a JSON package"
                onChange={(event) => void loadFile(event.target.files?.[0])}
              />
              <Button
                type="button"
                icon="upload"
                disabled={applying}
                onClick={() => fileInput.current?.click()}
              >
                Choose a JSON file
              </Button>
              {fileName && <p className="muted">{fileName}</p>}
              {reading && <p role="status">Reading the selected package…</p>}
              <div className="field">
                <label htmlFor="import-json">Or paste JSON</label>
                <textarea
                  id="import-json"
                  rows={10}
                  value={contents}
                  disabled={applying}
                  onChange={(event) => {
                    inputVersion.current += 1;
                    setError("");
                    onDraftChange({
                      ...createDataDraft(),
                      contents: event.target.value,
                    });
                    setReading(false);
                  }}
                  placeholder="Workspace backup or unsigned evidence JSON"
                  spellCheck={false}
                />
                <p className="field__help">
                  Up to 5 MiB. Unsupported versions, conflicting records and
                  signed payloads are rejected. Reviewing a file does not save
                  it.
                </p>
              </div>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <Button
                variant="primary"
                type="submit"
                icon="shield"
                disabled={reading || !contents.trim() || reviewing || applying}
              >
                {reviewing ? "Reviewing package…" : "Review package"}
              </Button>
            </form>
          </Card>
          {preview && (
            <DataReview {...props} onConfirm={confirm} applying={applying} />
          )}
        </div>
        <div>
          <Card
            title="Back up the current workspace"
            eyebrow="Signed payloads excluded"
          >
            <p className="muted">
              Save the public workspace configuration and unsigned evidence so
              another browser can restore it. Signatures and wallet access
              remain in this browser.
            </p>
            <KeyValues
              rows={[
                {
                  label: "Workspace",
                  value: snapshot.workspace?.name ?? "Not selected",
                },
                { label: "Environment", value: snapshot.network.mode },
                { label: "Signed transactions", value: "Excluded" },
              ]}
            />
            <Button
              variant="primary"
              icon="download"
              disabled={!snapshot.workspace || !!snapshot.busy}
              onClick={() => void run({ type: "export-package" })}
            >
              Download package
            </Button>
          </Card>
          <Notice title="Local data does not cancel on-chain actions">
            Deleting or transferring a file does not cancel native proposals or
            revoke existing signatures.
          </Notice>
        </div>
      </div>
    </>
  );
}
