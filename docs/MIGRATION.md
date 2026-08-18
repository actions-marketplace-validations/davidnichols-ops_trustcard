# Migration guide

This document explains how to move between trustcard versions and how each
new layer relates to the ones before it.

## Core rule

**Every trustcard version is additive over v1 identity bytes.** Existing pins,
receipts, manifests, and `toolDigest`/`toolsetDigest`/`serverDigest` values
continue to verify. New layers (v2 descriptors/policy/receipts, v3
behavior/evidence) are opt-in.

## v0.x → v3

The original `mcp-trustcard` health probe is now the `scan` subcommand.

| Old invocation | Current equivalent |
|---|---|
| `npx mcp-trustcard @modelcontextprotocol/server-github` | `mcp-trustcard scan @modelcontextprotocol/server-github` |
| `npx mcp-trustcard scan <spec> --json` | unchanged |
| `npx mcp-trustcard scan --batch servers/official.json --json-out results.json` | unchanged |

- A bare spec with no subcommand still runs the health scorecard.
- Exit code is still non-zero when the score is below 50.
- The GitHub Action (`action.yml`) is unchanged — it calls `scan`.

### What changed since v0.x

| Layer | v0.x | v3 |
|---|---|---|
| Tool identity | none (score-based) | `toolDigest`/`toolsetDigest`/`serverDigest` (content-addressed) |
| Provenance | none | Ed25519 signed manifests, TOFU pinning |
| Call-time enforcement | none | `mcp-proxy` with manifests, policy, auth scopes |
| Change classification | score delta | `NONE` → `BREAKING` taxonomy + multi-axis change vector |
| Behavioral verification | none | `mcp-trustcard behavior` |
| Evidence store | none | local `EvidenceStore` + evidence CLI |

## v1 → v3

v1 added the trust protocol (identity, provenance, TOFU, guard). v3 keeps all
of it and adds behavior, evidence, auth scopes, and the HTTP/SSE client.

### What keeps working unchanged

- All v1 manifests, pins, receipts, and signatures still verify.
- `lib/provenance.js`, `lib/trust.js`, `lib/guard.js`, `lib/pin.js` work as
  before.
- The `mcp-proxy` stdio proxy still enforces v1 manifests.

### What's new since v1

| Feature | CLI / API | Notes |
|---|---|---|
| Capability descriptors | `lib/descriptor.js` | protocol-neutral; `interfaceDigest()` equals `toolDigest()` |
| Gate 2 policy | `lib/policy.js` | per-invocation authorization, per-relying-party |
| Signed receipts | pass `receiptKey` to `Guard` | hash-chained Ed25519 |
| Key rotation / revocation | `lib/rotation.js` | old-key-signs-new, self-signed revocations |
| Per-agent auth scopes | `lib/auth.js`, `mcp-proxy --auth-*` | dev issuer + RFC 7662 introspection |
| Behavioral verification | `mcp-trustcard behavior` | deterministic probes, reference observation, regression corpus |
| Evidence store | `mcp-trustcard evidence *` | content-addressed, immutable |
| HTTP/SSE client | `lib/client-http.js` | experimental streamable-http transport |

## v2 → v3

v3 is purely additive over v2. v2 introduced descriptors, Gate 2 policy,
signed receipts, and rotation. v3 adds behavior, evidence, auth scopes, and
HTTP/SSE transport parity.

### What changed

- No v2 identity bytes or APIs changed.
- `lib/behavior.js` is new and does not affect `toolDigest`/`toolsetDigest`.
- `lib/evidence.js` is new and stores immutable, content-addressed records.
- `lib/client-http.js` is new and experimental.

### Adopting v3 features

#### Behavioral verification

```bash
# Capture a reference observation
mcp-trustcard behavior --server @modelcontextprotocol/server-memory \
  --json --out memory-reference.json

# Re-verify later or in CI
mcp-trustcard behavior memory-reference.json --json
```

No manifest or pin migration is needed. The behavior report references the same
`toolsetDigest` the rest of the system uses.

#### Evidence store

```bash
mcp-trustcard evidence query --subject <server-name>
mcp-trustcard evidence stats
mcp-trustcard evidence verify
```

The evidence store is local by default. It does not replace pins or manifests;
it records observations that can be queried and exported.

#### HTTP/SSE client

`lib/client-http.js` is an experimental drop-in for `McpStdioClient`. It is not
yet used by `mcp-proxy` by default.

## For server maintainers

To publish a trust card for your server:

```bash
npx mcp-trustcard keygen --out publisher.key.json   # once; guard the privateKey
npx mcp-trustcard manifest your-server --key publisher.key.json --out manifest.json
npx mcp-trustcard sign manifest.json --key publisher.key.json --out signed.json
```

Then reference it from your registry `server.json` `_meta` (see
`docs/REGISTRY-INTEGRATION.md`) or host it at a well-known URL.

To make your server *trustcard-aware* (closing the TOCTOU window for clients),
attach the binding to your `initialize` result — see `docs/SPEC.md` — and
emit `notifications/tools/list_changed` whenever your toolset changes.

## For agent frameworks

Wrap your existing MCP client; every `tools/call` is then gated and receipted:

```js
import { TrustSession } from "mcp-trustcard/lib/session.js";
import { TrustStore } from "mcp-trustcard/lib/trust.js";
import { Guard } from "mcp-trustcard/lib/guard.js";
import { wrapClient } from "mcp-trustcard/lib/middleware.js";

const trust = new TrustStore({ policy: { requireSignature: true } });
const guard = new Guard({ mode: "enforce", policy: { allowDestructive: false } });
const session = new TrustSession({ cmd, args, env, trust, guard });
await session.connect();

const secure = wrapClient(rawMcpClient, { guard, session, strictArgs: true });
await secure.request("tools/call", { name: "search", arguments: { query: "x" } });
```

## Compatibility checklist when adding features

- Does the change alter `toolDigest`/`toolsetDigest`/`serverDigest` bytes? If
  yes, it is a breaking change unless compatibility is proven.
- Does the change introduce runtime dependencies? If yes, it is probably out of
  scope for core.
- Does the change claim a security property that is not actually enforced?
  Update `docs/SECURITY-MODEL.md` and `docs/KNOWN-LIMITATIONS.md`.
- Does the change affect pin/receipt formats? Older formats must still read
  and verify.
