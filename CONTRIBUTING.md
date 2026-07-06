# Contributing

Local development setup and workflow for the `mcp-server/` package.

---

## Prerequisites

- Node.js 18+ (v21+ recommended for native WebSocket)
- Firebase emulators running locally:

  ```bash
  firebase emulators:start
  ```

## Setup

```bash
cd mcp-server
npm install
```

## Build

```bash
npm run build        # tsc — compiles src/ → lib/
npm run build:watch  # npx tsc --watch
```

## Run

```bash
npm start            # node lib/index.js
```

Or directly:

```bash
node lib/index.js
```

## Test

Smoke tests exercise each tool against running emulators:

```bash
npm test
# or
node test.mjs
# verbose mode:
node test.mjs -v
```

The test runner spawns the compiled server (`lib/index.js`) and sends JSON-RPC
calls over stdio.

## Project structure

```
mcp-server/
├── src/
│   └── index.ts          # TypeScript source — all tools in one file
├── lib/                   # Compiled JS + declarations (git-ignored)
├── test.mjs               # Smoke test runner
├── tsconfig.json
├── package.json
├── .gitignore
├── LICENSE
├── README.md              # Public-facing (npm consumers)
└── CONTRIBUTING.md        # This file
```

## How it works

The server connects to Firebase emulators over their REST APIs and a WebSocket
hub for logs. Tools are registered via the `@modelcontextprotocol/sdk` and
served over stdio transport.

### Emulator ports

| Service     | Default Port | Protocol     |
|-------------|--------------|--------------|
| Firestore   | 8080         | HTTP REST    |
| Auth        | 9099         | HTTP REST    |
| Realtime DB | 9000         | HTTP REST    |
| Storage     | 9199         | HTTP REST    |
| Emulator UI | 4000         | HTTP         |
| Hub (logs)  | 4500         | WebSocket    |

Ports are defined in `src/index.ts` under the `EMULATORS` constant.

### Config via environment variables

| Variable                 | Default                        |
|--------------------------|--------------------------------|
| `GCLOUD_PROJECT`         | `demo-project`                 |
| `FIREBASE_PROJECT_ID`    | falls back to `GCLOUD_PROJECT` |
| `FIREBASE_RTDB_NAMESPACE`| `${PROJECT_ID}-default-rtdb`   |

## Publishing

```bash
# Bump version first
npm version patch   # or minor, major

# Build & publish
npm publish --access public
```

The `prepublishOnly` script runs `tsc` automatically.

### CI/CD

On pushes to `main` that touch `mcp-server/`, GitHub Actions will:

1. Build the package
2. Publish a new version to npm if the version changed
3. Sync the `mcp-server/` directory to the
   [standalone repo](https://github.com/lglen/firebase-emulator-mcp)

**Required secrets** (repo → Settings → Secrets and variables → Actions):

| Secret               | Purpose                                        |
|----------------------|-------------------------------------------------|
| `NPM_TOKEN`          | npm automation token (publish to `@lglen/...`) |
| `STANDALONE_REPO_PAT`| GitHub PAT with push access to standalone repo  |
