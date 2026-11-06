import { createRoot } from "react-dom/client";
import { App } from "./App";
import { createApplication } from "./application/application";
import { connectTestnetAtStartup } from "./application/startup-connection";
const root = document.getElementById("root");
if (!root) throw new Error("Application root is missing");
createApplication()
  .then((application) => {
    createRoot(root).render(<App application={application} />);
    const stopConnection = connectTestnetAtStartup(application);
    import.meta.hot?.dispose(stopConnection);
  })
  .catch((error) => {
    root.replaceChildren();
    const message = document.createElement("p");
    message.textContent = `Could not open the local journal: ${error instanceof Error ? error.message : String(error)}`;
    root.append(message);
  });
