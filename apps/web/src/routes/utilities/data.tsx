import { useRef, useState, type FormEvent } from "react";
import {
  Button,
  Card,
  KeyValues,
  Notice,
  PageHeader,
} from "../../components/ui";
import type { ScreenProps } from "../screen-types";

export function Data(props: ScreenProps) {
  const { snapshot, run } = props;
  const [contents, setContents] = useState("");
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [inspected, setInspected] = useState(false);
  const maxSize = 5 * 1024 * 1024;
  async function loadFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setInspected(false);
    if (file.size > maxSize) {
      setError("The package exceeds 5 MiB. The file was not read.");
      return;
    }
    try {
      setContents(await file.text());
      setFileName(file.name);
    } catch {
      setError("Could not read the file.");
    }
  }
  async function inspect(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (new TextEncoder().encode(contents).length > maxSize) {
      setError("The package exceeds 5 MiB.");
      return;
    }
    try {
      await run({ type: "import-package", contents });
      setInspected(true);
    } catch {
      setInspected(false);
    }
  }
  return (
    <>
      <PageHeader
        eyebrow="Workspace data"
        title="Transfer context between devices"
        description="The package contains data and evidence for independent verification. Signatures, endpoints and local permissions are excluded."
      />
      <div className="equal-grid">
        <Card title="Import a package" eyebrow="Verify first">
          <form onSubmit={(event) => void inspect(event)}>
            <input
              type="file"
              ref={fileInput}
              accept="application/json,.json"
              className="sr-only"
              aria-label="Choose a JSON package"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
            <Button
              type="button"
              icon="upload"
              onClick={() => fileInput.current?.click()}
            >
              Choose a JSON file
            </Button>
            {fileName && <p className="muted">{fileName}</p>}
            <div className="field">
              <label htmlFor="import-json">Or paste JSON</label>
              <textarea
                id="import-json"
                rows={10}
                value={contents}
                onChange={(event) => {
                  setContents(event.target.value);
                  setInspected(false);
                }}
                placeholder="Unsigned package contents"
                spellCheck={false}
              />
              <p className="field__help">
                Up to 5 MiB. Unsupported versions, conflicting records and
                signed packages are rejected or quarantined.
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
              disabled={!contents.trim() || !!snapshot.busy}
            >
              Verify and import
            </Button>
            {inspected && (
              <p className="field__help">
                The notification shows the validation result. Current network
                facts require a separate refresh.
              </p>
            )}
          </form>
        </Card>
        <div>
          <Card
            title="Export the current workspace"
            eyebrow="Signed payloads excluded"
          >
            <p className="muted">
              Export collects related records and evidence. Local signatures and
              wallet metadata remain in this browser.
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
