# PortalDot runtime integration checks

These checks execute the pinned PortalDot runtime in an isolated Chopsticks fork, with known development signers and local balance fixtures. They never submit to the public endpoint. Public RPC supplies the initial chain state; local RPC accepts test transactions. Real sr25519 signature verification is enabled. Consensus, block production and finality are simulated, so a pass is not a public-testnet receipt or a production-wallet certification.

Install the optional test tool outside the application's dependency tree:

```bash
npm install --prefix .agent-workspace/implementation/testnet-pipeline/fork --no-audit --no-fund @acala-network/chopsticks@1.5.2
npm run testnet:fork
```

The server binds only `127.0.0.1:8059` and forks block 195611. Start from that checkpoint for a new run; set `AH_TESTNET_FORK_RESUME=1` only to deliberately resume the retained fork database. It uses a local implementation of `state_getStorageHash` that hashes actual fork storage bytes. Unused StatementStore host imports are allowed at instantiation, with no implementation substituted for their execution.

In another terminal, from the repository root:

```bash
npm run test:testnet:runtime
npm run test:testnet:browser
```

The native test covers a new Pure, actual automatic mapping, unchanged Vestry, two milestones, 200-block native vesting, old-group rejection, continued submission, vesting completion, a return handoff and both releases. It records every local receipt under `.agent-workspace/implementation/testnet-pipeline/fork/` and stops at the first failed assertion. The browser test then uses the real DEMO coordinator, redirects its WebSocket transport to that same fork and supplies a signature-only development wallet. Browser transport redirection and local prefunding are test fixtures; they are never packaged into the website.

The browser test requires completed runtime qualification in `infra/testnet/runtime-verification.json`. It runs with B also acting as R1 and F also acting as R2/S, as in the agreed five-account scenario. Node-side signing keys stay in the test process. Production wallet requests remain explicit.

Run tests serially. Do not start a second native run against an in-progress database: this intentionally changes the same fork state. Regenerated logs, traces, databases, screenshots and fixtures belong in `.agent-workspace/`, not this directory.
