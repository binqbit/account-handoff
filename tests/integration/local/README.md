# Actual LOCAL browser integration

This suite drives the actual React application through a real local native node. Its server uses the development build; production asset checks run separately. Its test-only injected wallet keeps disposable development keys in the Node test process and returns native signatures through the application's ordinary signature-only wallet boundary. No keyring or signer is imported by the shipped browser entrypoint.

Use a dedicated fresh LOCAL run because the final test changes native authority and submits milestone 1. The earlier tests read state or deliberately reject a signature; they do not consume the baseline. A prior CLI handoff is not a suitable starting state.

## Prepare a dedicated baseline

After the pinned runtime artifacts have been built, these commands establish a separate run. Run `local:plan` only when that run ID does not already exist:

```bash
npm run local:plan -- --run browser --native-port 9955 --gateway-port 8555 --peer-port 29955
npm run local:up -- --run browser
npm run local:qualify -- --run browser
npm run local:deploy -- --run browser
npm run local:seed -- --run browser
```

The required input is `.local-state/browser/workspace.json`. The native node must permit the explicit loopback frontend origin `http://127.0.0.1:4175`. The active `apps/web/public/local-run.json` descriptor must refer to the same run and generation. Keep the first vested milestone and M0-only baseline intact before the browser suite.

## Execute

```bash
AH_LOCAL_BROWSER=1 AH_LOCAL_BROWSER_RUN=browser \
  ./node_modules/.bin/playwright test --config tests/integration/local/playwright.config.ts
```

The opt-in environment variable prevents accidental local transactions during ordinary offline checks. Selecting another run requires its own matching workspace export and active descriptor. The suite rejects nonlocal RPC, mismatched genesis/runtime/signed extensions and unknown test signers.

The suite verifies:

1. Actual workspace import, six task routes, automated accessibility and zero wallet signatures during observation.
2. Explicit wallet rejection, no signed result and unchanged native proxy state.
3. Six deliberate signatures: A/B add M1, A/D remove M0, then separate A/D milestone-1 submission. The test reads actual proxy inventory, persistent mapping and grant state after those operations, checks the website's history, and verifies that reload does not sign again.

Results and failure traces are written to `artifacts/local-browser/`. Screenshots show the actual LOCAL interface. Test-only signer results do not qualify the behavior of a separately installed SubWallet extension or another network.

If interrupted, inspect retained application/native attempts and reconcile them before any new run. Do not rerun the full mutation test as an automatic retry: it requires M0-only authority and an unsubmitted milestone 1. Ordinary stop/start preserves state. A new isolated run is preferable for another independent full scenario.
