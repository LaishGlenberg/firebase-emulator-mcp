#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { connect as tcpConnect } from "node:net";

// ── Config ────────────────────────────────────────────────────────────────────

const PROJECT_ID =
  process.env.GCLOUD_PROJECT ??
  process.env.FIREBASE_PROJECT_ID ??
  "demo-project";

const RTDB_NS =
  process.env.FIREBASE_RTDB_NAMESPACE ??
  `${PROJECT_ID}-default-rtdb`;

interface EmulatorInfo {
  port: number;
  url: string;
}

const EMULATORS: Record<string, EmulatorInfo> = {
  firestore: { port: 8080, url: "http://127.0.0.1:8080" },
  auth:      { port: 9099, url: "http://127.0.0.1:9099" },
  database:  { port: 9000, url: `http://127.0.0.1:9000/.json?ns=${RTDB_NS}` },
  storage:   { port: 9199, url: "http://127.0.0.1:9199" },
  ui:        { port: 4000, url: "http://127.0.0.1:4000" },
  hub:       { port: 4500, url: "ws://127.0.0.1:4500/" },
};

const FS = `${EMULATORS.firestore.url}/v1/projects/${PROJECT_ID}/databases/(default)/documents`;
const AUTH = EMULATORS.auth.url;
const AUTH_HEADERS = { "Content-Type": "application/json", Authorization: "Bearer owner" };
const AUTH_KEY = "key=fake-api-key";

// ── Helpers ───────────────────────────────────────────────────────────────────

/** fetch with a timeout — rejects if the server doesn't respond in `ms`. */
async function fetchTO(url: string, opts: RequestInit = {}, ms = 5000): Promise<Response> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ac.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** Check whether a TCP port is open on 127.0.0.1. */
function tcpCheck(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const sock = tcpConnect(port, "127.0.0.1", () => {
      sock.end();
      resolve(true);
    });
    sock.on("error", () => resolve(false));
  });
}

/** Zod-to-Firestore operator mapping. */
const OP_MAP: Record<string, string> = {
  "==": "EQUAL",
  ">=": "GREATER_THAN_OR_EQUAL",
  "<=": "LESS_THAN_OR_EQUAL",
  ">": "GREATER_THAN",
  "<": "LESS_THAN",
  "!=": "NOT_EQUAL",
  "array-contains": "ARRAY_CONTAINS",
  in: "IN",
  "not-in": "NOT_IN",
};

/** Build a Firestore `Value` from a zod-coerced string. */
function toFirestoreValue(value: string): Record<string, string | boolean> {
  if (value === "true") return { booleanValue: true };
  if (value === "false") return { booleanValue: false };
  if (!isNaN(Number(value)) && value.trim() !== "") return { integerValue: String(Number(value)) };
  return { stringValue: value };
}

/** Strip the `documents/` prefix from a Firestore document name to get a path. */
function docPath(name: string): string {
  const m = name.match(/documents\/(.+)/);
  return m ? m[1] : name;
}

// ── Tool definitions ──────────────────────────────────────────────────────────

function createApp(): McpServer {
  const s = new McpServer({ name: "firebase-emulator-mcp", version: "1.0.0" });

  // ── emulator_status ─────────────────────────────────────────────────────────
  s.registerTool(
    "emulator_status",
    { description: "Check reachability of all Firebase emulators", inputSchema: z.object({}) },
    async () => {
      const result: Record<string, unknown> = {};
      for (const [name, cfg] of Object.entries(EMULATORS)) {
        if (cfg.url.startsWith("ws://")) {
          const reachable = await tcpCheck(cfg.port);
          result[name] = { port: cfg.port, reachable };
        } else {
          try {
            const x = await fetchTO(cfg.url);
            result[name] = { port: cfg.port, reachable: x.ok, status: x.status };
          } catch {
            result[name] = { port: cfg.port, reachable: false, error: "Unreachable" };
          }
        }
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
    },
  );

  // ── firestore_list_collections ──────────────────────────────────────────────
  s.registerTool(
    "firestore_list_collections",
    { description: "List root-level collection IDs from Firestore emulator", inputSchema: z.object({}) },
    async () => {
      const x = await fetchTO(`${FS}:listCollectionIds`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
        body: "{}",
      });
      if (!x.ok) {
        return { content: [{ type: "text" as const, text: `Error ${x.status}: ${await x.text()}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(await x.json(), null, 2) }] };
    },
  );

  // ── firestore_query ─────────────────────────────────────────────────────────
  const QuerySchema = z.object({
    collection: z.string(),
    whereField: z.string().optional(),
    whereOperator: z.string().optional(),
    whereValue: z.string().optional(),
    limit: z.number().optional().default(20),
  });

  s.registerTool(
    "firestore_query",
    { description: "Query documents in a Firestore collection", inputSchema: QuerySchema },
    async (args) => {
      type QueryDoc = { name: string; createTime: string; updateTime: string; fields: Record<string, unknown> };

      const sq: Record<string, unknown> = { from: [{ collectionId: args.collection }], limit: args.limit };

      if (args.whereField && args.whereOperator && args.whereValue !== undefined) {
        const op = OP_MAP[args.whereOperator];
        if (!op) {
          return { content: [{ type: "text" as const, text: `Bad operator: ${args.whereOperator}` }], isError: true };
        }
        sq.where = {
          fieldFilter: {
            field: { fieldPath: args.whereField },
            op,
            value: toFirestoreValue(args.whereValue),
          },
        };
      }

      const x = await fetchTO(`${FS}:runQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer owner" },
        body: JSON.stringify({ structuredQuery: sq }),
      });
      if (!x.ok) {
        return { content: [{ type: "text" as const, text: `Error ${x.status}: ${await x.text()}` }], isError: true };
      }

      const docs: QueryDoc[] = ((await x.json()) as { document?: QueryDoc }[])
        .filter((r) => r.document)
        .map((r) => ({
          name: r.document!.name,
          createTime: r.document!.createTime,
          updateTime: r.document!.updateTime,
          fields: r.document!.fields,
        }));

      return { content: [{ type: "text" as const, text: JSON.stringify(docs, null, 2) }] };
    },
  );

  // ── firestore_get ───────────────────────────────────────────────────────────
  s.registerTool(
    "firestore_get",
    { description: "Get a single Firestore document by path (e.g. Member/abc123)", inputSchema: z.object({ path: z.string() }) },
    async (args) => {
      const x = await fetchTO(`${FS}/${args.path}`, { headers: { Authorization: "Bearer owner" } });
      if (!x.ok) {
        return { content: [{ type: "text" as const, text: `Error ${x.status}: ${await x.text()}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(await x.json(), null, 2) }] };
    },
  );

  // ── rtdb_get ────────────────────────────────────────────────────────────────
  s.registerTool(
    "rtdb_get",
    {
      description: "Read data from Realtime Database emulator at a given path",
      inputSchema: z.object({ path: z.string().default("/").describe("Path in RTDB, e.g. /rateLimits or /tempLLMUsageLimits") }),
    },
    async (args) => {
      const p = args.path.startsWith("/") ? args.path : `/${args.path}`;
      const x = await fetchTO(`http://127.0.0.1:9000${p}.json?ns=${RTDB_NS}`);
      if (!x.ok) {
        return { content: [{ type: "text" as const, text: `Error ${x.status}: ${await x.text()}` }], isError: true };
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(await x.json(), null, 2) }] };
    },
  );

  // ── auth_list_users ─────────────────────────────────────────────────────────
  s.registerTool(
    "auth_list_users",
    { description: "List users from Auth emulator", inputSchema: z.object({ limit: z.number().optional().default(50) }) },
    async (args) => {
      let x = await fetchTO(
        `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:query?${AUTH_KEY}`,
        { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify({ maxResults: args.limit }) },
      );
      if (!x.ok) {
        x = await fetchTO(
          `${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts?${AUTH_KEY}`,
          { method: "POST", headers: AUTH_HEADERS },
        );
        if (!x.ok) {
          return { content: [{ type: "text" as const, text: `Error ${x.status}: ${await x.text()}` }], isError: true };
        }
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(await x.json(), null, 2) }] };
    },
  );

  // ── auth_get_user ───────────────────────────────────────────────────────────
  s.registerTool(
    "auth_get_user",
    { description: "Get a single Auth user by email or localId", inputSchema: z.object({ identifier: z.string() }) },
    async (args) => {
      const isEmail = args.identifier.includes("@");
      const body = isEmail ? { email: [args.identifier] } : { localId: [args.identifier] };

      let x = await fetchTO(
        `${AUTH}/identitytoolkit.googleapis.com/v1/projects/${PROJECT_ID}/accounts:lookup?${AUTH_KEY}`,
        { method: "POST", headers: AUTH_HEADERS, body: JSON.stringify(body) },
      );
      if (!x.ok) {
        x = await fetchTO(
          `${AUTH}/emulator/v1/projects/${PROJECT_ID}/accounts/${args.identifier}?${AUTH_KEY}`,
          { method: "POST", headers: AUTH_HEADERS },
        );
        if (!x.ok) {
          return { content: [{ type: "text" as const, text: `Error ${x.status}: ${await x.text()}` }], isError: true };
        }
      }
      return { content: [{ type: "text" as const, text: JSON.stringify(await x.json(), null, 2) }] };
    },
  );

  // ── emulator_logs ───────────────────────────────────────────────────────────
  s.registerTool(
    "emulator_logs",
    {
      description: "Stream recent log entries from the Firebase emulator hub WebSocket (ws://127.0.0.1:4500/)",
      inputSchema: z.object({ lines: z.number().optional().default(50).describe("Number of recent log entries to return") }),
    },
    async (args) => {
      try {
        return await new Promise<{ content: { type: "text"; text: string }[]; isError?: boolean }>((resolve) => {
          const entries: string[] = [];
          let settled = false;

          const settle = (isError = false) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            try { ws.close(); } catch { /* ignore */ }
            const text = entries.length ? entries.join("\n") : "(no log entries collected)";
            resolve({ content: [{ type: "text", text }], isError: isError || undefined });
          };

          const timer = setTimeout(() => settle(), 3000);

          const ws = new WebSocket(EMULATORS.hub.url);

          ws.onopen = () => { /* connected — messages will arrive */ };

          ws.onmessage = (evt: MessageEvent) => {
            entries.push(String(evt.data));
            if (entries.length >= args.lines) settle();
          };

          ws.onerror = () => {
            if (!entries.length) {
              settled = true;
              clearTimeout(timer);
              try { ws.close(); } catch { /* ignore */ }
              resolve({
                content: [{ type: "text", text: "(no log entries collected — WebSocket error)" }],
                isError: true,
              });
            }
          };

          ws.onclose = () => settle();
        });
      } catch (e) {
        return { content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }], isError: true };
      }
    },
  );

  return s;
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const app = createApp();
  const transport = new StdioServerTransport();
  await app.connect(transport);
}

main();

process.on("SIGINT",  () => process.exit(0));
process.on("SIGTERM", () => process.exit(0));
