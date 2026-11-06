import { deployment } from "../config/deployment";
import type { ApplicationFacade } from "../ui-contract";

/** Connect the testnet build after rendering; wallet access remains explicit. */
export function connectTestnetAtStartup(
  application: Pick<ApplicationFacade, "dispatch">,
): void {
  if (!deployment.isTestnet) return;
  void application
    .dispatch({
      type: "connect-network",
      mode: "DEMO",
      endpoint: deployment.defaultEndpoint,
    })
    .catch(() => {
      // The coordinator retains the connection error and notice for the interface.
    });
}
