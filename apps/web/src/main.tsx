import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createApplication } from "./application/application";
const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
createApplication()
  .then((application) =>
    createRoot(root).render(<App application={application} />),
  )
  .catch((error) => {
    root.replaceChildren();
    const message = document.createElement("p");
    message.textContent = `Не вдалося відкрити локальний журнал: ${error instanceof Error ? error.message : String(error)}`;
    root.append(message);
  });
