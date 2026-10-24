# Actual LOCAL browser integration

This suite drives the built React application through a real local native node. Its server runs the production build with Vite preview. Its test-only injected wallet keeps disposable development keys in the Node test process and returns native signatures through the application's ordinary signature-only wallet boundary. No keyring or signer is imported by the shipped browser entrypoint.

Use a dedicated fresh LOCAL run because the handoff test changes native authority and submits milestone 1. The first two tests read state or deliberately reject a signature; they do not consume the baseline. The final test creates another workspace and Pure through the actual setup interface. A prior CLI handoff is not a suitable starting state for the baseline scenarios. The separate setup scenario uses a new Pure and namespaced grant-role accounts, so it can run independently on the qualified retained node.

## Prepare a dedicated baseline

After the pinned runtime artifacts have been built, these commands establish a separate run. Run `local:plan` only when that run ID does not already exist:

```bash
npm run local:plan -- --run browser --native-port 9955 --gateway-port 8555 --peer-port 29955
npm run local:up -- --run browser
npm run local:qualify -- --run browser
npm run local:deploy -- --run browser
npm run local:seed -- --run browser
```

The required inputs are `.local-state/browser/workspace.json` and its qualified `native-metadata-binding.json`. The native node must permit the explicit loopback frontend origin `http://127.0.0.1:4175`. The active `apps/web/public/local-run.json` descriptor must refer to the same run and generation. Keep the first vested milestone and M0-only baseline intact before the browser suite.

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
4. A separate workspace with Pure index 1 and new, initially unmapped funder/reviewer accounts. Twenty-seven signatures exercise funding, Pure creation, mapping, grant creation, initial submission, both reviewer approvals and the complete handoff followed by a second controller change on the same Pure and grant. Native reads independently verify the resulting mappings, grant states, vesting lock and authority. The second handoff does not create or resubmit a milestone. All state-changing calls still originate from the application's explicit review/sign/send controls.

Results and failure traces are written to `.agent-workspace/verification/local-browser/current/`. Retained earlier attempts are stored beside that directory. Screenshots show the actual LOCAL interface. Test-only signer results do not qualify the behavior of a separately installed SubWallet extension or another network.

If interrupted, inspect retained application/native attempts and reconcile them before any new run. Do not rerun the full mutation test as an automatic retry: it requires M0-only authority and an unsubmitted milestone 1. Ordinary stop/start preserves state. A new isolated run is preferable for another independent full scenario.

To run only the independent setup and repeated-handoff journey on an already qualified retained node:

```bash
AH_LOCAL_BROWSER=1 AH_LOCAL_BROWSER_RUN=browser \
  ./node_modules/.bin/playwright test --config tests/integration/local/playwright.config.ts \
  --grep 'creates a separate Pure'
```

This journey creates new test data without resetting existing state. Its reported `setup-namespace` identifies the disposable development grant-role accounts for that attempt. An interrupted native operation still requires inspection and reconciliation before another attempt.
