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
      setError("Пакет перевищує 5 MiB. Файл не прочитано.");
      return;
    }
    try {
      setContents(await file.text());
      setFileName(file.name);
    } catch {
      setError("Не вдалося прочитати файл.");
    }
  }
  async function inspect(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (new TextEncoder().encode(contents).length > maxSize) {
      setError("Пакет перевищує 5 MiB.");
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
        eyebrow="Дані простору"
        title="Передайте контекст між пристроями"
        description="Пакет містить дані й докази для незалежної перевірки. Підписи, endpoint та локальні дозволи не передаються."
      />
      <div className="equal-grid">
        <Card title="Імпортувати пакет" eyebrow="Спочатку перевірка">
          <form onSubmit={(event) => void inspect(event)}>
            <input
              type="file"
              ref={fileInput}
              accept="application/json,.json"
              className="sr-only"
              aria-label="Вибрати JSON-пакет"
              onChange={(event) => void loadFile(event.target.files?.[0])}
            />
            <Button
              type="button"
              icon="upload"
              onClick={() => fileInput.current?.click()}
            >
              Вибрати JSON-файл
            </Button>
            {fileName && <p className="muted">{fileName}</p>}
            <div className="field">
              <label htmlFor="import-json">Або вставте JSON</label>
              <textarea
                id="import-json"
                rows={10}
                value={contents}
                onChange={(event) => {
                  setContents(event.target.value);
                  setInspected(false);
                }}
                placeholder="Вміст unsigned-пакета"
                spellCheck={false}
              />
              <p className="field__help">
                До 5 MiB. Непідтримувані версії, конфліктні записи та підписані
                пакети відхиляються або ізолюються.
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
              Перевірити та імпортувати
            </Button>
            {inspected && (
              <p className="field__help">
                Результат перевірки показано в повідомленні. Поточні мережеві
                факти потребують окремого оновлення.
              </p>
            )}
          </form>
        </Card>
        <div>
          <Card
            title="Експортувати поточний простір"
            eyebrow="Без підписаних пакетів"
          >
            <p className="muted">
              Експорт збере пов’язані записи й докази. Локальні підписи та
              службові дані гаманця залишаться в цьому браузері.
            </p>
            <KeyValues
              rows={[
                {
                  label: "Простір",
                  value: snapshot.workspace?.name ?? "Не обрано",
                },
                { label: "Середовище", value: snapshot.network.mode },
                { label: "Підписані транзакції", value: "Не включаються" },
              ]}
            />
            <Button
              variant="primary"
              icon="download"
              disabled={!snapshot.workspace || !!snapshot.busy}
              onClick={() => void run({ type: "export-package" })}
            >
              Завантажити пакет
            </Button>
          </Card>
          <Notice title="Локальні дані не скасовують on-chain дії">
            Видалення або передача файлу не скасовує native-пропозиції та не
            відкликає вже наданих підписів.
          </Notice>
        </div>
      </div>
    </>
  );
}
