# Changelog

## [3.0.3] — 2026-08-11

Bug fix: `observeServer` now accepts and passes `cwd` through to `McpStdioClient`.
Previously, local commands invoked via `-- <cmd> [args...]` always spawned in the
proxy's working directory, ignoring `--cwd`. This broke fingerprint/manifest/pin
for any local server that needed to run from its project root.

### Fixed

- **`lib/observe.js`** — `observeServer({ cwd })` now forwards `cwd` to
  `McpStdioClient`, which passes it to `child_process.spawn`. All CLI
  subcommands that support local commands (`fingerprint`, `manifest`, `pin`)
  already threaded `cwd` through `runtimeOpts()` — the gap was in the library
  function itself.

### Tests

- 514 total (unchanged from 3.0.2 — the fix is a pass-through, covered by
  existing local-command tests that set `cwd` at the CLI layer).

## [3.0.2] — 2026-07-28

`manifest` and `pin` subcommands now support local commands via `-- <cmd> [args...]`,
matching `fingerprint` (added in 3.0.1). Full crypto workflow now works end-to-end
for local servers without npx.

### Added

- **`bin/mcp-trustcard.js`** — `cmdManifest` and `cmdPin` now use
  `parseLocalCommand()` + `runtimeOpts()` to accept `-- <cmd> [args...]` with
  `--cwd` and `--env` support. `cmdPin` uses the local command string as the
  pin key when no server info is available.
- **Colab notebook** — updated to 3.0.2 with full crypto workflow demo
  (keygen → manifest → sign → verify → pin → fingerprint).

## [3.0.1] — 2026-07-28

`fingerprint` subcommand now supports local commands via `-- <cmd> [args...]`.
Previously, `fingerprint` only worked with npm package specs (via `npx -y <spec>`).
Local servers (e.g. `mcp-trustcard fingerprint -- node my-server.js`) were not
supported.

### Added

- **`lib/fingerprint.js`** — `fingerprint()` now accepts `localCmd: { cmd, args,
  cwd, env }`. When provided, package identity is skipped (local commands have
  no npm package) and the server is observed directly.
- **`bin/mcp-trustcard.js`** — `cmdFingerprint` now uses `parseLocalCommand()`
  to detect `-- <cmd> [args...]` and threads `cwd`/`env` through.
- **Colab notebook** — added `trustcard_colab_demo.ipynb` for external usability
  without cloning the repo.

## [3.0.0] — 2026-07-27

Evidence substrate: the atomic primitive for MCP ecosystem observation. This
release ships two major additions over 2.2.1 — per-agent auth scope enforcement
(previously committed as 2.3.0 but unpublished) and the v3.0 evidence layer.

### Added — Evidence substrate

- **`lib/evidence.js`** — evidence record format: signed, content-addressed
  observations with predicate vocabulary, subject identity, confidence, and
  tamper-evident chaining via `manifestDigest`.
- **`lib/evidence-predicates.js`** — controlled vocabulary of 20+ observation
  predicates (`server-exists`, `server-responds`, `schema-duplicate`,
  `tool-count-changed`, etc.) with URN-style namespacing.
- **`lib/evidence-store.js`** — append-only JSONL store with day-partitioned
  files, in-memory index, digest verification, contradiction detection, and
  export to NDJSON.
- **`lib/evidence-adapters.js`** — adapters that convert probe outputs
  (existence checks, healthchecks, registry scans) into evidence records.
- **`lib/existence.js`** — Layer 1 existence verification: resolves a server
  spec to a package, repo, and runtime endpoint, classifying what exists vs
  what claims to exist.
- **`lib/client-http.js`** — HTTP/SSE MCP client for probing remote servers.
- **CLI `evidence` subcommand** — `query`, `history`, `stats`, `verify`,
  `export`, `contradictions` for inspecting evidence stores.
- **`scripts/scan-ecosystem.mjs`** — universal discovery scanner that crawls
  the npm registry for MCP servers and records existence evidence.
- **`scripts/crawl-registry.mjs`** — registry crawler that enumerates
  `@modelcontextprotocol/*` packages and MCP-tagged packages.

### Added — Auth scope enforcement (from unpublished 2.3.0)

- **`lib/auth.js`** — `DevIssuer` (HMAC-SHA256 JWT-like tokens for local dev),
  `IdpIntrospector` (RFC 7662 OAuth 2.1 token introspection), `TokenValidator`,
  `scopeSatisfies` (wildcard scope matching).
- **`requiredScopes` in manifest** — tools can declare required OAuth scopes;
  `checkCall` validates the caller's token against them.
- **`requireScopes` Gate 2 rule** — policy predicate for programmatic scope
  enforcement via the Guard.
- **Proxy auth flags** — `--auth-secret`, `--auth-introspect`, `--auth-client-id`,
  `--auth-client-secret`, `--auth-token-env`.
- **CLI `auth-issue` and `auth-verify`** subcommands.

### Tests

- 456 total (326 original + 43 auth + 81 evidence + 34 store + 15 adapters):
  evidence record format, predicate vocabulary, store append/verify/query/
  export/contradictions, adapter conversion, auth scope matching, token
  validation, introspection, proxy auth stripping.

### Breaking changes

None. All additions are new modules and CLI subcommands. Existing v2.x
manifests, pins, and receipts are unchanged. `interfaceDigest()` remains
byte-equal to `toolDigest()`.

## [2.3.0] — 2026-07-22

Per-agent auth scope enforcement. Tools can now declare `requiredScopes` in
the manifest, and the proxy validates a bearer token against those scopes
before forwarding the call to the server. Closes the "No Support for Complex
Auth Models" gap from the v2.2 threat model analysis.

### Added

- **`lib/auth.js`** — new module: `DevIssuer` (HMAC-SHA256 JWT-like tokens
  for local dev), `IdpIntrospector` (RFC 7662 OAuth 2.1 token introspection
  for external IdPs — Auth0, Okta, Keycloak, GitHub), `TokenValidator`
  (combines both — tries local first, falls back to introspection),
  `scopeSatisfies` (wildcard scope matching: `*` and `prefix:*`),
  `extractToken`/`stripAuth` (token extraction from MCP requests + metadata
  stripping before forwarding).
- **`requiredScopes` in manifest** — `buildManifest` now accepts a
  `scopeOverrides` parameter. Tools can declare scopes via
  `annotations._meta.requiredScopes` (server-declared) or `--require-scopes`
  CLI flag (operator-declared). `checkCall` validates the caller's `AuthToken`
  scopes against `requiredScopes` when auth is configured.
- **`requireScopes` Gate 2 rule** — new policy predicate in `lib/policy.js`
  for programmatic scope enforcement via the Guard. Supports per-tool or
  global scope requirements, with configurable verdict (`deny` or
  `require-approval`).
- **Proxy auth flags** — `mcp-proxy` now accepts `--auth-secret <hex>`,
  `--auth-introspect <url>`, `--auth-client-id`, `--auth-client-secret`,
  `--auth-token-env`. The proxy extracts a bearer token from each
  `tools/call` request (`_meta.auth.token` or `MCP_AUTH_TOKEN` env var),
  validates it, and strips auth metadata before forwarding to the server.
- **CLI subcommands** — `auth-issue` (issue a dev-mode token) and
  `auth-verify` (verify a dev-mode token and print claims).
- **`gen-manifest --require-scopes`** — repeatable flag to declare scope
  requirements per tool. Format: `--require-scopes <tool>:<scope1,scope2>`.
  Use `*` as tool name to apply to all tools.

### Tests

- 326 (283 + 43 new): scope matching (exact, wildcard, prefix, multi-require),
  AuthToken validity/expiry/inactive, DevIssuer roundtrip/wrong-secret/expired/
  no-expiry/malformed, token extraction from `_meta`/env/precedence, auth
  metadata stripping, `checkCall` scope enforcement (no-token, sufficient,
  insufficient, wildcard, expired, multi-scope), `buildManifest` scope
  overrides (CLI, server-declared, precedence), `requireScopes` Gate 2 rule
  (deny/allow/wildcard/per-tool/global/require-approval), `TokenValidator`
  (dev-issued, empty, unknown format).

## [2.2.1] — 2026-07-19

Patch release fixing two issues found in the v2.2.0 comparison report
(same 104-server census, same Colab environment, reproducible).

### Fixed

- **`create_directory` false positive (residual)** — v2.2.0's `silently`
  injection pattern over-matched "succeeds silently" in the official
  `@modelcontextprotocol/server-filesystem` description. "Succeed silently"
  and "fail silently" are standard API idioms meaning "idempotent, no error
  if already exists" — not secrecy instructions. Fix: `secretly`/`covertly`/
  `stealthily` are always suspicious (no benign use). `silently`/`quietly`
  are only suspicious when paired with a covert-action verb (`read silently`,
  `exfiltrate silently`). The safe-tool-pattern override now applies correctly
  to `create_directory`.
- **Unbracketed injection language missed** — v2.2.0 only matched
  `<IMPORTANT>` and `[SYSTEM OVERRIDE]` syntax. The sentinel-malicious server
  uses "IMPORTANT SYSTEM UPDATE" and "URGENT SECURITY NOTICE" without brackets
  — 6/8 tools were missed. Fix: added patterns for unbracketed system-message
  mimics: `(IMPORTANT|CRITICAL|URGENT) (SYSTEM|SECURITY|ADMIN|SAFETY)
  (UPDATE|NOTICE|REQUIREMENT|WARNING|ALERT|...)`. Benign "important" in
  normal context ("this is an important tool") does NOT match — the pattern
  requires the system/security/admin noun qualifier.

### Tests

- 283 (273 + 10 new): `succeed silently` / `fail silently` benign,
  `read silently` / `exfiltrate silently` flagged, `secretly` always flagged,
  unbracketed `IMPORTANT SYSTEM UPDATE` / `URGENT SECURITY NOTICE` /
  `CRITICAL SYSTEM REQUIREMENT` flagged, benign `important` not flagged.

## [2.2.0] — 2026-07-19

Adds a prompt-injection detector and fixes two false positives found in an
external MCP Census + Trustcard Evaluation Report (104 servers, 57 live,
1,218 tools, 5 rogue servers, 5 real-world tool-poisoning PoCs).

### Added

- **Prompt-injection detector** (third engine in the fusion) — scans tool
  descriptions for injection markers: `<IMPORTANT>` tags, `[SYSTEM OVERRIDE]`
  brackets, "ignore previous instructions", "do not tell the user", sensitive
  file paths (`~/.ssh/id_rsa`), secrecy instructions, base64 blobs,
  exfiltration language, system prompt extraction attempts. This is a separate
  threat class from destructive actions — a tool can have a benign schema
  ("add two numbers") with a weaponized description. Catches both real-world
  PoCs that v2.1 missed: malicious-demo-mcp-server (SSH key exfil via
  `<IMPORTANT>` block) and sentinel-malicious (`[SYSTEM OVERRIDE]`).

### Fixed

- **`sequentialthinking` false positive** — flagged on the verb "clear" in a
  thinking tool's description ("clear previous thinking to start fresh").
  This silently zeroed out the only tool the server exposes. Fix: context-aware
  verb scoring. `clear`/`reset`/`flush`/`clean`/`abort`/`disable` are only
  destructive when paired with destructive nouns (files, data, cache,
  database). Without a destructive noun, they're benign cognitive operations.
  Also whitelisted as a safe tool pattern.
- **`create_directory` false positive** — flagged because "create" is a write
  verb and the semantic engine matched "create write file disk storage". Fix:
  safe tool pattern whitelist (`create_directory`, `mkdir`, `sequentialthinking`).
  Override applies in the fusion layer unless the injection detector flags the
  description (a poisoned `create_directory` is still dangerous).

### Tests

- 273 (254 + 19 new): 6 false-positive / context-aware tests, 10 injection
  detector tests, 3 full-fusion tests with injection.

## [2.1.0] — 2026-07-19

Pre-freeze security model hardening. Clarity over capability — adds the
documentation and features needed for an external security engineer to
understand exactly what trustcard guarantees in one afternoon.

### Added

- **`docs/SECURITY-MODEL.md`** — guarantees table (20 rows: property,
  guaranteed?, mechanism, code location), two-gate model explained, trust-level
  projection (6 internal states → 4 human-facing levels), manifest freshness
  rules, schema versioning migration contract (5 rules), explicit non-goals.
- **Manifest expiration** — proxy manifests now carry `expiresAt` (default
  90 days). `checkCall` blocks all calls when expired, with a regeneration
  hint. `--expires-in <days>` and `--no-expiry` flags on `gen-manifest`.
- **Trust level projection** (`lib/trust.js`) — `trustLevel(state)` maps the
  6 internal states to 4 human-facing levels: TRUSTED / OBSERVED / UNTRUSTED
  / REVOKED. Internal state machine unchanged; this is a derived view for UIs.
- **`inspect` command** — `trustcard inspect <file>` works on proxy manifests,
  signed manifests, and pin stores. Shows expiry status, danger scores,
  overrides, verification errors.
- **Block explanations** (`bin/mcp-proxy.js`) — `explainDenial()` produces
  structured `data` in JSON-RPC error responses. Three denial types:
  `MANIFEST_EXPIRED`, `TOOL_NOT_APPROVED`, `DANGEROUS_TOOL`. Each includes
  explanation, metadata, and an action.
- **`--allow-tool` flag** on `gen-manifest` — explicitly mark a dangerous tool
  as allowed. Override recorded as `manualOverride: true` in the manifest.
- **Reference deployment** (`examples/production-agent/`) — architecture
  diagram, component descriptions, deployment steps, explicit non-goals.

### Tests

- 254 (243 + 11 new in `test/security-model.test.js`): trust level projection,
  manifest expiration, block explanation structure.

## [2.0.0] — 2026-07-19

Major release. Adds the v2 enforcement surface, closes two release-blocking
findings from a pre-release adversarial audit, **and unifies the two
development lines**. See [`docs/AUDIT-REPORT-v2.md`](docs/AUDIT-REPORT-v2.md).

**v2.0.0 is both the strongest MCP scanner and the first real capability-trust
substrate for agentic tools.** It merges the crypto/protocol line (descriptors,
Gate 2, receipts, rotation) with the scanner/proxy line (v0.4.0–v0.5.4: AI-fusion
danger detection, stdio + HTTP/SSE enforcement proxies, config secret scanning,
100-server leaderboard) into one tool. The scanner tells you *whether a server
looks healthy*; the protocol proves *the tool you called is the tool a publisher
signed*. Neither alone is sufficient — v2.0.0 is the union.

### Merged (scanner / proxy line, v0.4.0–v0.5.4)

- **AI-fusion danger detection** — heuristic (verb + parameter analysis) fused
  with a semantic engine (TF-IDF cosine similarity over a dangerous-actions
  corpus). Catches tool poisoning, schema shadowing, and novel attack patterns.
- **Call-time enforcement proxies** — `mcp-proxy` (stdio) and `mcp-http-proxy`
  (HTTP/SSE) enforce an approved tool manifest at call time, client-agnostic.
- **Config-file secret scanning** (`scan-config`) and proxy log **redaction**.
- **100-server leaderboard**, rogue-server test suite, and a supply-chain attack
  demo. CLI: parallel batch scanning, `--env-file`, local-command, `--strict`,
  `--threshold`. The unified CLI adds these to the crypto subcommands; the proxy
  manifest generator is `gen-manifest` (distinct from the crypto `manifest`).

### Added

- **Capability descriptors** — a protocol-neutral, publisher-signed projection
  of any tool source (MCP, OpenAPI, function-calling) into one canonical
  contract. Trust no longer depends on MCP-specific JSON shape. (`lib/descriptor.js`,
  `docs/DESCRIPTOR.md`)
- **Gate 2 invocation policy** — per-call argument re-validation against the
  *approved* descriptor's schema plus an optional per-tool arg policy, scoped per
  agent. Complements Gate 1 ("is this the tool we approved?"). (`lib/policy.js`)
- **Signed, chained receipts** — receipts are Ed25519-signed and hash-chained so
  history is tamper-evident and unforgeable end-to-end. (`lib/receipts.js`)
- **Publisher key rotation & revocation** — the old key signs an expiring
  rotation certificate to hand off trust; a revocation certificate retires a key
  permanently (no expiry, by design). (`lib/rotation.js`)

### Security (audit findings, fixed)

- **Receipt-chain verification now recomputes `receiptDigest`** for every receipt
  instead of trusting the embedded value. Previously a tampered receipt *body*
  that kept its chain fields passed verification. (Finding 1)
- **Rotation certificates now enforce `expiresAt`.** Previously a rotation cert
  could be replayed indefinitely, letting a stolen old key keep authorizing
  rotations. Revocation deliberately has no expiry. (Finding 2)

### Verification

- `npm test` → **243 tests, 243 pass, 0 fail** across the unified suite (crypto
  protocol + scanner/proxy), including the adversarial suite
  (`test/adversarial.test.js`, `test/audit-probes.test.js`) that executes the
  THREAT-MODEL attacks as real tests.
- Clean-install verified: `npm pack` → fresh install imports all v2 entry points.

### Docs

- SPEC: §12.1 what a signed receipt proves (and does not); §13.1 rotation expiry.
- THREAT-MODEL: v2 attack table (#12–#19).
- README: v2 features, updated test counts, doc links.

## [1.0.0]

v1: content-addressed tool identity, signed manifests, TOFU pinning, a
trust-state machine, an enforcement gate, and reproducibility receipts.
