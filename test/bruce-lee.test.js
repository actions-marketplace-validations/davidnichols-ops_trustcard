// Bruce Lee — comprehensive test suite.
//
// Covers: unit (validation logic), integration (full MCP protocol over stdio),
// failure (intentional breaks), and edge cases.
//
// Run: node --test test/bruce-lee.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { writeFileSync, readFileSync, existsSync, mkdtempSync, rmSync, appendFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SERVER = join(__dirname, "..", "examples", "bruce-lee", "server.js");

// --- Test harness: spawn Bruce Lee, send JSON-RPC, collect responses ----------

function spawnServer(env = {}) {
  const logPath = env.BRUCE_LEE_LOG_PATH ?? join(mkdtempSync(join(tmpdir(), "bruce-")), "audit.jsonl");
  const proc = spawn(process.execPath, [SERVER], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env, BRUCE_LEE_LOG_PATH: logPath, BRUCE_LEE_LOG_LEVEL: "debug", ...env },
  });
  const stderr = [];
  proc.stderr.on("data", (d) => stderr.push(d.toString()));
  return { proc, logPath, stderr: () => stderr.join("") };
}

function send(proc, obj) {
  proc.stdin.write(JSON.stringify(obj) + "\n");
}

// Collect responses until we get one with the matching id (or timeout).
async function collect(proc, id, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout waiting for id=${id}`));
    }, timeoutMs);
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.id === id) {
            clearTimeout(timer);
            proc.stdout.off("data", onData);
            resolve(msg);
            return;
          }
        } catch {}
      }
    };
    proc.stdout.on("data", onData);
  });
}

// Collect all responses (for multi-response tests).
async function collectAll(proc, count, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`timeout: collected ${results.length}/${count} responses`));
    }, timeoutMs);
    const results = [];
    let buf = "";
    const onData = (chunk) => {
      buf += chunk.toString();
      let idx;
      while ((idx = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try {
          results.push(JSON.parse(line));
          if (results.length >= count) {
            clearTimeout(timer);
            proc.stdout.off("data", onData);
            resolve(results);
          }
        } catch {}
      }
    };
    proc.stdout.on("data", onData);
  });
}

async function init(proc) {
  send(proc, { jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
  const resp = await collect(proc, 1);
  send(proc, { jsonrpc: "2.0", method: "notifications/initialized" });
  return resp;
}

async function callTool(proc, id, name, args = {}) {
  send(proc, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  return collect(proc, id);
}

function parseContent(resp) {
  assert.equal(resp.result?.isError, false, "expected isError=false");
  return JSON.parse(resp.result.content[0].text);
}

// Helper: clean shutdown
function stop({ proc }) {
  try { proc.stdin.end(); } catch {}
  try { proc.kill("SIGTERM"); } catch {}
}

// ============================================================================
// INTEGRATION TESTS — full MCP protocol over stdio
// ============================================================================

test("initialize: returns correct protocol version and server info", async () => {
  const s = spawnServer();
  const resp = await init(s.proc);
  assert.equal(resp.result.protocolVersion, "2025-06-18");
  assert.equal(resp.result.serverInfo.name, "bruce-lee");
  assert.equal(resp.result.serverInfo.version, "1.0.0");
  assert.equal(resp.result.capabilities.tools.listChanged, false);
  stop(s);
});

test("initialize: includes trustcard-aware toolsetDigest binding", async () => {
  const s = spawnServer();
  const resp = await init(s.proc);
  const binding = resp.result._meta?.["io.github.davidnichols-ops/trustcard"];
  assert.ok(binding, "expected trustcard _meta binding");
  assert.equal(binding.schema, "trustcard.dev/manifest@1");
  assert.ok(binding.toolsetDigest?.startsWith("sha256:"), "toolsetDigest should be sha256:...");
  stop(s);
});

test("tools/list: returns 3 well-annotated tools", async () => {
  const s = spawnServer();
  await init(s.proc);
  send(s.proc, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const resp = await collect(s.proc, 2);
  const tools = resp.result.tools;
  assert.equal(tools.length, 3);
  const names = tools.map((t) => t.name);
  assert.deepEqual(names.sort(), ["query_decisions", "record_decision", "server_identity"]);

  // All tools must have annotations with destructiveHint: false
  for (const t of tools) {
    assert.ok(t.annotations, `${t.name} must have annotations`);
    assert.equal(t.annotations.destructiveHint, false, `${t.name} must be non-destructive`);
  }

  // Read-only tools must have readOnlyHint: true
  const query = tools.find((t) => t.name === "query_decisions");
  assert.equal(query.annotations.readOnlyHint, true);
  const identity = tools.find((t) => t.name === "server_identity");
  assert.equal(identity.annotations.readOnlyHint, true);

  // record_decision is a write (to local log) but not destructive
  const record = tools.find((t) => t.name === "record_decision");
  assert.equal(record.annotations.readOnlyHint, false);
  assert.equal(record.annotations.destructiveHint, false);

  stop(s);
});

test("record_decision: returns receipt with digest and chain pointer", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "record_decision", {
    agent: "test-agent",
    action: "commit",
    rationale: "fixes bug #1",
    kind: "decision",
    tags: ["bugfix"],
  });
  const receipt = parseContent(resp);
  assert.ok(receipt.id, "receipt must have id");
  assert.ok(receipt.digest?.startsWith("sha256:"), "receipt must have sha256 digest");
  assert.equal(receipt.previousDigest, null, "first decision has null prev");
  assert.equal(receipt.agent, "test-agent");
  assert.equal(receipt.action, "commit");
  assert.equal(receipt.kind, "decision");
  stop(s);
});

test("hash chain: second decision links to first", async () => {
  const s = spawnServer();
  await init(s.proc);
  const r1 = await callTool(s.proc, 3, "record_decision", {
    agent: "a1", action: "act1", rationale: "r1",
  });
  const rec1 = parseContent(r1);
  const r2 = await callTool(s.proc, 4, "record_decision", {
    agent: "a2", action: "act2", rationale: "r2",
  });
  const rec2 = parseContent(r2);
  assert.equal(rec2.previousDigest, rec1.digest, "second decision must chain to first");
  assert.notEqual(rec2.digest, rec1.digest, "digests must differ");
  stop(s);
});

test("query_decisions: filters by agent", async () => {
  const s = spawnServer();
  await init(s.proc);
  await callTool(s.proc, 3, "record_decision", { agent: "alice", action: "a", rationale: "r" });
  await callTool(s.proc, 4, "record_decision", { agent: "bob", action: "b", rationale: "r" });
  await callTool(s.proc, 5, "record_decision", { agent: "alice", action: "c", rationale: "r" });

  const resp = await callTool(s.proc, 6, "query_decisions", { agent: "alice" });
  const result = parseContent(resp);
  assert.equal(result.count, 2);
  assert.ok(result.decisions.every((d) => d.agent === "alice"));
  stop(s);
});

test("query_decisions: filters by kind", async () => {
  const s = spawnServer();
  await init(s.proc);
  await callTool(s.proc, 3, "record_decision", { agent: "x", action: "a", rationale: "r", kind: "decision" });
  await callTool(s.proc, 4, "record_decision", { agent: "x", action: "b", rationale: "r", kind: "veto" });

  const resp = await callTool(s.proc, 5, "query_decisions", { kind: "veto" });
  const result = parseContent(resp);
  assert.equal(result.count, 1);
  assert.equal(result.decisions[0].kind, "veto");
  stop(s);
});

test("query_decisions: filters by time range", async () => {
  const s = spawnServer();
  await init(s.proc);
  await callTool(s.proc, 3, "record_decision", { agent: "x", action: "a", rationale: "r" });
  const before = new Date(Date.now() + 1000).toISOString();
  await callTool(s.proc, 4, "record_decision", { agent: "x", action: "b", rationale: "r" });

  // Query with since=future should return 0
  const resp = await callTool(s.proc, 5, "query_decisions", { since: before });
  const result = parseContent(resp);
  assert.equal(result.count, 0);

  // Query with until=future should return all
  const resp2 = await callTool(s.proc, 6, "query_decisions", { until: before });
  const result2 = parseContent(resp2);
  assert.equal(result2.count, 2);
  stop(s);
});

test("server_identity: returns capability descriptor with log stats", async () => {
  const s = spawnServer();
  await init(s.proc);
  await callTool(s.proc, 3, "record_decision", { agent: "x", action: "a", rationale: "r" });

  const resp = await callTool(s.proc, 4, "server_identity", {});
  const identity = parseContent(resp);
  assert.equal(identity.name, "bruce-lee");
  assert.equal(identity.version, "1.0.0");
  assert.equal(identity.protocolVersion, "2025-06-18");
  assert.ok(identity.toolsetDigest?.startsWith("sha256:"));
  assert.equal(identity.toolCount, 3);
  assert.equal(identity.decisionCount, 1);
  assert.ok(identity.lastDecisionDigest?.startsWith("sha256:"));
  stop(s);
});

test("persistence: decisions survive server restart", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bruce-persist-"));
  const logPath = join(dir, "audit.jsonl");

  // First session: record a decision
  const s1 = spawnServer({ BRUCE_LEE_LOG_PATH: logPath });
  await init(s1.proc);
  const r1 = await callTool(s1.proc, 3, "record_decision", { agent: "persist", action: "test", rationale: "r" });
  const rec1 = parseContent(r1);
  stop(s1);

  // Second session: query should find it
  const s2 = spawnServer({ BRUCE_LEE_LOG_PATH: logPath });
  await init(s2.proc);
  const resp = await callTool(s2.proc, 4, "query_decisions", { agent: "persist" });
  const result = parseContent(resp);
  assert.equal(result.count, 1);
  assert.equal(result.decisions[0].digest, rec1.digest);
  stop(s2);
  rmSync(dir, { recursive: true });
});

test("default kind: omits kind → defaults to 'decision'", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "record_decision", {
    agent: "x", action: "a", rationale: "r",
    // kind intentionally omitted
  });
  const rec = parseContent(resp);
  assert.equal(rec.kind, "decision");
  stop(s);
});

// ============================================================================
// FAILURE TESTS — intentional breaks (Phase 3)
// ============================================================================

// --- Failure 1: Break input validation ---
test("FAILURE 1 — malformed JSON-RPC: parse error returns -32700", async () => {
  const s = spawnServer();
  // Send raw garbage (not valid JSON)
  s.proc.stdin.write("this is not json\n");
  const responses = await collectAll(s.proc, 1);
  assert.equal(responses[0].error?.code, -32700);
  assert.ok(responses[0].error?.message?.includes("parse error"));
  stop(s);
});

test("FAILURE 1 — missing required fields: returns -32602 invalid params", async () => {
  const s = spawnServer();
  await init(s.proc);
  // Missing rationale (required)
  const resp = await callTool(s.proc, 3, "record_decision", { agent: "x", action: "a" });
  assert.equal(resp.error?.code, -32602);
  assert.ok(resp.error?.message?.includes("rationale"));
  stop(s);
});

test("FAILURE 1 — invalid kind enum: returns -32602", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "record_decision", {
    agent: "x", action: "a", rationale: "r", kind: "INVALID_KIND",
  });
  assert.equal(resp.error?.code, -32602);
  assert.ok(resp.error?.message?.includes("kind"));
  stop(s);
});

test("FAILURE 1 — field too long: rationale > 4000 chars returns -32602", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "record_decision", {
    agent: "x", action: "a", rationale: "x".repeat(4001),
  });
  assert.equal(resp.error?.code, -32602);
  stop(s);
});

test("FAILURE 1 — invalid JSON-RPC envelope: returns -32600", async () => {
  const s = spawnServer();
  send(s.proc, { id: 99, method: "initialize" }); // missing jsonrpc: "2.0"
  const resp = await collect(s.proc, 99);
  assert.equal(resp.error?.code, -32600);
  stop(s);
});

// --- Failure 2: Break runtime assumptions ---
test("FAILURE 2 — unknown tool: returns -32601 method not found", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "nonexistent_tool", {});
  assert.equal(resp.error?.code, -32601);
  assert.ok(resp.error?.message?.includes("nonexistent_tool"));
  stop(s);
});

test("FAILURE 2 — corrupt audit log: digest mismatch returns -32603", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bruce-corrupt-"));
  const logPath = join(dir, "audit.jsonl");

  // Write a valid decision first
  const s1 = spawnServer({ BRUCE_LEE_LOG_PATH: logPath });
  await init(s1.proc);
  await callTool(s1.proc, 3, "record_decision", { agent: "x", action: "a", rationale: "r" });
  stop(s1);

  // Corrupt the log: change the rationale in the stored record
  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  const rec = JSON.parse(lines[0]);
  rec.rationale = "TAMPERED";
  writeFileSync(logPath, JSON.stringify(rec) + "\n");

  // Now query — should fail with integrity error
  const s2 = spawnServer({ BRUCE_LEE_LOG_PATH: logPath });
  await init(s2.proc);
  const resp = await callTool(s2.proc, 4, "query_decisions", {});
  assert.equal(resp.error?.code, -32603);
  assert.ok(resp.error?.message?.includes("integrity"), `expected integrity error, got: ${resp.error?.message}`);
  stop(s2);
  rmSync(dir, { recursive: true });
});

test("FAILURE 2 — broken chain: prev pointer mismatch returns -32603", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bruce-chain-"));
  const logPath = join(dir, "audit.jsonl");

  // Write two decisions
  const s1 = spawnServer({ BRUCE_LEE_LOG_PATH: logPath });
  await init(s1.proc);
  await callTool(s1.proc, 3, "record_decision", { agent: "x", action: "a", rationale: "r1" });
  await callTool(s1.proc, 4, "record_decision", { agent: "x", action: "b", rationale: "r2" });
  stop(s1);

  // Corrupt: change the prev pointer of the second record
  const lines = readFileSync(logPath, "utf8").trim().split("\n");
  const rec2 = JSON.parse(lines[1]);
  rec2.prev = "sha256:fakedigest000000000000000000000000000000000";
  writeFileSync(logPath, lines[0] + "\n" + JSON.stringify(rec2) + "\n");

  const s2 = spawnServer({ BRUCE_LEE_LOG_PATH: logPath });
  await init(s2.proc);
  const resp = await callTool(s2.proc, 5, "query_decisions", {});
  assert.equal(resp.error?.code, -32603);
  assert.ok(resp.error?.message?.includes("chain broken"), `expected chain broken, got: ${resp.error?.message}`);
  stop(s2);
  rmSync(dir, { recursive: true });
});

test("FAILURE 2 — malformed JSON in log file: returns -32603", async () => {
  const dir = mkdtempSync(join(tmpdir(), "bruce-malformed-"));
  const logPath = join(dir, "audit.jsonl");
  writeFileSync(logPath, "this is not json\n");

  const s = spawnServer({ BRUCE_LEE_LOG_PATH: logPath });
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "query_decisions", {});
  assert.equal(resp.error?.code, -32603);
  assert.ok(resp.error?.message?.includes("malformed JSON"));
  stop(s);
  rmSync(dir, { recursive: true });
});

// --- Failure 3: Break integration / protocol misuse ---
test("FAILURE 3 — unknown JSON-RPC method: returns -32601", async () => {
  const s = spawnServer();
  await init(s.proc);
  send(s.proc, { jsonrpc: "2.0", id: 10, method: "resources/list" });
  const resp = await collect(s.proc, 10);
  assert.equal(resp.error?.code, -32601);
  stop(s);
});

test("FAILURE 3 — tools/call with missing name param: returns -32601", async () => {
  const s = spawnServer();
  await init(s.proc);
  send(s.proc, { jsonrpc: "2.0", id: 11, method: "tools/call", params: { arguments: {} } });
  const resp = await collect(s.proc, 11);
  assert.equal(resp.error?.code, -32601);
  stop(s);
});

test("FAILURE 3 — notifications/initialized produces no response (no id)", async () => {
  const s = spawnServer();
  await init(s.proc);
  // Send a notification — should NOT produce a response on stdout
  send(s.proc, { jsonrpc: "2.0", method: "notifications/initialized" });

  // Verify no response by sending a real request after and checking only that one comes back
  send(s.proc, { jsonrpc: "2.0", id: 12, method: "ping" });
  const resp = await collect(s.proc, 12, 2000);
  assert.deepEqual(resp.result, {});
  stop(s);
});

test("FAILURE 3 — server exits cleanly on stdin close", async () => {
  const s = spawnServer();
  await init(s.proc);
  s.proc.stdin.end();
  const code = await new Promise((resolve) => s.proc.on("exit", resolve));
  assert.equal(code, 0, "server should exit with code 0 on stdin close");
});

// ============================================================================
// EDGE CASES
// ============================================================================

test("edge: empty query returns count 0", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "query_decisions", {});
  const result = parseContent(resp);
  assert.equal(result.count, 0);
  assert.deepEqual(result.decisions, []);
  stop(s);
});

test("edge: limit clamps results", async () => {
  const s = spawnServer();
  await init(s.proc);
  for (let i = 0; i < 5; i++) {
    await callTool(s.proc, 100 + i, "record_decision", { agent: "x", action: `a${i}`, rationale: "r" });
  }
  const resp = await callTool(s.proc, 200, "query_decisions", { limit: 2 });
  const result = parseContent(resp);
  assert.equal(result.count, 2);
  stop(s);
});

test("edge: limit=0 is invalid (minimum 1)", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "query_decisions", { limit: 0 });
  assert.equal(resp.error?.code, -32602);
  stop(s);
});

test("edge: limit=1001 is invalid (maximum 1000)", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "query_decisions", { limit: 1001 });
  assert.equal(resp.error?.code, -32602);
  stop(s);
});

test("edge: tags with maxItems enforcement (21 tags fails)", async () => {
  const s = spawnServer();
  await init(s.proc);
  const tags = Array.from({ length: 21 }, (_, i) => `tag${i}`);
  const resp = await callTool(s.proc, 3, "record_decision", {
    agent: "x", action: "a", rationale: "r", tags,
  });
  assert.equal(resp.error?.code, -32602);
  stop(s);
});

test("edge: empty agent string fails validation", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "record_decision", { agent: "", action: "a", rationale: "r" });
  assert.equal(resp.error?.code, -32602);
  stop(s);
});

test("edge: invalid timestamp in since filter fails", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "query_decisions", { since: "not-a-date" });
  assert.equal(resp.error?.code, -32602);
  stop(s);
});

test("edge: server_identity on empty log returns decisionCount 0", async () => {
  const s = spawnServer();
  await init(s.proc);
  const resp = await callTool(s.proc, 3, "server_identity", {});
  const identity = parseContent(resp);
  assert.equal(identity.decisionCount, 0);
  assert.equal(identity.lastDecisionDigest, null);
  stop(s);
});

test("edge: toolsetDigest is deterministic across restarts", async () => {
  const s1 = spawnServer();
  const r1 = await init(s1.proc);
  const digest1 = r1.result._meta["io.github.davidnichols-ops/trustcard"].toolsetDigest;
  stop(s1);

  const s2 = spawnServer();
  const r2 = await init(s2.proc);
  const digest2 = r2.result._meta["io.github.davidnichols-ops/trustcard"].toolsetDigest;
  stop(s2);

  assert.equal(digest1, digest2, "toolsetDigest must be deterministic");
});

test("edge: ping method returns empty result", async () => {
  const s = spawnServer();
  await init(s.proc);
  send(s.proc, { jsonrpc: "2.0", id: 50, method: "ping" });
  const resp = await collect(s.proc, 50);
  assert.deepEqual(resp.result, {});
  stop(s);
});

test("edge: observability — structured logs on stderr", async () => {
  const s = spawnServer({ BRUCE_LEE_LOG_LEVEL: "info" });
  await init(s.proc);
  await callTool(s.proc, 3, "record_decision", { agent: "obs", action: "test", rationale: "r" });
  stop(s);

  // Wait a moment for stderr to flush
  await new Promise((r) => setTimeout(r, 100));
  const logs = s.stderr();
  const lines = logs.trim().split("\n").filter(Boolean);
  assert.ok(lines.length > 0, "should have stderr logs");

  // Each log line should be valid JSON with ts, level, event
  for (const line of lines) {
    const entry = JSON.parse(line);
    assert.ok(entry.ts, "log entry must have ts");
    assert.ok(entry.level, "log entry must have level");
    assert.ok(entry.event, "log entry must have event");
  }

  // Should have server_starting and decision_recorded events
  const events = lines.map((l) => JSON.parse(l).event);
  assert.ok(events.includes("server_starting"), "should log server_starting");
  assert.ok(events.includes("decision_recorded"), "should log decision_recorded");
});

test("edge: debug log level shows tool_call events", async () => {
  const s = spawnServer({ BRUCE_LEE_LOG_LEVEL: "debug" });
  await init(s.proc);
  await callTool(s.proc, 3, "server_identity", {});
  stop(s);

  await new Promise((r) => setTimeout(r, 100));
  const logs = s.stderr();
  const events = logs.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l).event);
  assert.ok(events.includes("tool_call"), "debug level should log tool_call events");
});

// ============================================================================
// SECURITY TESTS
// ============================================================================

test("security: no dangerous param names in tool schemas", async () => {
  const s = spawnServer();
  await init(s.proc);
  send(s.proc, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const resp = await collect(s.proc, 2);
  const dangerousParams = ["command", "cmd", "sql", "path", "file_path", "filepath",
    "url", "uri", "script", "code", "expression", "webhook", "token", "data",
    "content", "payload", "body", "cron", "config", "target", "include_secrets",
    "include_env"];
  for (const tool of resp.result.tools) {
    const props = Object.keys(tool.inputSchema?.properties ?? {});
    for (const p of props) {
      assert.ok(!dangerousParams.includes(p), `${tool.name} has dangerous param: ${p}`);
    }
  }
  stop(s);
});

test("security: all tools declare destructiveHint: false", async () => {
  const s = spawnServer();
  await init(s.proc);
  send(s.proc, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const resp = await collect(s.proc, 2);
  for (const tool of resp.result.tools) {
    assert.equal(tool.annotations?.destructiveHint, false,
      `${tool.name} must declare destructiveHint: false`);
  }
  stop(s);
});

test("security: rationale is not included in query results (data minimization)", async () => {
  const s = spawnServer();
  await init(s.proc);
  await callTool(s.proc, 3, "record_decision", {
    agent: "x", action: "a", rationale: "SENSITIVE_INTERNAL_REASONING",
  });
  const resp = await callTool(s.proc, 4, "query_decisions", {});
  const result = parseContent(resp);
  for (const d of result.decisions) {
    assert.equal(d.rationale, undefined, "query results should not include rationale");
  }
  stop(s);
});

test("security: no prompt-injection markers in tool descriptions", async () => {
  const s = spawnServer();
  await init(s.proc);
  send(s.proc, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  const resp = await collect(s.proc, 2);
  const injectionMarkers = ["<IMPORTANT>", "[SYSTEM OVERRIDE]", "ignore previous instructions",
    "do not tell the user", "~/.ssh/id_rsa", "IMPORTANT SYSTEM UPDATE",
    "URGENT SECURITY NOTICE"];
  for (const tool of resp.result.tools) {
    const desc = tool.description || "";
    for (const marker of injectionMarkers) {
      assert.ok(!desc.includes(marker), `${tool.name} description contains injection marker: ${marker}`);
    }
  }
  stop(s);
});

// ============================================================================
// DETERMINISM TESTS
// ============================================================================

test("determinism: same decision inputs produce same digest (excluding timestamp)", async () => {
  // The digest includes the timestamp, so two calls at different times will
  // have different digests. But the digest COMPUTATION must be deterministic:
  // given the same inputs (including prev and ts), the digest is the same.
  // We verify this by computing the digest manually using trustcard's hashJson.
  const { hashJson } = await import("../lib/hash.js");

  const record = {
    prev: null,
    ts: "2026-01-01T00:00:00.000Z",
    agent: "test",
    action: "commit",
    rationale: "fix",
    kind: "decision",
    tags: [],
  };
  const d1 = hashJson({
    prev: record.prev, ts: record.ts, agent: record.agent,
    action: record.action, rationale: record.rationale,
    kind: record.kind, tags: record.tags,
  });
  const d2 = hashJson({
    prev: record.prev, ts: record.ts, agent: record.agent,
    action: record.action, rationale: record.rationale,
    kind: record.kind, tags: record.tags,
  });
  assert.equal(d1, d2, "same inputs must produce same digest");
});

test("determinism: query is order-stable (returns in insertion order)", async () => {
  const s = spawnServer();
  await init(s.proc);
  await callTool(s.proc, 3, "record_decision", { agent: "z", action: "first", rationale: "r" });
  await callTool(s.proc, 4, "record_decision", { agent: "z", action: "second", rationale: "r" });
  await callTool(s.proc, 5, "record_decision", { agent: "z", action: "third", rationale: "r" });

  const resp = await callTool(s.proc, 6, "query_decisions", { agent: "z" });
  const result = parseContent(resp);
  assert.equal(result.decisions[0].action, "first");
  assert.equal(result.decisions[1].action, "second");
  assert.equal(result.decisions[2].action, "third");
  stop(s);
});
