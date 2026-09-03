// mcp-server.js — minimal framework for building well-behaved MCP servers.
//
// Extracted from Bruce Lee's protocol layer. Encapsulates the JSON-RPC 2.0
// envelope handling, tool registration, structured error codes, trustcard-aware
// handshake (toolsetDigest binding), and observability — so new MCP servers
// can focus on tool logic, not protocol boilerplate.
//
// Usage:
//   import { McpServer } from "../lib/mcp-server.js";
//
//   const server = new McpServer({
//     name: "my-server",
//     version: "1.0.0",
//     tools: [
//       {
//         name: "my_tool",
//         description: "Does something useful.",
//         inputSchema: { type: "object", properties: { ... }, required: [...] },
//         annotations: { readOnlyHint: true, destructiveHint: false },
//         handler: (args) => {
//           // Validate args, then return a JSON-serializable result.
//           // Throw { code: -32602, message: "..." } for invalid params.
//           return { ok: true, value: 42 };
//         },
//       },
//     ],
//   });
//
//   server.start();  // reads stdin, writes stdout, logs to stderr
//
// Design principles:
//   - Zero deps (Node stdlib + trustcard's own identity.js for toolsetDigest)
//   - Honest annotations enforced: every tool must declare destructiveHint
//   - Fail-closed: uncaught handler exceptions → -32603, never silent
//   - Structured stderr logs (stdout is the transport)
//   - trustcard-aware: toolsetDigest committed at handshake

import { toolsetDigest, TRUSTCARD_META_KEY, MANIFEST_SCHEMA_VERSION } from "./identity.js";
import { createHash } from "node:crypto";

const PROTOCOL_VERSION = "2025-06-18";

// JSON-RPC error codes
export const ERR_PARSE = -32700;
export const ERR_INVALID_REQUEST = -32600;
export const ERR_METHOD_NOT_FOUND = -32601;
export const ERR_INVALID_PARAMS = -32602;
export const ERR_INTERNAL = -32603;

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

// Custom error for structured validation failures inside handlers.
export class ToolError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "ToolError";
  }
}

export class McpServer {
  constructor({ name, version, tools = [], logLevel = "info", logFields = {} }) {
    if (!name || typeof name !== "string") throw new Error("McpServer requires a name");
    if (!version || typeof version !== "string") throw new Error("McpServer requires a version");
    this.name = name;
    this.version = version;
    this.logLevel = logLevel;
    this.logFields = logFields;

    // Validate and register tools
    this.tools = new Map();
    for (const t of tools) {
      this._registerTool(t);
    }

    // Precompute toolsetDigest for trustcard-aware handshake
    this._toolsetDigest = toolsetDigest(tools);
  }

  _registerTool(t) {
    if (!t.name || typeof t.name !== "string") throw new Error(`tool missing name`);
    if (typeof t.handler !== "function") throw new Error(`tool ${t.name} missing handler`);
    if (!t.inputSchema || typeof t.inputSchema !== "object") {
      throw new Error(`tool ${t.name} missing inputSchema`);
    }
    // Enforce honest annotations — destructiveHint must be explicitly set
    if (t.annotations?.destructiveHint === undefined) {
      throw new Error(`tool ${t.name} must declare annotations.destructiveHint`);
    }
    this.tools.set(t.name, t);
  }

  _log(level, event, fields = {}) {
    if (LEVELS[level] < LEVELS[this.logLevel]) return;
    const entry = { ts: new Date().toISOString(), level, event, server: this.name, ...this.logFields, ...fields };
    process.stderr.write(JSON.stringify(entry) + "\n");
  }

  _send(msg) {
    process.stdout.write(JSON.stringify(msg) + "\n");
  }

  _error(id, code, message) {
    return { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
  }

  _result(id, result) {
    return { jsonrpc: "2.0", id, result };
  }

  _handle(msg) {
    if (!msg || typeof msg !== "object" || msg.jsonrpc !== "2.0") {
      return this._error(msg?.id, ERR_INVALID_REQUEST, "invalid JSON-RPC 2.0 envelope");
    }
    const { id, method, params } = msg;

    if (method === "initialize") {
      return this._result(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: this.name, version: this.version },
        _meta: {
          [TRUSTCARD_META_KEY]: {
            schema: MANIFEST_SCHEMA_VERSION,
            toolsetDigest: this._toolsetDigest,
          },
        },
      });
    }

    if (method === "notifications/initialized") {
      this._log("info", "client_initialized");
      return null;
    }

    if (method === "tools/list") {
      const tools = [...this.tools.values()].map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
        annotations: t.annotations,
        ...(t.outputSchema ? { outputSchema: t.outputSchema } : {}),
      }));
      return this._result(id, { tools });
    }

    if (method === "tools/call") {
      const toolName = params?.name;
      const toolArgs = params?.arguments ?? {};
      const tool = this.tools.get(toolName);
      if (!tool) {
        return this._error(id, ERR_METHOD_NOT_FOUND, `unknown tool: ${toolName}`);
      }
      this._log("debug", "tool_call", { tool: toolName, id });
      try {
        const result = tool.handler(toolArgs);
        // If handler returns { ok: false, error }, it's a validation failure
        if (result && result.ok === false) {
          return this._error(id, result.error?.code ?? ERR_INVALID_PARAMS, result.error?.message ?? "invalid params");
        }
        // If handler returns { ok: true, value }, wrap value in MCP content
        if (result && result.ok === true) {
          return this._result(id, {
            content: [{ type: "text", text: JSON.stringify(result.value, null, 2) }],
            isError: false,
          });
        }
        // Handler returned a raw value — wrap it
        return this._result(id, {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
          isError: false,
        });
      } catch (e) {
        if (e instanceof ToolError) {
          this._log("warn", "tool_error", { tool: toolName, code: e.code, message: e.message });
          return this._error(id, e.code, e.message);
        }
        this._log("error", "tool_exception", { tool: toolName, error: e.message, stack: e.stack });
        return this._error(id, ERR_INTERNAL, `internal error in ${toolName}: ${e.message}`);
      }
    }

    if (method === "ping") {
      return this._result(id, {});
    }

    return this._error(id, ERR_METHOD_NOT_FOUND, `method not found: ${method}`);
  }

  start() {
    this._log("info", "server_starting", { version: this.version, toolsetDigest: this._toolsetDigest, toolCount: this.tools.size });

    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, idx).trim();
        buffer = buffer.slice(idx + 1);
        if (!line) continue;
        let msg;
        try {
          msg = JSON.parse(line);
        } catch {
          this._send(this._error(null, ERR_PARSE, "parse error: malformed JSON"));
          continue;
        }
        const response = this._handle(msg);
        if (response !== null) this._send(response);
      }
    });

    process.stdin.on("end", () => {
      this._log("info", "server_stopping");
      process.exit(0);
    });

    process.on("uncaughtException", (e) => {
      this._log("error", "uncaught_exception", { error: e.message, stack: e.stack });
    });
  }

  // Expose for testing
  get toolsetDigest() {
    return this._toolsetDigest;
  }
}
