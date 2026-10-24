# Account Handoff LOCAL runtime

LOCAL runs the real upstream kitchensink native runtime and its matching Revive EVM gateway. The source commit, patch and unit configuration are in [runtime.lock.json](runtime.lock.json). The patch keeps Vestry unchanged, explicitly labels the runtime `account-handoff-local`, sets 14 native decimals and the 10,000 native/EVM ratio, and sets the minimum vested transfer to ten LOCAL tokens. AutoMap stays false.

The host launcher works without a Docker daemon:

```bash
npm run local:plan -- --run development
npm run local:build
npm run local:up -- --run development
npm run local:qualify -- --run development
npm run generate:native -- development
npm run local:deploy -- --run development
npm run local:seed -- --run development
```

Build prerequisites are native Rust 1.99.1, the separate Rust 1.99.0 toolchain with `wasm32v1-none` and `wasm32-unknown-unknown`, Clang/libclang, protobuf, CMake, pkg-config, OpenSSL and zlib. Install the runtime toolchain with `rustup toolchain install 1.99.0 --profile minimal --target wasm32v1-none --target wasm32-unknown-unknown`. On NixOS the build script resolves the exact nixpkgs revision and NAR hash in `runtime.lock.json` and uses that source explicitly with [shell.nix](shell.nix); it does not modify the OS configuration or use the host's moving channel. The build captures source, Cargo.lock, patch, compiler, native binary and embedded runtime-WASM hashes in `.agent-workspace/local-runtime/build.json`. Cargo output goes to `.agent-workspace/local-runtime/build.log`; persistent native and gateway state goes to `.local-state/<run-id>/`.

`local:up` starts only the two pinned binaries. It neither deploys a contract nor creates a grant. `local:qualify` captures finalized runtime identity, raw metadata, runtime code and gateway alignment. Contract deployment and seed operations are explicit commands and retain their own attempt/receipt manifests. `local:status` reports process and read availability without inventing ready state.

Qualification records the exact finalized block 1 metadata blob and its source block in `native-metadata-binding.json`; it waits for that block to finalize on a fresh run. Native codecs use those reviewed bytes while account state, fees, balances and receipts remain live reads. Every read boundary checks the actual runtime code against the binding; a runtime upgrade requires a new qualification. This also avoids treating state-dependent metadata storage defaults as a new call schema. An existing qualification without accurate metadata provenance requires an explicit `--metadata-anchor <block-hash>` whose captured bytes must exactly match the retained artifact.

The seed command creates the vested first-milestone baseline, a separate rejected nested-controller probe, and an original-depositor cancellation probe that checks the exact proposal deposit refund. It writes a public-address-only `workspace.json` for the browser and source/probe-bound capability evidence. It does not rotate the account. Use `npm run local:handoff -- --run development` for the separate A+B authorization, A+D exact removal, and A+D next-milestone submission. `npm run local:test -- --run development` runs baseline, handoff and old-route rejection in sequence, then exercises `vest_other` as a distinct maintenance operation after the continuation proof. An interrupted signed attempt remains unresolved until `npm run local:reconcile -- --run development` finds its exact finalized receipt; commands never automatically rebuild and resend it.

For Docker-enabled hosts, the optional [Compose configuration](compose.yaml) builds the same source and patch with digest-pinned Rust/Debian images and a dated Debian package snapshot:

```bash
# From the repository root, create .env once and adjust it as needed.
cp .env.example .env
docker compose --env-file .env -f infra/local/compose.yaml up -d --build
```

The runtime base obtains its CA bundle from the pinned toolchain image before accessing the HTTPS package snapshot. Package index failures stop the build immediately.

The versioned [.env.example](../../.env.example) provides the settings; your local `.env` is ignored by Git. Pass `--env-file .env` explicitly because the Compose file is under `infra/local`. Keep an existing `.env` when restarting or upgrading this stack. The example uses project `account-handoff-docker-local`, native WebSocket `ws://127.0.0.1:9966`, and gateway HTTP `http://127.0.0.1:8566`, so it can coexist with the host launcher's default ports.

Exported `AH_*` shell variables take precedence over the file. If you previously exported them and now want to use only `.env`, run `unset AH_RUN_ID AH_NATIVE_PORT AH_GATEWAY_PORT` first.

| Variable          | Purpose                                               | Example value  |
| ----------------- | ----------------------------------------------------- | -------------- |
| `AH_RUN_ID`       | Compose project suffix and container/volume namespace | `docker-local` |
| `AH_NATIVE_PORT`  | Native RPC port published on host loopback            | `9966`         |
| `AH_GATEWAY_PORT` | Revive gateway port published on host loopback        | `8566`         |

These settings configure Compose. Host-managed run manifests and the website's qualified `local-run.json` remain separate. The containers start the native node and gateway; they do not start the frontend, deploy Vestry, or seed a grant.

Inspect or stop the same stack with the same environment file:

```bash
docker compose --env-file .env -f infra/local/compose.yaml ps
docker compose --env-file .env -f infra/local/compose.yaml logs -f
docker compose --env-file .env -f infra/local/compose.yaml down
```

If access to the Docker socket requires elevation, prefix these commands with `sudo`; the explicit environment file avoids relying on shell variables surviving `sudo`.

Only loopback ports are published. The private network prevents native peering outside this stack. Persistent volumes belong to the selected Compose project. Container startup is not full qualification; run the application-level native and gateway checks before transactions. The host process launcher and Compose are alternative process owners: do not start both on the same ports.

Both services retain archive history. Ordinary stop/restart preserves state:

```bash
npm run local:stop -- --run development
npm run local:up -- --run development
```

Reset is explicit and generation-scoped:

```bash
npm run local:status -- --run development
npm run local:reset -- --run development --generation 1
```

The reset command stops only recorded owned host processes, archives that generation's metadata binding, qualification, deployment, workspace, receipts, probes and logs under `history/generation-N/`, and removes only that run's native/gateway state. A new generation starts without an accepted metadata binding and invalidates the earlier application namespace even if genesis repeats. It does not delete browser profiles, wallet storage or another run. Compose volumes require a separately scoped Compose operation and are never deleted by the host reset command.

This is a modified upstream LOCAL environment. It does not prove PortalDot DEMO or LIVE compatibility.
