// Tests for the McpServer framework (lib/mcp-server.js).
//
// Verifies that the framework correctly handles the JSON-RPC protocol,
// tool registration, error codes, trustcard-aware handshake, and the
// handler contract ({ ok, value } / { ok, error } / raw / ToolError).
import { test } from "node:test";
import assert from "node:assert/strict";
import { McpServer, ToolError, ERR_INVALID_PARAMS, ERR_METHOD_NOT_FOUND, ERR_INTERNAL } from "../lib/mcp-server.js";

// In-process test: create a server, call _handle directly (no stdio).
function makeServer(tools = []) {
  return new McpServer({ name: "test-server", version: "0.1.0", tools, logLevel: "error" });
}

test("constructor: requires name and version", () => {
  assert.throws(() => new McpServer({ version: "1.0" }), /name/);
  assert.throws(() => new McpServer({ name: "x" }), /version/);
});

test("constructor: requires destructiveHint annotation on every tool", () => {
  assert.throws(
    () => makeServer([{ name: "t", handler: () => {}, inputSchema: { type: "object" }, annotations: {} }]),
    /destructiveHint/
  );
});

test("constructor: requires handler and inputSchema", () => {
  assert.throws(() => makeServer([{ name: "t", inputSchema: {}, annotations: { destructiveHint: false } }]), /handler/);
  assert.throws(() => makeServer([{ name: "t", handler: () => {}, annotations: { destructiveHint: false } }]), /inputSchema/);
});

test("initialize: returns trustcard-aware handshake with toolsetDigest", () => {
  const s = makeServer([{ name: "ping", handler: () => 42, inputSchema: { type: "object" }, annotations: { destructiveHint: false } }]);
  const resp = s._handle({ jsonrpc: "2.0", id: 1, method: "initialize" });
  assert.equal(resp.result.protocolVersion, "2025-06-18");
  assert.equal(resp.result.serverInfo.name, "test-server");
  const binding = resp.result._meta["io.github.davidnichols-ops/trustcard"];
  assert.ok(binding.toolsetDigest.startsWith("sha256:"));
  assert.equal(binding.schema, "trustcard.dev/manifest@1");
});

test("tools/list: returns registered tools with annotations", () => {
  const s = makeServer([
    { name: "a", description: "tool a", handler: () => {}, inputSchema: { type: "object" }, annotations: { destructiveHint: false, readOnlyHint: true } },
    { name: "b", description: "tool b", handler: () => {}, inputSchema: { type: "object" }, annotations: { destructiveHint: true } },
  ]);
  const resp = s._handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
  assert.equal(resp.result.tools.length, 2);
  assert.equal(resp.result.tools[0].annotations.destructiveHint, false);
  assert.equal(resp.result.tools[1].annotations.destructiveHint, true);
});

test("tools/call: handler returns { ok, value } → wrapped in MCP content", () => {
  const s = makeServer([
    { name: "echo", handler: (args) => ({ ok: true, value: { echoed: args.x } }), inputSchema: { type: "object" }, annotations: { destructiveHint: false } },
  ]);
  const resp = s._handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "echo", arguments: { x: 42 } } });
  assert.equal(resp.result.isError, false);
  const parsed = JSON.parse(resp.result.content[0].text);
  assert.equal(parsed.echoed, 42);
});

test("tools/call: handler returns { ok: false, error } → JSON-RPC error", () => {
  const s = makeServer([
    { name: "validate", handler: () => ({ ok: false, error: { code: -32602, message: "bad input" } }), inputSchema: { type: "object" }, annotations: { destructiveHint: false } },
  ]);
  const resp = s._handle({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "validate", arguments: {} } });
  assert.equal(resp.error.code, -32602);
  assert.equal(resp.error.message, "bad input");
});

test("tools/call: handler throws ToolError → correct error code", () => {
  const s = makeServer([
    { name: "failing", handler: () => { throw new ToolError(-32602, "invalid param: x"); }, inputSchema: { type: "object" }, annotations: { destructiveHint: false } },
  ]);
  const resp = s._handle({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "failing", arguments: {} } });
  assert.equal(resp.error.code, -32602);
  assert.equal(resp.error.message, "invalid param: x");
});

test("tools/call: handler throws generic Error → -32603 internal error", () => {
  const s = makeServer([
    { name: "crash", handler: () => { throw new Error("unexpected"); }, inputSchema: { type: "object" }, annotations: { destructiveHint: false } },
  ]);
  const resp = s._handle({ jsonrpc: "2.0", id: 6, method: "tools/call", params: { name: "crash", arguments: {} } });
  assert.equal(resp.error.code, ERR_INTERNAL);
  assert.ok(resp.error.message.includes("unexpected"));
});

test("tools/call: handler returns raw value → wrapped in MCP content", () => {
  const s = makeServer([
    { name: "raw", handler: () => ({ direct: true }), inputSchema: { type: "object" }, annotations: { destructiveHint: false } },
  ]);
  const resp = s._handle({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "raw", arguments: {} } });
  const parsed = JSON.parse(resp.result.content[0].text);
  assert.equal(parsed.direct, true);
});

test("tools/call: unknown tool → -32601", () => {
  const s = makeServer([]);
  const resp = s._handle({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name: "nope", arguments: {} } });
  assert.equal(resp.error.code, ERR_METHOD_NOT_FOUND);
});

test("invalid JSON-RPC envelope → -32600", () => {
  const s = makeServer([]);
  const resp = s._handle({ id: 99, method: "initialize" });
  assert.equal(resp.error.code, -32600);
});

test("unknown method → -32601", () => {
  const s = makeServer([]);
  const resp = s._handle({ jsonrpc: "2.0", id: 10, method: "resources/list" });
  assert.equal(resp.error.code, ERR_METHOD_NOT_FOUND);
});

test("ping → empty result", () => {
  const s = makeServer([]);
  const resp = s._handle({ jsonrpc: "2.0", id: 11, method: "ping" });
  assert.deepEqual(resp.result, {});
});

test("notifications/initialized → null (no response)", () => {
  const s = makeServer([]);
  const resp = s._handle({ jsonrpc: "2.0", method: "notifications/initialized" });
  assert.equal(resp, null);
});

test("toolsetDigest is deterministic for the same toolset", () => {
  const tools = [
    { name: "a", handler: () => {}, inputSchema: { type: "object" }, annotations: { destructiveHint: false } },
  ];
  const s1 = new McpServer({ name: "s1", version: "1.0", tools, logLevel: "error" });
  const s2 = new McpServer({ name: "s2", version: "2.0", tools, logLevel: "error" });
  // toolsetDigest depends on the tools, not the server name/version
  assert.equal(s1.toolsetDigest, s2.toolsetDigest);
});
