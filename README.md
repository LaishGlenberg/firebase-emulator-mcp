# Firebase Emulator MCP Server
[![GitHub](https://img.shields.io/badge/GitHub-firebase--emulator--mcp-181717?&logo=github)](https://github.com/LaishGlenberg)

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes Firebase
emulator data — Firestore, Auth, Logs, and Realtime Database — to AI agents over stdio.

Designed for local development workflows where AI coding assistants (Claude Code, GitHub
Copilot, etc.) need to inspect emulator state without leaving the editor.

Created by [Laish Glenberg](https://www.linkedin.com/in/laish-glenberg/), please drop a star on the repo if this package helped you!

---

## Features

| Tool | Description |
|---|---|
| `emulator_status` | Ping all emulators and report reachability |
| `firestore_list_collections` | List root-level collection IDs |
| `firestore_query` | Query documents with optional field filters (`==`, `>=`, `<=`, `in`, etc.) |
| `firestore_get` | Fetch a single document by path (e.g. `Member/abc123`) |
| `rtdb_get` | Read any path from the Realtime Database emulator |
| `auth_list_users` | List Firebase Auth users |
| `auth_get_user` | Look up a user by email or localId |
| `emulator_logs` | Stream recent log entries from the emulator hub WebSocket |

---

## Prerequisites

- **Node.js 18+** (native `fetch` and `WebSocket` — v21+ recommended)
- **Firebase emulators** running locally — start from your project root:

  ```bash
  firebase emulators:start
  ```

  The server connects to the default emulator ports:
  - Firestore: `8080`
  - Auth: `9099`
  - Realtime Database: `9000`
  - Hub (logs): `4500`

---

## Install & Run

### Via npm (recommended)

```bash
npm install -g firebase-emulator-mcp
firebase-emulator-mcp
```

---

## VS Code / MCP Client Setup

Add to your project's `.vscode/mcp.json` or VS Code user settings:

```json
{
  "servers": {
    "firebase-emulator": {
      "type": "stdio",
      "command": "node",
      "args": ["./mcp-server/lib/index.js"],
      "env": {
        "FIREBASE_PROJECT_ID": "<proj_id>",
        "FIREBASE_RTDB_NAMESPACE": "<proj_id>-default-rtdb"
      }
    }
  }
}
```

Or if installed globally:

```json
{
  "servers": {
    "firebase-emulator": {
      "type": "stdio",
      "command": "firebase-emulator-mcp",
      "env": {
        "FIREBASE_PROJECT_ID": "<proj_id>",
        "FIREBASE_RTDB_NAMESPACE": "<proj_id>-default-rtdb"
      }
    }
  }
}
```

Optionally can skip install and run directly through npx

```json
{
  "servers": {
    "firebase-emulator": {
      "type": "stdio",
      "command": "npx",
      "args": ["@lglen/firebase-emulator-mcp"],
      "env": {
        "FIREBASE_PROJECT_ID": "<proj_id>",
        "FIREBASE_RTDB_NAMESPACE": "<proj_id>-default-rtdb"
      }
    }
  }
}
```

For Claude Code or other MCP clients, use the same stdio configuration.

---

### Project structure

```
mcp-server/
├── src/
│   └── index.ts          # TypeScript source (all tools)
├── lib/                   # Compiled output (git-ignored)
├── test.mjs              # Smoke test runner
├── tsconfig.json
├── package.json
├── .gitignore
├── LICENSE               # MIT
└── README.md
```

---

## Configuration

Default emulator ports are defined in `src/index.ts` under the `EMULATORS` constant.
Edit them to match your `firebase.json` if you use non-standard ports:

| Service     | Default Port |
|-------------|--------------|
| Firestore   | 8080         |
| Auth        | 9099         |
| Realtime DB | 9000         |
| Storage     | 9199         |
| Emulator UI | 4000         |
| Hub (logs)  | 4500         |

---

## License

MIT

## Author

Check me out on [GitHub](https://github.com/LaishGlenberg)