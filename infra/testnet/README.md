# Account Handoff — PortalDot V3 testnet

This package contains a prebuilt production website. No npm install, source checkout, local chain, `.env`, or private key is needed to serve it.

The website connects to PortalDot V3 with its own pinned metadata, automatic-mapping policy and verified Vestry deployment. Operations are enabled only when the current runtime matches the retained qualification and the selected wallet, authority, mapping and funding checks pass. A runtime change blocks preparation. The release manifest distinguishes runtime verification from a completed public-testnet journey; a successful local fork does not prove public-network finality or wallet-extension compatibility.

The original, unmodified **Vestry** contract is deployed at `0xb8e2d057cf231f265dd6f3841216f4727edad345`. The deployment finalized in block **189561** and its runtime bytecode was verified against the pinned compiler artifact. See [vestry-deployment.json](vestry-deployment.json) for its transaction and code hashes. The package records this address in `network.json` and `release.json`; it does not redeploy the contract.

Testnet grant forms default to a **10 tPOT vested tranche** and a **0.1 tPOT unvested tranche**. The vested amount is the verified network minimum; 0.1 tPOT is a small payment matching the account existential deposit, rather than an absolute minimum for an already funded recipient. The default 1,000-block vesting period divides the first amount exactly; the agreed paced test uses an explicit 200-block period. Native storage and multisig/proxy deposits are determined by the runtime and are separate from grant principal and fees. Fund each actual payer for its full operation before signing; the displayed principal is not the complete required balance.

## Start with Node

Install Node.js 24.10 or newer. Extract the entire archive, open a terminal in `Account Handoff Testnet`, and run:

```bash
node serve.mjs
```

Open **http://127.0.0.1:8080**. Stop with Ctrl+C. An alternative port can be selected with `AH_PORT=8081 node serve.mjs` on Linux/macOS, or `$env:AH_PORT=8081; node serve.mjs` in PowerShell. Keep the extracted `www` directory next to `serve.mjs`.

## Start with Docker Compose

Docker Engine and Compose must be available to your user. In the extracted directory, run:

```bash
docker compose up --build -d
docker compose ps
```

Open **http://127.0.0.1:8080**. The image uses the Node 24 Alpine base and copies the already compiled assets; it does not run npm or compile the project. Initial startup may download the base image. No `.env` is required. If port 8080 is occupied, use `AH_PORT=8081 docker compose up --build -d`.

Stop with `docker compose down`. The container stores no application data. Workspaces, wallet preferences and the last successfully verified public native endpoint are held in the browser's IndexedDB, scoped to its origin and this testnet build. Keep the same URL and browser profile to retain them. Clearing site data removes these local records. Unsaved setup drafts remain in memory while the page is open; they are not restored after a reload.

## Connect to the testnet

1. Opening the website automatically checks the last successfully verified public native endpoint or the preset `wss://test-node-v3.portaldot.dev`. This reads network state and does not connect a wallet or send a transaction. Saved connection settings never replace live verification.
2. The workspace form appears after its first successful connection. During a temporary interruption, entered details stay visible and editable; saving waits for verified current state. Transient failures retry automatically with delays of 2, 5, 10 and then at most 30 seconds. Attempts pause while the browser is offline and resume when it returns online.
3. Use **Open network setup**, then **Connect and verify** for a manual retry or another secure endpoint for the same testnet. A changed genesis, runtime or metadata stops automatic retries and shows its verification error. The manual button remains available, and **Back to workspace setup** returns to your draft. Previously verified observations show their last-checked time while reconnecting; they do not authorize signing or sending. URLs with query strings are not saved as connection preferences.
4. Use **Connect wallet** with a supported native Substrate wallet, such as SubWallet or Polkadot.js. Select your own native SS58 account. Do not paste a mnemonic or private key into the app.

Network identity is recorded in `network.json`. The build checks genesis `0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd` and permits only DEMO mode. The EVM gateway uses chain ID `420420777`; its HTTP URL is not a replacement for the native WebSocket URL.

## Move a workspace to another browser

1. Open the workspace, then **Workspace data** and **Download package**. Keep the resulting `account-handoff-workspace.json` separate from this website ZIP.
2. In the other browser, open **Workspace data**, choose or paste that JSON, and select **Review package**. Check the displayed network, signer groups, beneficiary and grant, including grant ID `0` when applicable.
3. Let the testnet connect, then confirm **Restore workspace**. The app checks provenance and current state using your selected endpoint before saving. If the same local beneficiary has different configuration, choose an explicit evidence merge or resolve the difference; its configuration is not silently overwritten.

The backup contains public workspace configuration and unsigned evidence. Wallet access, signing permission, signed transaction bytes, endpoints and local operation ownership remain in their original browser. A file cannot authorize a transaction. Existing `account-handoff-evidence.json` files contain evidence only: select a matching workspace or complete the missing configuration shown during review. The app never guesses that a missing beneficiary or grant means one should be created. Your file, preview and entered details survive a visit to network setup while the page remains open; a reload clears this unsaved form.

Primary network reference: [PortalDot V3 testnet guide](https://github.com/ItsCogumellum/portaldot-v3-testnet-guide).

## Publish the static website

Upload **the contents of `www/`** to the root of an HTTPS static site. Use `index.html` as the entry point and preserve the `assets/` paths. Navigation uses URL hashes, so a server-side route fallback is unnecessary. The app connects directly from the browser to the native WSS endpoint. A content security policy must allow that connection and the wallet extension's supported integration.

The included Node server binds to loopback by default and is sufficient for local review. Use HTTPS hosting for a public deployment and an origin supported by your wallet. Changing the host, port, or scheme creates a different browser storage origin.

## Files and integrity

- `www/`: compiled website, including hashed assets; no source maps or LOCAL manifest.
- `serve.mjs`: dependency-free static server.
- `Dockerfile`, `compose.yaml`, `.dockerignore`: optional container startup.
- `network.json`: expected network identity.
- `vestry-deployment.json`: finalized original-contract deployment and bytecode verification record.
- `runtime-verification.json`: scope, hashes and retained runtime capability verification.
- `runtime-verification-evidence.json`: local fork receipts and final state supporting that verification; these are not public-network transactions.
- `release.json`: source revision, build mode, capabilities and artifact hashes.
- `SHA256SUMS`: checksums of all package files except itself; run `sha256sum -c SHA256SUMS` on Linux.

The package contains no signing keys, node database, or personal workspace records. The included verification evidence contains public development addresses and local transaction receipts. Wallet access is explicit. Loading the page never requests a signature or sends a transaction.
