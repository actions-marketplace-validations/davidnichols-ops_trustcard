# Trustcard threat model

What trustcard does and does not defend against, stated plainly. Every control
maps to the code that implements it.

## Actors

- **Publisher** — the entity that authors and signs a server's manifest. Holds
  an Ed25519 keypair.
- **Server operator** — runs the MCP server process. May be the publisher, or
  may be running compromised/malicious code.
- **Registry** — distributes `server.json` and manifests. A distribution
  point, *not* a trust root.
- **Client** — an agent (or its framework) that connects, enumerates, and
  calls tools. This is what trustcard protects.
- **Attacker** — may control a malicious server, compromise a legitimate
  server at runtime, or attempt supply-chain substitution.

## Trust roots (and why)

1. **The client's pin store** (`~/.config/trustcard/pins.json`). TOFU: the
   first observation is pinned; all later observations must match or produce
   an auditable diff. This is the client's ground truth. *Rationale:* in a
   decentralized ecosystem with no universal CA, continuity ("same as last
   time") is the strongest default available.
2. **Publisher Ed25519 keys**, themselves TOFU-pinned in the pin store.
   *Rationale:* signatures prove the holder of the key signed these exact tool
   definitions; key pinning proves it's the same key as before.

The registry, the network, and the npm artifact are **not** trust roots — they
are transport. npm's `dist.integrity` is surfaced as *package* identity (it
pins the tarball bytes) but does not vouch for runtime behavior.

## Attack scenarios → controls

| # | Attack | Control | Residual risk |
|---|---|---|---|
| 1 | **Tool poisoning**: schema unchanged, description rewritten to instruct the model to exfiltrate | `ANNOTATION_DOWNGRADE` diff class (material description rewrite with identical schema) → MISMATCH, no auto-repin | A *subtle* one-word malicious edit below the Jaccard threshold. Mitigation: receipts + human review of any description diff. |
| 2 | **TOCTOU**: server mutates tools between discovery and call | handshake binding (§7.1), `list_changed` → immediate re-diff, guard per-call re-assertion | A server that neither binds nor notifies, mutating in the gap. Bounded by strict arg validation + receipts. Only fully closed for cooperating servers. |
| 3 | **Breaking change**: required param added, enum shrunk, tool removed | `BREAKING` diff class → MISMATCH → REVOKED; cached plans fail safe | None for detection. The client must re-plan; that's the correct outcome. |
| 4 | **Permission escalation**: `readOnlyHint`→`destructiveHint`, `openWorldHint` flip | `PERMISSION_CHANGE` diff class → incompatible, not auto-repinned | Server lies in annotations (says read-only, is destructive). Annotations are hints; guard denies destructive *declared* tools, can't detect a *lying* server. Defense-in-depth: least-privilege env, human approval for side-effecting calls. |
| 5 | **Compromised server** serving different tools than the publisher signed | signed manifest + `bindingConsistency` (declared ↔ observed digest match) | Publisher signed a malicious toolset (see #7). |
| 6 | **Registry/MITM substitution** of the manifest | `manifestDigest` + publisher signature + key pinning | First-use (TOFU) substitution of the publisher key itself. Break-glass: out-of-band key confirmation for high-value servers. |
| 7 | **Malicious publisher** signing a malicious toolset | out of scope for cryptography — this is what the *scanner* and social accountability are for | Full. trustcard proves "these are the tools the publisher signed," not "the publisher is honest." |
| 8 | **Publisher key compromise** | key pinning detects a *different* key; rotation is break-glass (old key signs new) + manual re-approval | If the old key is silently compromised before rotation, an attacker can sign. Out of scope; standard key-hygiene problem. |
| 9 | **Replay** of an old (good) manifest | `issuedAt`/`expiresAt`, plus digest must match the *live* observation | An old-but-still-valid manifest is by design still acceptable if tools haven't changed. |
| 10 | **Shadowing**: two servers registering same-named tools | serverDigest binds serverInfo; per-server pins keep namespaces separate | An agent merging tools across servers without namespacing. Client-side concern. |
| 11 | **Corrupt pin file** | detected, flagged (`corrupt`), and *nothing is trusted* (fail closed) | Availability: user must re-pin. Correct trade-off. |

## v2 attack scenarios → controls

v2 adds descriptors, a two-gate invocation policy, signed+chained receipts, and
key rotation/revocation. Each new mechanism introduces its own attack surface;
these are the classes the adversarial suite (`test/adversarial.test.js`,
`test/audit-probes.test.js`) executes.

| # | Attack | Control | Residual risk |
|---|---|---|---|
| 12 | **Forged descriptor** (attacker signs a descriptor with a different key, or strips the signature) | `verifyDescriptor` requires a valid publisher signature over the exact descriptor payload; a descriptor with no signature or a wrong-key signature never reaches the trusted state | None for detection — a descriptor is *only* trusted when its publisher signature verifies. |
| 13 | **Descriptor mutation after approval** (agent or process edits the approved descriptor in memory) | capabilityDigest is recomputed at Gate 2 for every call; any field change alters the digest → MISMATCH | None for the digest itself. A caller holding the *old* digest bytes can't forge a new descriptor that hashes to them (SHA-256 preimage). |
| 14 | **Argument injection** at Gate 2 (path traversal `../../etc/passwd`, schema-valid-but-hostile values) | `InvocationPolicy` re-validates arguments against the *approved* descriptor's schema and an optional per-tool arg policy, independent of Gate 1's "is this the right tool" check | The schema itself is the boundary: a hostile value that *is* schema-valid and not caught by arg policy passes. Annotations/schema are the contract; a too-loose schema is a contract author problem, not a trustcard gap. |
| 15 | **Cross-agent authorization bleed** (agent A's approval reused by agent B) | Gate 2 decisions are scoped to (agentId, capabilityDigest); a decision recorded for one agentId is not honored for another | A caller that can *read* another agent's decision record and present the same agentId. Scope keys are the boundary; an agent that can impersonate another's id is outside the model (that's an agent-runtime isolation problem). |
| 16 | **Receipt chain forgery**: tamper with a receipt *body* but keep the chain fields | **Fixed this audit.** `verifyReceiptChain` now *recomputes* `receiptDigest` from each payload and requires it to equal the embedded value (previously it trusted the embedded digest — a tampered body passed). Pinned by a regression test. | A relying party that signs a false receipt from the start (see §12.1 — receipts prove a *decision was recorded*, not that a call executed). |
| 17 | **Rotation replay** (re-present an old rotation cert indefinitely) | rotation certs carry `expiresAt`; `verifyRotationCertificate` rejects a lapsed cert so a stolen old key can't keep authorizing rotations forever | A rotation cert issued with no `expiresAt` (or a far-future one) is valid until then by design. Publishers SHOULD set a short window. **Revocation deliberately has no expiry** — a revocation must never lapse. |
| 18 | **Revocation expiry attack** (wait for a revocation to "expire," then reuse the key) | Closed by design: `verifyRevocationCertificate` performs **no** expiry check. A revocation is permanent the moment it verifies. | None — this asymmetry (rotation expires, revocation doesn't) is the control. |
| 19 | **TOCTOU between descriptor fetch and invocation** | Gate 1 binds the descriptor at session scope; Gate 2 re-asserts the same capabilityDigest at call time; a mutation between gates changes the digest → Gate 2 denies | Same residual as #2 — a server that neither binds nor notifies, mutating in the gap between Gate 2 and the actual transport send. Bounded by receipts. |

## v2.3 attack scenarios → controls

v2.3 adds per-agent OAuth 2.1 auth scope enforcement at the proxy layer. The
proxy validates the caller's bearer token against per-tool `requiredScopes`
before forwarding the call to the server, then strips auth metadata so the
server never sees the raw token.

| # | Attack | Control | Residual risk |
|---|---|---|---|
| 20 | **Unauthorized tool access** (agent calls a tool outside its scope) | `checkCall` validates `authToken.scopes` against `requiredScopes` per tool. Insufficient scopes → call blocked. Wildcard `*` and `prefix:*` supported. | A token with overly broad scopes (e.g. `*`) passes every check. Scope design is the operator's responsibility, not trustcard's. |
| 21 | **Token replay across agents** (agent A's token stolen and reused by agent B) | Token carries `subject` claim; proxy binds the token to the calling agent. `stripAuth` removes the token before forwarding so the server can't leak it. | A stolen token presented from the same subject with the same scopes is indistinguishable from the legitimate caller. This is a token-custody problem, not a trustcard gap. Mitigation: short token TTL, IdP-side revocation. |
| 22 | **Forged dev-mode token** (attacker fabricates a HMAC-SHA256 token) | `DevIssuer.verify` checks the HMAC against the shared secret. Wrong secret → invalid token → call blocked. | The shared secret is the trust root for dev-mode. If the secret leaks, all dev-mode tokens are forgeable. Mitigation: rotate the secret, use a real IdP for production. |
| 23 | **IdP introspection bypass** (attacker tricks the proxy into skipping introspection) | `TokenValidator` tries dev-issuer first (fast path), falls back to IdP introspection. If introspection returns `active:false` or the token is unknown to both, the call is blocked. | If the IdP itself is compromised, it can return `active:true` for a forged token. This is an IdP-trust problem. Mitigation: use a reputable IdP, pin the introspection endpoint TLS cert. |
| 24 | **Auth metadata leakage** (token exposed to the server via `_meta`) | `stripAuth` removes `_meta.auth` from the request before forwarding. The server receives the call as if no auth was present. | If the server requires the token for its own authorization (e.g. GitHub API calls), the operator must configure server-side auth separately. trustcard's job is to enforce *proxy-level* scope, not to manage server-side credentials. |
| 25 | **Scope confusion** (agent presents a scope that looks like a prefix but isn't) | `scopeSatisfies` uses exact string matching for non-wildcard scopes. `files:write` does NOT satisfy `files:w`. Only `*` and `prefix:*` (trailing colon-star) are wildcards. | None — the matching is deterministic and tested. Operator confusion from poorly named scopes is a policy-design problem. |

## Trust boundary

```
  UNTRUSTED                          TRUSTED-BUT-VERIFIED
  ─────────                          ────────────────────

  Agent ──[bearer token]──► trustcard proxy ──[stripped request]──► MCP server
                              │                      │
                         Gate 2: scope          Gate 1: identity
                         (per-invocation)       (per-session + per-list)
```

**The trust boundary begins at the agent's token and ends at the server's tool
execution.** trustcard sits between them.

- **Before the proxy (untrusted):** the agent, its token, and the request
  metadata. The token is validated but never trusted to be truthful about
  anything beyond what its signature/introspection proves.
- **Inside the proxy (the boundary):** Gate 2 (scope enforcement) and Gate 1
  (identity continuity) run here. This is where the decision to allow or deny
  is made.
- **After the proxy (trusted-but-verified):** the server and its tools. The
  server is trusted to execute the tool but verified to not have changed its
  toolset since the last pin. Auth metadata is stripped before this point.

**What crosses the boundary:**
- Inbound: the agent's request + bearer token (validated, then stripped)
- Outbound: the server's response + receipts (signed, chained, auditable)

**What does NOT cross the boundary:**
- The raw bearer token (stripped by `stripAuth` before forwarding)
- The proxy's internal state (pin store, decision cache, receipt chain)
- The operator's signing keys (never leave the proxy process)

## Explicit non-goals

- **Runtime behavior of a tool.** trustcard pins the *contract* (definition),
  not what the code does when called. A signed read-only tool can still behave
  badly; that's a sandboxing/least-privilege problem, not an identity problem.
- **Publisher honesty.** Signatures establish provenance, not intent.
- **A universal PKI.** TOFU + break-glass rotation is a deliberate choice for
  a young, decentralized ecosystem. If the MCP registry later operates a key
  directory, publisher keys can be anchored there without changing the format.

## The one-sentence version

trustcard guarantees that **the tool an agent calls is bit-for-bit the tool a
known publisher signed and the client pinned, and that the agent is authorized
to call it** — or it stops the call and says exactly what changed or what scope
was missing. It does not guarantee the tool is *good*.
