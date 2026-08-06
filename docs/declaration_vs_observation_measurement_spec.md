# Declaration-vs-Observation Measurement Specification

**Date:** 2026-07-30
**Status:** Specification — not yet implemented
**Predecessor:** `trustcard_verification_research_plan.md`
**Objective:** Define exactly what must be collected to answer:

> What does the registry declare, and what does the server actually
> advertise/require during a naive client interaction?

---

## 1. Identity strategy

### Primary key: registry server name

The scan data is derived directly from the registry crawl data. The
`serverName` field in the scan output is the `name` field from the
registry crawl, which is the `server.name` field from the registry API.

**Verification (2026-07-30):** 100/100 scan names match registry crawl
names. The Cycle 2 "0/100 match" was a pagination bug in the analysis
script (used `nextCursor` instead of `metadata.nextCursor`), not a real
identity problem.

### Join path

```
Registry API → crawl-registry.mjs → mcp-registry-YYYY-MM-DD.json
                                          ↓
                                    scan-ecosystem.mjs
                                          ↓
                              mcp-ecosystem-YYYY-MM-DD.json
```

The registry crawl now captures declaration fields (env vars, package
args, runtime args, headers). The scan now captures capabilities from
the initialize response. Both use the same server name as the join key.

### No fuzzy matching

Identity is exact string match on `server.name`. No fuzzy matching,
no normalization, no heuristic joins. If the names don't match, they
are different servers.

---

## 2. Registry-side data (what the registry declares)

Captured by `crawl-registry.mjs` from the registry API:

| Field | Source | Type | Description |
|-------|--------|------|-------------|
| `name` | `server.name` | string | Canonical registry identifier |
| `version` | `server.version` | string | Server version |
| `transport` | classified | enum | stdio, remote, both, unknown |
| `npmSpec` | `packages[].identifier` | string? | npm package spec |
| `remoteUrl` | `remotes[].url` | string? | Remote endpoint URL |
| `repoUrl` | `repository.url` | string? | Repository URL |
| `declaredEnvVars` | `packages[].environmentVariables` | array | `{name, description, isRequired}` |
| `declaredPackageArgs` | `packages[].packageArguments` | array | `{name, description, isRequired}` |
| `declaredRuntimeArgs` | `packages[].runtimeArguments` | array | `{name, description, isRequired}` |
| `declaredHeaders` | `remotes[].headers` | array | `{name, description, isRequired}` |

**Note:** The registry does NOT have a `capabilities` declaration field.
Server capabilities are advertised at runtime via the initialize
response, not declared in the registry. This is by design —
capabilities are protocol-level, not registry-level.

---

## 3. Runtime-side data (what the server advertises/requires)

Captured by `scan-ecosystem.mjs` → `checks.js`:

### During initialize

| Field | Source | Type | Description |
|-------|--------|------|-------------|
| `serverInfo` | `initResult.serverInfo` | object? | `{name, version}` |
| `protocolVersion` | `initResult.protocolVersion` | string? | Negotiated protocol version |
| `capabilities` | `initResult.capabilities` | object? | Server capabilities (tools, resources, prompts, etc.) |
| `handshake` | check result | enum | PASS, FAIL, CONFIG_REQUIRED |
| `latencyMs` | timing | number | Time to first response |

### After initialize (if handshake succeeds)

| Field | Source | Type | Description |
|-------|--------|------|-------------|
| `tools` | `tools/list` | array | Tool definitions |
| `toolCount` | count | number | Number of tools |
| `schemaValid` | validation | boolean | All tool schemas valid |

### Configuration requirements (inferred from failures)

| Field | Source | Type | Description |
|-------|--------|------|-------------|
| `configRequired` | failure analysis | boolean | Server requires config to start |
| `configReason` | failure analysis | string? | What config is missing |
| `stderr` | process stderr | string? | Last 800 chars of stderr |

---

## 4. Comparison taxonomy

Every declaration/observation comparison falls into exactly one
category. Categories are mutually exclusive and collectively exhaustive.

### MATCH

Registry declaration agrees with observed behavior.

Example: Registry declares env var `API_KEY` with `isRequired: true`.
Server fails to start without `API_KEY` → MATCH.

Example: Registry declares transport `stdio` with npmSpec `foo@1.0`.
Server launches via `npx -y foo@1.0` and completes handshake → MATCH.

### DECLARED_UNOBSERVED

Registry declares something that could not be observed.

Example: Registry declares env var `API_KEY` with `isRequired: true`.
Server starts successfully without `API_KEY` (either doesn't enforce it,
or has a default) → DECLARED_UNOBSERVED.

Example: Registry declares package argument `--port`. Server starts
without `--port` → DECLARED_UNOBSERVED.

### OBSERVED_UNDECLARED

Runtime requires/exposes something not represented by the registry
declaration.

Example: Registry declares no env vars. Server fails without `API_KEY`
set → OBSERVED_UNDECLARED.

Example: Registry declares no capabilities. Server advertises
`tools.listChanged` in initialize response → OBSERVED_UNDECLARED
(capabilities are not registry-declared, but this is by design —
see §2 note).

### CONFLICT

Registry declaration explicitly contradicts observed behavior.

Example: Registry declares transport `remote` with URL `https://foo.com`.
Server at that URL is not an MCP server → CONFLICT.

Example: Registry declares npmSpec `foo@1.0`. `npx -y foo@1.0` installs
a package that is not an MCP server → CONFLICT.

### UNKNOWN

Insufficient evidence to classify.

Example: Server fails to start, but the failure reason is ambiguous
(could be missing config, could be network issue, could be package
not found) → UNKNOWN.

Example: Server starts but doesn't respond to initialize within
timeout → UNKNOWN (can't determine capabilities or requirements).

---

## 5. What is NOT compared

### Capabilities vs registry declarations

Capabilities are NOT declared in the registry. They are advertised at
runtime via the initialize response. Therefore, observing capabilities
that aren't in the registry is NOT OBSERVED_UNDECLARED — it's expected
behavior. Capabilities are a protocol-level concept, not a
registry-level concept.

This means the MCP SDK #2473 question ("do servers declare
capabilities they don't support?") can only be answered by comparing
the initialize response `capabilities` field with actual method
behavior (e.g., server declares `tools.listChanged: true` but doesn't
send `notifications/tools/list_changed`).

### Tool schemas vs registry declarations

Tool schemas are not in the registry. They are exposed at runtime via
`tools/list`. Tool schema analysis is a separate research question
(trustcard's danger detection), not part of the declaration-vs-
observation matrix.

---

## 6. Independent verification design

### Primary instrument: trustcard scanner

The trustcard scanner (`checks.js`) is the primary instrument. It
performs naive-client probing and records the results.

### Secondary instrument: manual curl / direct JSON-RPC

For critical classifications (CONFLICT, OBSERVED_UNDECLARED), a
secondary verification is performed using direct `curl` or a minimal
JSON-RPC client that does NOT use trustcard's code. This catches
instrument-specific bugs (e.g., trustcard's protocol negotiation
logic might be wrong).

### What the secondary instrument checks

For a sample of CONFLICT and OBSERVED_UNDECLARED classifications:
1. Does `curl` to the remote URL return a valid MCP initialize response?
2. Does `npx -y <pkg>` with no args/env actually fail?
3. Does the failure message actually mention the missing config?

### Controls

- **UNKNOWN is preserved.** If the secondary instrument also can't
  determine the classification, it stays UNKNOWN. It is NOT upgraded
  to MATCH or CONFLICT based on speculation.
- **Disagreements are recorded.** If the secondary instrument disagrees
  with the primary, both results are kept. The disagreement is NOT
  silently resolved.
- **Environmental confounders are noted.** Network issues, npm
  rate limiting, and package availability changes between runs are
  recorded as potential confounders.

---

## 7. What the measurement produces

The output is NOT a single "health score" or "declaration accuracy
percentage." The output is a matrix:

| Server | Transport | Env Vars | Pkg Args | Runtime Args | Headers | Handshake | Capabilities |
|--------|-----------|----------|----------|--------------|---------|-----------|--------------|
| foo | MATCH | DECLARED_UNOBSERVED | UNKNOWN | UNKNOWN | N/A | MATCH | OBSERVED_UNDECLARED |
| bar | MATCH | OBSERVED_UNDECLARED | UNKNOWN | UNKNOWN | N/A | FAIL | UNKNOWN |
| baz | CONFLICT | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN | UNKNOWN |

Each cell is one of: MATCH, DECLARED_UNOBSERVED, OBSERVED_UNDECLARED,
CONFLICT, UNKNOWN, or N/A (field not applicable for this transport
type).

### Aggregate statistics (reported with caveats)

- X% of servers with declared env vars have MATCH (n=denominator)
- Y% of servers have OBSERVED_UNDECLARED env vars (n=denominator)
- Z% of classifications are UNKNOWN

**The denominator is always reported.** "4% of servers declare env
vars" is meaningless without "n=100, sample=registry crawl 2026-07-27."

**No headline percentage is calculated until the taxonomy and
denominator are defensible.**

---

## 8. Implementation status

| Component | Status | Notes |
|-----------|--------|-------|
| Registry crawl captures declarations | DONE | `crawl-registry.mjs` updated 2026-07-30 |
| Scanner captures capabilities | DONE | `checks.js` updated 2026-07-30 |
| Scan output includes capabilities | DONE | `scan-ecosystem.mjs` updated 2026-07-30 |
| Identity join verified | DONE | 100/100 names match (2026-07-30) |
| Comparison taxonomy | DONE | This document |
| Matrix builder | NOT STARTED | Needs new script |
| Independent verification | NOT STARTED | Needs manual protocol |
| Re-scan with fixed instrumentation | NOT STARTED | Needs human approval to run |

---

## 9. What would make SDK #2473 actionable

The MCP SDK #2473 question is:

> Do servers declare capabilities they don't actually support?

To answer this, we need:

1. **Capabilities from initialize response** — DONE (scanner now captures)
2. **Capability-gated method behavior** — NOT DONE
   - For each declared capability, test the corresponding method
   - e.g., if `capabilities.tools.listChanged: true`, subscribe to
     `notifications/tools/list_changed` and see if it's sent
   - e.g., if `capabilities.resources: {}`, call `resources/list`
3. **Cross-reference** — NOT DONE
   - Compare declared capabilities with method behavior
   - Classify as MATCH (declared and works), DECLARED_UNOBSERVED
     (declared but method not tested), CONFLICT (declared but method
     fails), UNKNOWN (can't determine)

**Important:** Do NOT call methods that the server has not advertised
as supported. If a server doesn't declare `capabilities.resources`,
do NOT call `resources/list` to "test" it — that would manufacture
failures.

The earliest SDK #2473 could become actionable is after:
1. Re-scan with fixed instrumentation (captures capabilities)
2. Build capability-gated method test
3. Independent verification of CONFLICT classifications
4. All five gates passed

**Current posture: not yet actionable. Do not post.**
