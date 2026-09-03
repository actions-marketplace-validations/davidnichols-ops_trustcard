# Trustcard Security Model

> **The one-sentence version:** trustcard guarantees that the tool an agent
> calls is bit-for-bit the tool a known publisher signed and the client pinned,
> that the running server passed the behavioral probes the operator chose to run,
> and that the whole chain is recorded as tamper-evident evidence — or it stops
> the call and says exactly what changed. It does not guarantee the tool is
> *good*.

This document states what trustcard v3.0.3 guarantees, what it does not, and
the mechanism behind each claim. Read it before deploying trustcard anywhere
someone will ask "but does it protect against X?"

For attack-by-attack analysis, see [THREAT-MODEL.md](THREAT-MODEL.md).
For wire format and field semantics, see [SPEC.md](SPEC.md).
For behavioral verification, see [BEHAVIOR.md](BEHAVIOR.md).
For the long-term direction, see [ROADMAP-2Y.md](ROADMAP-2Y.md).

## Security guarantees

| Property | Guaranteed? | Mechanism | Code |
|---|---|---|---|
| Detect tool definition drift | **Yes** | Capability digest (SHA-256 of JCS-canonicalized semantic projection). Any change to name, description, inputSchema, outputSchema, or annotations alters the digest. | `lib/identity.js` |
| Detect tool addition/removal | **Yes** | `toolsetDigest` is the sorted hash of all tool digests. Adding or removing a tool changes it. | `lib/identity.js` |
| Classify change severity | **Yes** | Five-level taxonomy: NONE < SYNTACTIC < NON_BREAKING < ANNOTATION_DOWNGRADE < PERMISSION_CHANGE < BREAKING. | `lib/diff.js` |
| Detect implementation replacement | **Yes** | `changeVector()` across interface/permission/implementation/provenance axes. `I_id` same + `M_id` changed → `implementation:"REPLACED"`. | `lib/change.js`, `lib/descriptor.js` |
| Verify publisher authorization | **Yes** | Ed25519 signature over the JCS-canonicalized manifest payload. | `lib/provenance.js` |
| Verify publisher key continuity | **Yes** | TOFU pinning: first-seen key is pinned; a different key for the same keyId is drift. | `lib/pin.js` |
| Detect server serving different tools than signed | **Yes** | `bindingConsistency()` compares manifest's `toolsetDigest` to live observation. | `lib/provenance.js` |
| Prevent unauthorized tool calls | **Yes** | Guard: server must be PINNED, tool in verified toolset, destructive tools require opt-in, Gate 2 policy rules per-call. | `lib/guard.js`, `lib/policy.js` |
| Prevent calls to unknown tools | **Yes** | `allowUnknownTools: false` by default. | `lib/guard.js` |
| Prevent calls with schema-violating args | **Yes** (strict mode) | `validateArgs()` walks approved `inputSchema`. | `lib/guard.js` |
| Prove what was authorized and called | **Yes** (with receipt key) | Signed, hash-chained Ed25519 receipts bind contract, args, and result. | `lib/receipts.js` |
| Detect receipt chain tampering | **Yes** | `verifyReceiptChain` recomputes each receipt's digest and checks parentReceipt links. | `lib/receipts.js` |
| Detect manifest tampering | **Yes** | `verifyManifest` recomputes `manifestDigest`, `toolsetDigest`, and `serverDigest`. | `lib/provenance.js` |
| Enforce manifest/rotation freshness | **Yes** | `expiresAt` on signed manifests and rotation certs; revocations have no expiry. | `lib/provenance.js`, `lib/rotation.js` |
| Enforce per-agent auth scopes | **Yes** (with auth configured) | `requiredScopes` in manifest, token validation via dev issuer or RFC 7662 introspection, wildcard scope matching. | `lib/auth.js`, `lib/manifest.js`, `lib/policy.js` |
| Detect declared dangerous capabilities | **Partial** | Three-engine static analysis: heuristic, TF-IDF semantic, injection marker. Catches known patterns; cannot detect a tool that lies without using known markers. | `lib/danger-detector.js` |
| Detect behavioral divergence from a reference | **Partial** | `BehaviorEngine` runs deterministic probes and compares to a `ReferenceObservation`. Catches prompt injection, canary leakage, exfiltration URLs, stderr network/fs/process events, schema violations, output drift. Bounded by probe coverage and the honesty of the reference. | `lib/behavior.js` |
| Record and query tamper-evident evidence | **Yes** | Evidence records are JCS + SHA-256 content-addressed, signed by observer, stored immutably. | `lib/evidence.js`, `lib/evidence-store.js` |
| Close TOCTOU window (discovery → call) | **Partial** | Fully closed for cooperating servers (handshake binding). For non-cooperating servers, bounded by `list_changed` re-diff + strict arg validation + receipts. Not eliminated. | `lib/session.js` |
| **Prove tool behavior is safe in all cases** | **No** | Out of scope. trustcard detects *observable* divergence for the probes it runs. A server can pass all probes and still misbehave on an unprobed input. | — |
| **Prevent malicious publishers** | **No** | Cryptography proves provenance, not intent. The scanner, danger detector, and behavioral probes are mitigations, not guarantees. | — |
| **Guarantee publisher key safety** | **No** | Key compromise is a standard key-hygiene problem. Rotation is break-glass. No HSM/KMS integration yet. | — |
| **Guarantee registry integrity** | **No** | The registry is transport. A compromised registry can substitute manifests, but cannot forge publisher signatures. | — |
| **Provide a universal PKI** | **No** | TOFU + break-glass rotation is a deliberate decentralized choice. | — |
| **Provide OS-level runtime containment** | **No** | The default behavioral sandbox is a Node stdio harness. Network/filesystem/process blocking requires an optional OS backend (roadmap Y2-H1). | — |

## The two gates + one behavioral check

trustcard separates three questions that are often conflated:

### Gate 1 — Trust-state continuity (objective, cacheable)

> "Is this still the capability I established?"

Answered by comparing the live observation against the pinned state:
`toolsetDigest`, `serverDigest`, publisher key. The result is a trust-state
transition. This is objective — every client with the same pin reaches the same
verdict.

**Code:** `lib/trust.js`, `lib/diff.js`, `lib/identity.js`

### Gate 2 — Invocation authorization (subjective, per-relying-party)

> "Given that the capability is still trusted, may *this* invocation — with
> *these* args, in *this* environment, by *this* relying party — run?"

Answered by composable rule predicates. A tool can be trusted while a specific
invocation is denied. Gate 2 only ever *restricts* access.

**Code:** `lib/policy.js`, `lib/guard.js`

### Behavioral check — Runtime contract fidelity (empirical, probe-bounded)

> "Does the running code honor the contract for the inputs I am willing to test?"

Answered by `BehaviorEngine`. It is intentionally separate from Gate 1: a
server can have a byte-identical contract and still diverge at runtime. The
behavior check can fail while Gate 1 passes.

**Code:** `lib/behavior.js`

## Why the separation matters

Collapsing Gate 1 and Gate 2 forces a single global policy, destroying the
per-relying-party model. Collapsing behavior into Gate 1 would pretend that
static identity implies runtime honesty, which it does not.

## Trust-state machine → trust level projection

| Internal state | Trust level | Human meaning |
|---|---|---|
| PINNED | TRUSTED | pinned, verified, calls allowed |
| OBSERVED | OBSERVED | seen but not pinned; calls denied |
| SUSPECT | OBSERVED | something looks off; calls denied |
| UNKNOWN | OBSERVED | never seen; calls denied |
| MISMATCH | UNTRUSTED | contract changed; calls blocked |
| REVOKED | REVOKED | terminal; calls blocked; human re-pin required |

The internal state machine is unchanged. `trustLevel()` is a derived projection
for display/API consumers.

## Manifest freshness

### Signed manifests (publisher provenance)

Signed manifests (`lib/provenance.js`) carry `issuedAt` and `expiresAt`.
`verifyManifest` rejects an expired manifest, preventing a five-year-old
signature from being treated as current.

```text
Valid signature + not expired + not revoked = trusted.
Any failure = not trusted.
```

### Proxy manifests (call-time enforcement)

Proxy manifests (`lib/manifest.js`, produced by `gen-manifest`) carry
`createdAt` and `expiresAt`. `checkCall` rejects calls when expired. Default
expiry is 90 days. This re-runs the danger detector when regenerated.

## Per-agent auth scopes

tools declare `requiredScopes` (CLI override, server annotations, or `_meta`),
and the proxy validates a bearer token against those scopes before forwarding
the call. Auth metadata is stripped before reaching the server.

- **Dev issuer:** `mcp-trustcard auth-issue` creates HMAC-SHA256 JWT-like tokens
  for local development.
- **External IdP:** RFC 7662 token introspection for any OAuth 2.1 provider.
- **Gate 2 rule:** `requireScopes` can also be used programmatically via the Guard.

Scope matching supports `*` and `prefix:*`. A call is allowed only if every
required scope is satisfied.

## Schema versioning and migration

trustcard uses reverse-DNS schema identifiers with `@version` suffixes:

| Artifact | Schema | Code constant |
|---|---|---|
| Manifest | `trustcard.dev/manifest@1` | `MANIFEST_SCHEMA_VERSION` |
| Receipt | `trustcard.dev/receipt@1` | — |
| Capability descriptor | `trustcard.dev/descriptor@1` | — |
| Key rotation cert | `trustcard.dev/key-rotation@1` | `ROTATION_SCHEMA_VERSION` |
| Revocation cert | `trustcard.dev/revocation@1` | `REVOCATION_SCHEMA_VERSION` |
| Pin store | `trustcard.dev/pins@1` | `PINFILE_SCHEMA` |
| Evidence record | `trustcard.dev/evidence@1` | `EVIDENCE_SCHEMA` |

### Migration contract

1. A v(N+1) verifier MUST read vN.
2. A vN verifier MUST reject v(N+1) as a verification failure.
3. A v(N+1) verifier MUST reject unknown critical fields.
4. Signatures are preserved across reads.
5. Manifest versions are immutable.

## What trustcard is not

- **Not a sandbox.** trustcard does not restrict what a tool can do at runtime.
  The default behavioral harness watches process output; it does not block
  network, filesystem, or process spawn. Use OS-level isolation for runtime
  containment.
- **Not a policy engine.** Gate 2 is a small set of composable rule predicates,
  not a policy language.
- **Not a registry.** trustcard defines formats and verification protocols. The
  pin store is local TOFU state.
- **Not an AI safety system.** The danger detector and behavioral probes catch
  known patterns and observable divergences. Novel attacks that avoid the probe
  set or known markers may pass through.

## Known limitations

For the current list, see [KNOWN-LIMITATIONS.md](KNOWN-LIMITATIONS.md).

The high-level residual risks are:

- Behavioral verification is probe-bounded and cannot prove absence of malice.
- The default sandbox is a harness, not an OS jail.
- Pattern-based injection detection catches known markers; novel markers may
  pass.
- A malicious but signed capability is still malicious.
- Evidence stores are local by default; exchange/observatory features are on
  the roadmap.

## Deployment model

trustcard is designed for **per-agent enforcement**: each agent (or framework)
runs its own proxy with its own manifest and pin store.

```text
Agent ←→ mcp-proxy (manifest + pin store) ←→ MCP server
```

Trust state is per-agent. Pin stores are not synchronized. For horizontal
scaling, run one proxy per agent instance.
