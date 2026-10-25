# Account Handoff — PortalDot V3 testnet

This package contains a prebuilt production website. No npm install, source checkout, local chain, `.env`, or private key is needed to serve it.

**Status: read-only testnet preview.** You can connect to the real PortalDot V3 testnet, inspect network readiness, connect a native wallet, read its public accounts and create local multisig workspace records. Transaction preparation/signing, existing-beneficiary verification and the complete grant/handoff journey still require testnet-specific runtime and contract qualification. They are not enabled by this package. The separately recorded working demo used LOCAL.

The original, unmodified **Vestry** contract is deployed at `0xb8e2d057cf231f265dd6f3841216f4727edad345`. The deployment finalized in block **189561** and its runtime bytecode was verified against the pinned compiler artifact. See [vestry-deployment.json](vestry-deployment.json) for its transaction and code hashes. The package records this address in `network.json` and `release.json`; it neither redeploys the contract nor enables unqualified testnet transactions.

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

Stop with `docker compose down`. The container stores no application data. Workspaces and wallet preferences are held in the browser's IndexedDB, scoped to its origin and this testnet build. Keep the same URL and browser profile to retain them. Clearing site data removes these local records.

## Connect to the testnet

1. Open **Network and readiness** in the header.
2. Leave the preset native endpoint, `wss://test-node-v3.portaldot.dev`, and click **Connect and verify**.
3. Check the connected runtime and finalized block. Runtime transaction readiness remains blocked until a separately qualified testnet release is available.
4. Use **Connect wallet** with a supported native Substrate wallet, such as SubWallet or Polkadot.js. Select your own native SS58 account. Do not paste a mnemonic or private key into the app.

Network identity is recorded in `network.json`. The build checks genesis `0xd4f9acbcf7f52388d8b095abe3c198d19fc510e0343e643e87cfbccb155283bd` and permits only DEMO mode. The EVM gateway uses chain ID `420420777`; its HTTP URL is not a replacement for the native WebSocket URL.

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
- `release.json`: source revision, build mode, capabilities and artifact hashes.
- `SHA256SUMS`: checksums of all package files except itself; run `sha256sum -c SHA256SUMS` on Linux.

The package contains no wallet secrets, test-wallet fixtures, node database, or personal workspace records. Wallet access is explicit. Loading the page never requests a signature or sends a transaction.
