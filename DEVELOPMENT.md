# Develop and run Account Handoff

Account Handoff is a static React/TypeScript application with a native wallet boundary, a deterministic operation core, and an IndexedDB journal. The supported local integration route runs a pinned, narrowly modified upstream native node, its matching Revive gateway, and unchanged Vestry. LOCAL, PortalDot DEMO, and LIVE mainnet have separate identities and qualification requirements.

## Install and run the website

Use the exact Node version in [.node-version](.node-version) and the committed npm lockfile. Install dependencies from the repository root:

```bash
npm ci --ignore-scripts
npm run doctor
npm run dev
```

Open `http://127.0.0.1:5173`. The website starts with locally retained records or an empty workspace. Opening it does not create accounts, seed a chain, connect a wallet, or submit a transaction. The network page selects the native WebSocket endpoint; the wallet button separately requests access to personal native accounts.

Build and inspect the production assets with:

```bash
npm run build
npm run preview -- --port 4174
```

Static assets are emitted to `dist/`. Reserve port 4173 for browser tests and 4175 for the dedicated real-LOCAL browser suite.

## Run checks

```bash
npm run typecheck
npm test
npm run build
npm run format:check
```

`npm test` runs offline domain, contract, adapter, journal, and local-tool boundary tests. It does not start a native node or use a remote endpoint. `npm run check` combines type checking, offline tests, and the production build.

The real browser suite uses the actual application for startup checks and an explicitly isolated test facade for controlled UI states:

```bash
./node_modules/.bin/playwright install chromium
npm run test:browser
```

The runner uses `CHROME_PATH` when explicitly set, otherwise a detected system Chrome/Chromium or the Playwright-managed browser. To select the managed executable explicitly:

```bash
CHROME_PATH="$(node --input-type=module -e "import { chromium } from '@playwright/test'; console.log(chromium.executablePath())")" \
  npm run test:browser
```

Browser checks cover explicit prepare/sign/send boundaries, account changes, input limits, keyboard interaction, narrow layouts, and automated accessibility. Their test facade is never imported by the production entrypoint. An installed wallet extension still needs its own qualification; the native integration suite uses a separately identified development wallet bridge.

## Module ownership

| Location                         | Responsibility                                                                                            |
| -------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `packages/domain/`               | Canonical identity, units, funding rules, supported operations, and pure policy                           |
| `packages/contracts/`            | Executable record schemas, generated validators, canonical digests, bounded import/export                 |
| `packages/native-adapter/`       | Dedot native encoding, exact signatures, finalized reads, runtime identities, and transaction observation |
| `packages/grant-adapter/`        | Unchanged Vestry ABI, direct/beneficiary origins, and ordered grant history                               |
| `packages/wallet-adapter/`       | Explicit native wallet discovery and strict signature-only response verification                          |
| `packages/evidence/`             | Layered receipt and continuity verification                                                               |
| `packages/local-store/`          | Atomic IndexedDB records, progress, references, and local lease ownership                                 |
| `apps/web/src/application/`      | User commands, operation coordination, proof reconstruction, and display projections                      |
| `apps/web/src/routes/`           | The four workspace destinations and contextual setup/review/data/network views                            |
| `scripts/local/`, `infra/local/` | Reproducible native environment, deployment, seed, recovery, and lifecycle tools                          |

The application coordinator owns side effects. View components do not call native RPC, a wallet signer, or the journal directly. A reviewed call remains immutable while the coordinator records approvals, attempts, and evidence separately. A local record cannot establish chain authority.

## Build the real LOCAL runtime

The [runtime lock](infra/local/runtime.lock.json) pins upstream source, patch, Cargo lock, native toolchains, and unchanged contract source. The integrated host launcher supports Linux; process ownership checks use `/proc`.

Required host tools are Git, the pinned Rust/Cargo toolchain, rustup with the separate runtime-WASM toolchain and `wasm32v1-none`, Clang/libclang, CMake, pkg-config, protobuf, OpenSSL, and zlib. Read the exact versions from the runtime lock. The outer native compiler and nested runtime-WASM compiler are intentionally pinned separately. On NixOS, `local:build` uses the pinned nixpkgs input and [shell.nix](infra/local/shell.nix) for C/C++ dependencies; it does not change OS configuration.

```bash
npm run doctor -- --local
npm run local:build
```

The build fetches only the locked source revision, verifies the Cargo lock and reviewed patch, then builds `substrate-node` and `eth-rpc`. It records executable/runtime hashes in `artifacts/local/build.json`. Source/build caches and compiler logs remain in `.agent-workspace/local-runtime/`; changing the patch or lock requires another verified build.

Create a dedicated run, start the two real processes, and qualify their identity:

```bash
npm run local:plan -- --run development
npm run local:up -- --run development
npm run local:qualify -- --run development
npm run generate:native -- development
npm run local:refresh-descriptor -- --run development
```

`local:plan` is a one-time run allocation; it rejects an existing run ID. `local:up` preserves existing native/gateway state. Qualification captures finalized metadata, runtime code, units, and gateway alignment. Native type generation reads the captured metadata rather than querying an arbitrary endpoint during a frontend build. The active local descriptor is served as `local-run.json`; it binds the website to one run and generation.

The LOCAL descriptor also supplies the exact qualified decoder metadata and its source block. The client uses that pinned blob only while genesis, spec version and runtime code match; it continues reading balances, fees and contract state from the requested RPC block. Metadata provenance and live-state anchors are separate because this upstream runtime embeds a changing EVM fee in one metadata storage default. See the [LOCAL metadata binding](packages/contracts/schema/LOCAL-AMENDMENT.md) for the byte-exact convention and refusal conditions.

Deploy and verify the unchanged contract, then create the controlled grant baseline:

```bash
npm run local:deploy -- --run development
npm run local:seed -- --run development
```

These are explicit local transactions. The seed creates P through M0, funds operating accounts, establishes persistent mapping, creates the grant for h(P), and releases the first vested milestone. Each stage retains its own attempt and receipt; it learns P and the grant ID from actual finalized events. `.local-state/development/workspace.json` is the local workspace import for the website. Import verifies its original Pure and grant provenance against the selected runtime.

The host launcher is the integrated path for application/deployment/seed tooling. [Compose](infra/local/compose.yaml) provides an alternate container process definition for the same pinned node/gateway source. Container state and host PID/state management are different: use one process owner for a given port set, and keep Compose volumes separate from host runs. The [LOCAL environment guide](infra/local/README.md) documents container build/start and ownership boundaries.

## Exercise the complete native mechanism

For the CLI-owned fixture:

```bash
npm run local:handoff -- --run development
npm run local:test -- --run development
```

`local:handoff` adds M1 with A/B, removes only M0/Any/0 with A/D, and performs a separate A/D next-milestone submission. `local:test` runs seed, handoff, and an old-controller rejection scenario. Existing completed seed stages are reused; an uncertain attempt stops for reconciliation rather than silently creating another transaction.

Use a separate fresh run for the browser-driven mutation suite. Its [operator instructions](tests/integration/local/README.md) cover dedicated ports, baseline preparation, explicit opt-in, and evidence output. Do not run CLI handoff first on the browser suite's baseline.

A LOCAL result proves behavior of the identified modified upstream runtime. PortalDot DEMO and LIVE require independent runtime, contract, wallet, and evidence qualification. No default CI job connects to those networks or uses participant funds.

## Restart, recover, and reset

Ordinary restarts preserve state:

```bash
npm run local:status -- --run development
npm run local:stop -- --run development
npm run local:up -- --run development
```

Use the website's reconciliation action for an uncertain browser attempt. Use `npm run local:reconcile -- --run development` for CLI seed/handoff attempts. They are different journals; neither command automatically signs a replacement. Preserve the exact attempt, nonce, proposal incarnation, and available receipt before deciding the next action.

Reset is an explicit destructive command for that run's native/gateway state:

```bash
npm run local:status -- --run development
npm run local:reset -- --run development --generation 1
```

Replace `1` with the current generation reported by status. The reset refuses a mismatch, symlinked state, or active native operation. It preserves old deployment/seed evidence, increments the generation, and invalidates the previous local descriptor. Browser records and wallet storage are retained. Start, qualify, deploy, and seed the new generation explicitly before using it.

## Contract and schema maintenance

```bash
npm run generate:contracts
npm run compile:contract
```

Generated validators come from the schemas in `packages/contracts/schema/`; do not edit generated output. Wire DTOs and semantic checks must stay consistent with those schemas. Vestry compilation verifies the attributed source hash and locked Solidity compiler/settings before writing `contracts/artifacts/Vestry.json`. Preserve [the third-party license](contracts/LICENSE.Vestry) and source provenance.

CI regenerates both outputs and rejects an unexplained Git diff. It also loads the validators as native ES modules, so a test-runner compatibility layer cannot conceal an invalid browser/Node import.

## Continuous integration

The [verification workflow](.github/workflows/ci.yml) installs the exact Node release and npm lock without lifecycle scripts, checks formatting and generated artifacts, runs TypeScript/offline tests, and builds the static client. A separate job installs the pinned Playwright Chromium and runs browser/accessibility checks. GitHub actions are pinned to immutable commits and receive read-only repository permissions.

CI does not substitute an offline fixture result for native execution. Complete LOCAL integration is an explicit operator run with its own source/runtime/deployment identity and receipts. `artifacts/` contains regenerable test output; `.local-state/` contains retained local process state. Neither directory belongs in source commits.
