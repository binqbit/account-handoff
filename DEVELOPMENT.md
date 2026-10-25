# Develop and run Account Handoff

Account Handoff is a static React/TypeScript application with a native wallet boundary, a deterministic operation core, and an IndexedDB journal. The supported local integration route runs a pinned, narrowly modified upstream native node, its matching Revive gateway, and unchanged Vestry. LOCAL, PortalDot DEMO, and LIVE mainnet have separate identities and qualification requirements.

## Install and run the website

Use the exact Node version in [.node-version](.node-version) and the committed npm lockfile. Install dependencies from the repository root:

```bash
npm ci --ignore-scripts
npm run doctor
npm run dev
```

Open `http://127.0.0.1:5173`. The website restores local records and reconnects previously selected wallet providers. The selected account is restored only if that same provider still exposes it; no other signer is selected as a fallback. First-time wallet access remains explicit. Disconnect clears the saved connection. The connection preference contains only provider names and the public account address, never keys or permission to sign. Reloading does not create accounts, connect a native node, request a signature or submit a transaction. The network page separately selects the native WebSocket endpoint.

Build and inspect the production assets with:

```bash
npm run build
npm run preview -- --port 4174
```

Static assets are emitted to `dist/`. Reserve port 4173 for browser tests and 4175 for the dedicated real-LOCAL browser suite. If the ordinary browser-test port is occupied, run `AH_BROWSER_PORT=4183 npm run test:browser`. The runner starts its own server and fails on a port conflict instead of reusing an unrelated application.

Run generation and production-build commands before starting the ordinary browser suite. That suite uses Vite's development server; concurrent writes to generated source can reload a page and erase the form state under test. The real-LOCAL suite builds first and then serves the static result.

### PortalDot V3 testnet build

```bash
npm run build:testnet
```

This emits static production files to `dist-testnet/`, with the native endpoint and expected genesis from [infra/testnet/network.json](infra/testnet/network.json). It starts in DEMO mode, rejects another network's genesis and LOCAL/LIVE connection commands, and uses a separate browser journal. Wallet access and network connection remain explicit. The build excludes the host's `local-run.json` and does not load Vite env files. Never ship `.env`, wallet secrets, or LOCAL state with it.

The original, unmodified Vestry is deployed on PortalDot V3 at `0xb8e2d057cf231f265dd6f3841216f4727edad345`. Its deployment finalized in block 189561, and the on-chain runtime matches the pinned artifact byte for byte. [The public deployment record](infra/testnet/vestry-deployment.json) includes the transaction, block, source and bytecode hashes. The native signer was the main account in `TEST_WALLET_0`; no grant or handoff was created during deployment.

The local `.env` stores the public address as `AH_TESTNET_VESTRY_ADDRESS`; [.env.example](.env.example) documents the same value. `infra/testnet/network.json` is the canonical public build configuration. The static build deliberately does not read `.env`, which may also contain wallet secrets.

DEMO loads its own pinned metadata and deployment binding, supports the runtime's automatic account mapping, and verifies the current code before enabling operations. [Runtime verification](infra/testnet/runtime-verification.json) records the exact artifact and capability evidence; missing evidence or a changed runtime blocks preparation. LOCAL source/build evidence is never substituted for PortalDot evidence. A locally executed PortalDot runtime fork does not establish public-network consensus, wallet-extension behavior or a completed testnet journey.

Run the public-network compatibility check without opening a wallet or sending a transaction:

```bash
npm run verify:testnet
```

This checks the pinned profile, live contract code and reads, unsigned call encoding, and native signing-payload preparation. It writes a report under `.agent-workspace/verification/testnet/`. It does not sign or broadcast. The build also verifies the metadata hash, dependency lock and retained adapter-source hashes. Requalify changed runtime artifacts or adapters rather than changing their evidence to a passing status manually.

The [isolated PortalDot integration checks](tests/integration/testnet/README.md) execute the exact testnet runtime locally, then exercise the real DEMO interface against that fork. Test tooling and generated state stay in `.agent-workspace`; they are not production dependencies. Passing compatibility checks does not fund wallets or authorize a public-network run.

Create the standalone archive with `npm run package:testnet` (requires `zip` and `unzip`), or `npm run package:testnet -- /absolute/path/release.zip`. The default output is `private-docs/Account Handoff Testnet.zip` with a SHA-256 sidecar. This command rebuilds the assets, copies only approved static files and startup resources, and records the Git revision and checksums. The extracted package runs with `node serve.mjs` or `docker compose up --build -d` at `http://127.0.0.1:8080`; see [the package instructions](infra/testnet/README.md). Public static hosting uses only the contents of `www/`.

## Website navigation

The default route is **Home**, with a short product explanation and a three-step introduction. **Docs** contains the in-app usage guide and recovery vocabulary. The header keeps Home, Workspaces, Docs and the creation action available; opening a workspace adds its task tabs underneath. Wallet account choices show the name and a compact public address in an accessible custom menu.

## Create or connect a workspace

Connect the native network, then open **New workspace**. **Create multisig** derives the current group's address locally. **Connect existing** checks a supplied multisig address against the same complete membership. Both routes retain the existing two-of-three profile. A replacement group is entered only in **Control handoff**.

An existing Pure and optional grant can be attached using the Pure creation block and transaction hashes. This uses the qualified LOCAL import verification path, including the exact creator, initial and current permissions, persistent mapping and contract history. Saving arbitrary address text does not establish provenance.

After a verified removal, **Start another handoff** reconstructs the native approval/removal evidence before advancing the current controller. Historical grant baseline, creator reserve, receipt references and wallet preferences survive. Closed grants can have their controller changed; a closed milestone is never presented as a new continuation action.

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

Contract wire types live in [packages/contracts/src/records/](packages/contracts/src/records/), grouped into primitives, runtime, observed state, intents, calls, transactions, receipts, continuity and portable packages. `records.ts` preserves the public export surface. These modules contain type-only dependencies; the executable schemas and their generated validators remain the runtime authority.

### Native adapter

The public entry point is [packages/native-adapter/src/index.ts](packages/native-adapter/src/index.ts). Its implementation is organized by the boundary being checked:

| Files                   | Responsibility                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `connection.ts`         | Public connection lifecycle and delegation to the focused native services                              |
| `metadata.ts`           | Exact metadata capture, qualified decoder binding, finalized fingerprint and runtime code verification |
| `calls.ts`              | Allowed native call construction and byte-for-byte codec round trips                                   |
| `signing.ts`            | Plain wallet payloads, signed extensions, signature attachment and signed-extrinsic checks             |
| `state.ts`              | Anchored account/proposal reads, dispatch weight, Revive estimates and chain time                      |
| `receipts.ts`           | Sending retained bytes, finalized receipt correlation, nested results and historical lookup            |
| `types.ts`, `values.ts` | Shared native shapes and exact identity, integer and codec-value conversion                            |

`connection.ts` keeps the existing `NativeConnection` API. Splitting its implementation does not introduce another provider, signing path or transaction format. Read services verify the selected runtime and keep live state anchors separate from the pinned decoder metadata source.

### Application workflow

[apps/web/src/application/application.ts](apps/web/src/application/application.ts) owns command serialization, selected workspace/wallet state and the current journal connection. Focused modules receive the dependencies needed for their stage:

`wallet-connection.ts` owns provider subscriptions, saved public connection preferences, restoration and disconnect cancellation. Reloaded wallet context never restores an approval to sign.

| Files                                                                         | Responsibility                                                                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `network-profile.ts`, `network-state.ts`                                      | LOCAL descriptor/profile qualification, anchored account and grant reads, baseline discovery and network projections |
| `prepare-operation.ts`, `operation-parameters.ts`                             | Allowed user inputs, exact call plan, reviewed resource limits, frozen envelope and initial signing context          |
| `operation-inputs.ts`, `accounting.ts`, `resources.ts`                        | Fresh preconditions, named reserve/hold accounting and user-facing resource review                                   |
| `check-pending.ts`, `sign-operation.ts`                                       | Current signer/runtime/era/nonce/lease checks, explicit wallet request and durable signed-attempt recording          |
| `finalize-operation.ts`, `operation-postconditions.ts`, `contract-events.ts`  | Receipt-bound state and event checks, business outcome, evidence records and history projection                      |
| `recover-operation.ts`                                                        | Exact retained attempt reconstruction and historical receipt lookup; resending remains a separate command            |
| `certificate-state.ts`, `continuity/`                                         | Historical continuity certificate reconstruction and an independent current-state assessment                         |
| `workspace-state.ts`, `local-import.ts`, `operation-view.ts`, `presentation/` | Workspace creation/import, bounded projections and display state                                                     |
| `models.ts`, `values.ts`, `record-builders.ts`, `qualification/`              | Internal shapes, canonical record construction and capability-specific qualification                                 |

The application supplies callbacks for operations whose owner can change during an asynchronous stage, including the active journal after a refresh. Historical receipt anchors remain distinct from the latest network view. UI components consume the facade and projections; they do not acquire native, wallet or storage authority.

### LOCAL operator

[scripts/local/native-tools.ts](scripts/local/native-tools.ts) is the CLI entry point. [scripts/local/runtime/operator.ts](scripts/local/runtime/operator.ts) validates the run/deployment/metadata binding, opens the connection, owns the per-run lock and selects the requested scenario.

| Files under `scripts/local/runtime/` | Responsibility                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `actors.ts`, `config.ts`, `types.ts` | Explicit development identities, LOCAL units and retained session shapes                                 |
| `journal.ts`                         | Durable atomic session writes and exclusive per-run ownership                                            |
| `calls.ts`, `guards.ts`              | Retained native action reconstruction and shared assertions                                              |
| `execution.ts`                       | Prepare/sign/persist/send ordering, exact multisig incarnation checks and receipt reconciliation         |
| `queries.ts`                         | Proxy inventory, contract estimates and attributed contract events                                       |
| `seed.ts`, `seed-probes.ts`          | Initial vested grant, rejected unauthorized route and original-depositor cancellation probe              |
| `handoff.ts`, `negative.ts`          | Separate controller rotation/continuation, old-route rejection and post-proof maintenance/mapping probes |
| `evidence.ts`                        | Public-address-only workspace export and command result summary                                          |

These modules are development tooling and are never imported by the browser. A completed journal stage is reused, an unresolved attempt blocks replacement, and historical rotation/continuation records remain unchanged during replay.

## Build the real LOCAL runtime

The [runtime lock](infra/local/runtime.lock.json) pins upstream source, patch, Cargo lock, native toolchains, and unchanged contract source. The integrated host launcher supports Linux; process ownership checks use `/proc`.

Required host tools are Git, the pinned Rust/Cargo toolchain, rustup with the separate runtime-WASM toolchain and `wasm32v1-none`, Clang/libclang, CMake, pkg-config, protobuf, OpenSSL, and zlib. Read the exact versions from the runtime lock. The outer native compiler and nested runtime-WASM compiler are intentionally pinned separately. On NixOS, `local:build` uses the pinned nixpkgs input and [shell.nix](infra/local/shell.nix) for C/C++ dependencies; it does not change OS configuration.

```bash
npm run doctor -- --local
npm run local:build
```

The build fetches only the locked source revision, verifies the Cargo lock and reviewed patch, then builds `substrate-node` and `eth-rpc`. It records executable/runtime hashes in `.agent-workspace/local-runtime/build.json`. Source/build caches and compiler logs remain in `.agent-workspace/local-runtime/`; changing the patch or lock requires another verified build.

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

The host launcher is the integrated path for application/deployment/seed tooling. [Compose](infra/local/compose.yaml) provides an alternate container process definition for the same pinned node/gateway source. Copy [.env.example](.env.example) to a local, Git-ignored `.env` on first setup; the [LOCAL environment guide](infra/local/README.md) documents the explicit environment-file commands and settings. Container state and host PID/state management are different: use one process owner for a given port set, and keep Compose volumes separate from host runs.

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

On browsers with Web Locks, a document holds its tab identity while session storage retains it across reloads. A duplicated tab receives a different identity and cannot take over an active operation lease. Reloading the original tab can restore saved signed bytes for a separate, explicit send. If Web Locks or session storage is unavailable, ownership remains isolated per document and immediate recovery across a reload is not guaranteed; the existing lease and transaction-validity checks still apply.

Reset is an explicit destructive command for that run's native/gateway state:

```bash
npm run local:status -- --run development
npm run local:reset -- --run development --generation 1
```

Replace `1` with the current generation reported by status. The reset refuses a mismatch, symlinked state, or active native operation. It preserves old deployment/seed evidence, increments the generation, and invalidates the previous local descriptor. Browser records and wallet storage are retained. Start, qualify, deploy, and seed the new generation explicitly before using it.

## Workspace state and handoff evidence

`apps/web/src/application/workspace-state.ts` owns current/replacement configuration, checkpoints and pure lifecycle transformations. `advance-handoff.ts` verifies native removal evidence before archiving and advancing a completed handoff. `local-import.ts` shares chain-provenance checks between imported LOCAL packages and connected Pure/grant addresses. `presentation/` derives the visible state, including the comparison with the saved beneficiary identity.

A workspace keeps its original grant baseline and Pure creator separately from the current controller. Handoff history rows carry the handoff identifier, so a previous removal cannot complete a later cycle. Persisted continuity certificates are reconstructed before being used as current proof. Legacy workspaces with a preconfigured replacement remain readable.

## Contract and schema maintenance

```bash
npm run generate:contracts
npm run compile:contract
```

Generated validators come from the schemas in `packages/contracts/schema/`; do not edit generated output. Wire DTOs and semantic checks must stay consistent with those schemas. Vestry compilation verifies the attributed source hash and locked Solidity compiler/settings before writing `contracts/artifacts/Vestry.json`. Preserve [the third-party license](contracts/LICENSE.Vestry) and source provenance.

CI regenerates both outputs and rejects an unexplained Git diff. It also loads the validators as native ES modules, so a test-runner compatibility layer cannot conceal an invalid browser/Node import.

## Continuous integration

The [verification workflow](.github/workflows/ci.yml) installs the exact Node release and npm lock without lifecycle scripts, checks formatting and generated artifacts, runs TypeScript/offline tests, and builds the static client. A separate job installs the pinned Playwright Chromium and runs browser/accessibility checks. GitHub actions are pinned to immutable commits and receive read-only repository permissions.

CI does not substitute an offline fixture result for native execution. Complete LOCAL integration is an explicit operator run with its own source/runtime/deployment identity and receipts. Temporary fixtures, browser traces, screenshots, logs and build support artifacts belong in `.agent-workspace/`; `.local-state/` contains retained native runtime state. Neither directory belongs in source commits. Reusable test sources and their deterministic CI fixtures remain versioned under `tests/`.
