# Actual LOCAL browser integration

This suite drives the built React application through a real local native node. Its server runs the production build with Vite preview. Its test-only injected wallet keeps disposable development keys in the Node test process and returns native signatures through the application's ordinary signature-only wallet boundary. No keyring or signer is imported by the shipped browser entrypoint.

Use a dedicated fresh LOCAL run because the handoff test changes native authority and submits milestone 1. The observation, wallet-rejection and signed-reload tests do not submit transactions. The cancellation test opens and then cancels one proposal, preserving the original authority. The final test creates another workspace and Pure through the actual setup interface. A prior CLI handoff is not a suitable starting state for the baseline scenarios. The separate setup scenario uses a new Pure and namespaced grant-role accounts, so it can run independently on the qualified retained node.

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

1. Actual workspace import, account switching, six task routes, automated accessibility and zero wallet signatures during observation. The native proxy inventory stays unchanged while the selected wallet account changes.
2. Explicit wallet rejection, no signed result and unchanged native proxy state.
3. One signed but unsubmitted operation. A cloned tab cannot acquire its lease; reloading the original tab restores the exact signed review without another signature or broadcast. The signer's native nonce remains unchanged.
4. Two explicit signatures open and cancel a native proposal. The actual depositor receives the exact reserved deposit back, the proposal disappears, and beneficiary authority stays unchanged.
5. Six deliberate signatures: A/B add M1, A/D remove M0, then separate A/D milestone-1 submission. The test reads actual proxy inventory, persistent mapping and grant state after those operations, checks the website's history, and verifies that reload does not sign again.
6. A separate workspace with Pure index 1 and new, initially unmapped funder/reviewer accounts. Thirty signatures exercise funding, Pure creation, mapping, grant creation, initial submission, both reviewer approvals, the complete handoff, a second controller change on the same Pure and grant, and the second milestone's payout. The test grant uses 10 + 0.1 native tokens and 50 actual chain blocks of vesting, so it can verify final vesting completion without changing production defaults or advancing a fake clock. Native reads verify the resulting mappings, both released milestones, exact second payout, cleared vesting schedule and unchanged authority. Duplicate payout and resubmission must fail in native dry-runs. Reload must not sign again. All state-changing calls originate from the application's explicit review/sign/send controls.

Together these scenarios exercise all fourteen supported action IDs. They do not enable the original contract's unsupported asset, metric-gate, reopened-review or deadline-reclaim workflows.

The complete journey performs vesting maintenance in the original workspace after the first verified handoff and continuation, before the next handoff and address-only reconnection. This preserves the required historical proof for maintenance. Reconnecting a Pure/grant verifies addresses and creation provenance; it does not import a continuity certificate. The test checks that such a workspace cannot prepare maintenance without that proof, while its reviewers can complete the grant's remaining payout.

Results and failure traces are written to `.agent-workspace/verification/local-browser/current/`. Retained earlier attempts are stored beside that directory. Screenshots show the actual LOCAL interface. Test-only signer results do not qualify the behavior of a separately installed SubWallet extension or another network.

Failure traces retain screenshots, source and action timing. DOM/network snapshots are disabled for this native suite because repeated runtime-metadata RPC responses can produce multi-gigabyte recordings. Canonical metadata bindings, native receipts, wallet requests and failure storage state are retained separately.

Set `AH_LOCAL_BROWSER_OUTPUT` to a separate path under `.agent-workspace/verification/` to preserve earlier reports while running a new verification. Each completed mutation scenario also compares every journaled receipt hash and extrinsic index with the finalized native chain and attaches the resulting records.

If interrupted, inspect retained application/native attempts and reconcile them before any new run. Do not rerun the full mutation test as an automatic retry: it requires M0-only authority and an unsubmitted milestone 1. Ordinary stop/start preserves state. A new isolated run is preferable for another independent full scenario.

To run only the independent setup and repeated-handoff journey on an already qualified retained node:

```bash
AH_LOCAL_BROWSER=1 AH_LOCAL_BROWSER_RUN=browser \
  ./node_modules/.bin/playwright test --config tests/integration/local/playwright.config.ts \
  --grep 'creates a separate Pure'
```

This journey creates new test data without resetting existing state. Its reported `setup-namespace` identifies the disposable development grant-role accounts for that attempt. An interrupted native operation still requires inspection and reconciliation before another attempt.
