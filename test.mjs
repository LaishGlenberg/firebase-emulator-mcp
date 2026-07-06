import { spawn } from "node:child_process";
import { join } from "node:path";

const SERVER = join(import.meta.dirname, "lib", "index.js");
const VERBOSE = process.argv.includes("--verbose") || process.argv.includes("-v");
let pass = 0, fail = 0;

function log(...args) { if (VERBOSE) console.log(...args); }

function call(proc, method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = Math.floor(Math.random() * 100000);
    const msg = JSON.stringify({ jsonrpc: "2.0", method, params, id }) + "\n";
    log(`  → ${method} ${JSON.stringify(params)}`);
    
    const onData = (data) => {
      const lines = data.toString().trim().split("\n");
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.id === id) {
            proc.stdout.off("data", onData);
            resolve(parsed);
          }
        } catch {}
      }
    };
    
    proc.stdout.on("data", onData);
    proc.stdin.write(msg);
    
    // timeout after 10s
    setTimeout(() => {
      proc.stdout.off("data", onData);
      reject(new Error("timeout"));
    }, 10000);
  });
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ✗ ${name}: ${e.message}`);
    fail++;
  }
}

async function main() {
  console.log(`\nFirebase Emulator MCP — smoke test\n`);

  const proc = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "inherit"] });
  
  // Give it a moment to start
  await new Promise(r => setTimeout(r, 500));

  try {
    await test("tools/list returns tools", async () => {
      const r = await call(proc, "tools/list");
      if (!r.result || !r.result.tools) throw new Error("no tools in response");
      const names = r.result.tools.map(t => t.name);
      if (!names.includes("emulator_status")) throw new Error("missing emulator_status");
      console.log(`    ${names.length} tools registered`);
      if (VERBOSE) log(`    tools: ${names.join(", ")}`);
    });

    await test("tools/call emulator_status", async () => {
      const r = await call(proc, "tools/call", { name: "emulator_status", arguments: {} });
      if (r.error) throw new Error(r.error.message);
      const content = JSON.parse(r.result.content[0].text);
      const reachable = Object.entries(content).filter(([_, v]) => v.reachable).length;
      console.log(`    ${reachable}/${Object.keys(content).length} emulators reachable`);
      if (VERBOSE) log(`    ${JSON.stringify(content, null, 2)}`);
    });

    await test("tools/call firestore_list_collections", async () => {
      const r = await call(proc, "tools/call", { name: "firestore_list_collections", arguments: {} });
      if (r.error) throw new Error(r.error.message);
      const content = JSON.parse(r.result.content[0].text);
      const count = content.collectionIds ? content.collectionIds.length : 0;
      console.log(`    ${count} collections found`);
      if (VERBOSE) log(`    ${JSON.stringify(content, null, 2)}`);
    });

  await test("tools/call firestore_get (first Member doc)", async () => {
    const q = await call(proc, "tools/call", { name: "firestore_query", arguments: { collection: "Member", limit: 1 } });
    if (q.error) throw new Error(q.error.message);
    const docs = JSON.parse(q.result.content[0].text);
    if (!docs.length) throw new Error("no Member docs to test get");
    const path = docs[0].name.match(/documents\/(.+)/)[1];
    if (VERBOSE) log(`    Doc path: ${path}`);
    const r = await call(proc, "tools/call", { name: "firestore_get", arguments: { path } });
    if (r.error) throw new Error(r.error.message);
    if (VERBOSE) log(`    ${JSON.stringify(JSON.parse(r.result.content[0].text), null, 2)}`);
    });

    await test("tools/call auth_list_users", async () => {
      const r = await call(proc, "tools/call", { name: "auth_list_users", arguments: { limit: 5 } });
      if (r.error) throw new Error(r.error.message);
      const content = JSON.parse(r.result.content[0].text);
      console.log(`    Response keys: ${Object.keys(content).join(", ")}`);
      if (VERBOSE) log(`    ${JSON.stringify(content, null, 2)}`);
    });

    await test("tools/call rtdb_get (tempLLMUsageLimits)", async () => {
      const r = await call(proc, "tools/call", { name: "rtdb_get", arguments: { path: "/tempLLMUsageLimits" } });
      if (r.error) throw new Error(r.error.message);
      const content = JSON.parse(r.result.content[0].text);
      if (!content["regular-user"]) throw new Error("no regular-user limits found");
      console.log(`    Found limits for ${Object.keys(content).length} tiers`);
      if (VERBOSE) log(`    ${JSON.stringify(content, null, 2)}`);
    });

    await test("tools/call emulator_logs", async () => {
      const r = await call(proc, "tools/call", { name: "emulator_logs", arguments: { lines: 10 } });
      if (r.error) throw new Error(r.error.message);
      const lines = r.result.content[0].text.split("\n").filter(Boolean);
      if (!lines.length) throw new Error("no log lines returned");
      console.log(`    ${lines.length} log lines`);
      if (VERBOSE) log(`    ${lines.join("\n")}`);
    });
  } finally {
    proc.kill();
  }

  console.log(`\n  Result: ${pass} passed, ${fail} failed\n`);
  process.exit(fail ? 1 : 0);
}

main();
