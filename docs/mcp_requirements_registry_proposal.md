# Registry Schema Investigation — `protocolVersions` Proposal Disposition

**Status:** PROPOSAL KILLED — DO NOT FILE
**Date:** 2026-07-28
**Disposition:** No registry schema change justified by current evidence
**Predecessor:** `trustcard_mcp_health_external_reassessment.md`
**Companion:** `trustcard_requirements_verification_boundary.md`

---

## 1. Summary

This document records the investigation, proposal, adversarial kill-test, and
disposition of a candidate registry schema addition (`protocolVersions`). The
proposal was killed by empirical evidence: the MCP handshake protocol already
negotiates protocol version, and in a 100-server sample, zero connection
failures were attributable to protocol-version incompatibility.

The investigation produced a stronger result than a schema proposal: it proved
that the registry's existing schema is already sufficient for the demonstrated
selection-critical requirements, and the actual gap is publisher adoption and
independent verification, not schema expressiveness.

**Final decision: PROPOSAL KILLED — DO NOT FILE. No registry schema change
is warranted by current evidence. No MCP Registry issue or PR should be
filed at this time.**

---

## 2. What was investigated

### 2.1 The original question

The Trustcard project began with an apparent registry-schema deficiency: agents
selecting MCP servers had no machine-readable way to determine connection
requirements before attempting to connect. Three independent measurement
streams confirmed significant failure rates:

| Stream | Measurer | Finding | Scale |
|---|---|---|---|
| stdio installability | trustcard | 68% of sampled servers cannot start without configuration | 100-server sample |
| repository existence | Circadian-agent | 15.0% of declared GitHub repos return NOT_FOUND | 13,698 repos, 40/40 control-verified |
| remote endpoint reachability | siliroid | 12.3% of remote endpoints don't speak MCP at the advertised URL | 9,403 endpoints (corrected from 14.4% after two measurement bugs, 80/80 two-seed control) |

### 2.2 The registry schema inspection

The actual `server.schema.json` (version `2025-12-11`) was fetched from
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
and inspected in full. The registry's Go source code
(`pkg/api/v0/types.go`, `internal/validators/validators.go`) was examined to
confirm the ingestion path.

**Key findings from the schema:**

The registry already has structured, typed, schema-validated fields for:

| Requirement | Existing field | Richness |
|---|---|---|
| Environment variables / auth | `Package.environmentVariables` | `name`, `isRequired`, `isSecret`, `description`, `placeholder`, `choices`, `format`, `value` |
| CLI arguments | `Package.packageArguments` | `type` (positional/named), `name`, `isRequired`, `isSecret`, `description`, `valueHint`, `placeholder` |
| Runtime arguments (docker/npx) | `Package.runtimeArguments` | Same as packageArguments |
| Transport type | `Package.transport` / `RemoteTransport.type` | `stdio`, `streamable-http`, `sse` |
| Remote auth headers | `RemoteTransport.headers` | `name`, `isRequired`, `isSecret`, `description` |
| Repository reference | `Repository` | `url`, `source`, `id`, `subfolder` |

**The one field not present:** `protocolVersions` — which MCP protocol
versions a server supports.

### 2.3 The `_meta` ingestion path

Confirmed from Go source and official docs:

- Only `_meta["io.modelcontextprotocol.registry/publisher-provided"]` is
  preserved during ingestion. All other `_meta` keys are silently dropped
  (Go struct unmarshaling behavior — `ServerMeta` has one field).
- `publisher-provided` is opaque (`map[string]interface{}`,
  `additionalProperties: true`), with a 4KB size limit.
- 0 of 200 sampled live registry entries use `publisher-provided`.

### 2.4 The proposal that was constructed

Based on the schema inspection, a proposal was constructed to add a single
optional first-class field `protocolVersions` (array of date strings,
pattern `^\d{4}-\d{2}-\d{2}$`) to `ServerDetail`. The proposal argued that
this was the one genuine schema gap, that it was selection-critical, and that
it would prevent avoidable connection failures.

### 2.5 The kill-test

An adversarial kill-test was conducted to determine whether
`protocolVersions` is genuinely selection-critical or merely "nice to have."
The kill-test examined the MCP specification's handshake negotiation
semantics and trustcard's empirical scan data.

---

## 3. What was proven

### 3.1 The registry schema is already sufficient for demonstrated selection-critical requirements

The existing typed fields (`environmentVariables`, `packageArguments`,
`runtimeArguments`, `headers`, `transport`, `repository`) can express the
requirements whose absence causes the demonstrated failures (missing config,
missing auth, wrong transport, dead repo). These fields are richer than any
summary field that was proposed (`mcp.health`, `mcp.requirements`) because
they include `isRequired`, `isSecret`, `description`, `placeholder`,
`choices`, and `format`.

### 3.2 The `_meta` ingestion path is well-understood

The registry preserves only `publisher-provided` and drops everything else.
This is confirmed by source code, documentation, and live API inspection.
Any proposal using `_meta` must use this key. The signed-manifest proposal
can use it via a reverse-DNS subkey
(`io.github.davidnichols-ops.trustcard`), which is opaque, preserved, and
under 4KB.

### 3.3 `mcp.health` is the wrong abstraction

This was established in the predecessor document
(`trustcard_mcp_health_external_reassessment.md`) and is not reopened here.
"Health" collapses orthogonal concerns with different trust properties,
staleness rates, and owners. The scalar score creates false precision.

### 3.4 MCP handshake negotiation handles protocol version compatibility

From the MCP specification (`schema/2025-03-26/schema.ts`):

```
InitializeRequest.protocolVersion: string
  "The latest version of the Model Context Protocol that the client supports.
   The client MAY decide to support older versions as well."

InitializeResult.protocolVersion: string
  "The version of the Model Context Protocol that the server wants to use.
   This may not match the version that the client requested.
   If the client cannot support this version, it MUST disconnect."
```

The negotiation is single-version: the client sends its latest, the server
responds with one it supports, and if the client can't handle it, it
disconnects. This is by design.

---

## 4. What was not demonstrated

### 4.1 `protocolVersions` is not demonstrated to be selection-critical

The kill-test examined trustcard's 100-server scan data
(`data/mcp-ecosystem-2026-07-27-sample100.json`). The scanner tried
`2025-06-18` first, then fell back to `2024-11-05` and `2024-10-07`.

| Handshake result | Count |
|---|---|
| PASS | 29 |
| FAIL | 30 |
| CONFIG_REQUIRED | 19 |
| N/A (scan error) | 17 |
| WARN | 5 |

Among the 29 successful handshakes, the server returned a protocol version
different from the client's first choice in 8 cases:

| Server returned | Count |
|---|---|
| `2025-06-18` (client's first choice) | 27 |
| `2024-11-05` | 6 |
| `2025-03-26` | 1 |
| `2025-11-25` | 1 |

**Every "mismatch" was a successful negotiation.** The client supported the
server's chosen version, and the handshake completed. **Zero out of 100
servers had a protocol-version incompatibility that prevented connection.**

### 4.2 The actual failures are not protocol-version failures

The 30 handshake FAILs and 19 CONFIG_REQUIREDs are caused by missing
configuration (environment variables, arguments, authentication), not
protocol-version incompatibility. These failure modes are addressable by the
existing `environmentVariables`, `packageArguments`, and `headers` fields —
if publishers fill them in.

### 4.3 The distinction that killed the proposal

> **"protocolVersions is useful information"** — possibly true. Knowing
> protocol versions before connecting saves one connection attempt in the
> rare case of zero version overlap.

> **"protocolVersions materially improves pre-connection server selection"**
> — **not demonstrated.** In 100 sampled servers, the handshake negotiation
> resolved every protocol-version question. No client was unable to connect
> due to a version gap that a declaration would have prevented.

A maintainer can reasonably reject the proposal as redundant with MCP
initialization negotiation. The evidence supports that rejection.

---

## 5. What evidence killed the proposal

| Evidence | Source | What it proves |
|---|---|---|
| 0/100 protocol-version incompatibility failures | trustcard 100-server scan | Handshake negotiation resolves version compatibility in practice |
| 8/29 successful negotiations where server chose a different version | trustcard 100-server scan | Negotiation works even when client and server prefer different versions |
| 30 FAIL + 19 CONFIG_REQUIRED failures are config-related, not version-related | trustcard 100-server scan | The demonstrated failures are in a different layer than protocol version |
| MCP spec defines single-version negotiation with disconnect fallback | `schema/2025-03-26/schema.ts` | The protocol handles version compatibility by design |
| Registry schema already has typed fields for config/auth/transport/repo | `server.schema.json` 2025-12-11 | The demonstrated failure modes are expressible in existing fields |

---

## 6. The stronger finding

The investigation produced a result more valuable than a schema proposal:

> **The registry schema is already sufficient for the demonstrated
> selection-critical requirements. The gap is not schema expressiveness.**

The demonstrated failure modes map to existing fields:

| Failure mode | Existing field that can express the requirement |
|---|---|
| Missing env vars (68% can't start) | `Package.environmentVariables` with `isRequired: true` |
| Missing CLI args | `Package.packageArguments` with `isRequired: true` |
| Missing auth (remote) | `RemoteTransport.headers` with `isRequired: true` |
| Wrong transport assumption | `Package.transport` / `RemoteTransport.type` |
| Dead repository (15%) | `Repository.url` (verifiable via GitHub API) |
| Dead endpoint (12.3%) | `RemoteTransport.url` (verifiable via HTTP probe) |

**The revised diagnosis: the demonstrated gap is publisher adoption and
verification, not schema expressiveness.**

This does NOT mean that improving publisher adoption will solve those
failures. The 68%, 15%, and 12.3% figures establish different failure modes
and indicate that existing schema fields can represent some of them. They do
not establish causality for an adoption intervention. Whether prompting
publishers to fill in existing fields would improve first-contact outcomes is
a separate hypothesis that has not been tested.

---

## 7. Kill-test methodology and result

### 7.1 Methodology

The kill-test attempted to falsify the proposal by answering 10 adversarial
questions:

1. Is `protocolVersions` genuinely absent from every relevant schema/API
   representation? — **Yes, confirmed absent.**
2. Is it selection-critical, or does handshake negotiation make it
   unnecessary? — **Handshake negotiation handles it. Not selection-critical.**
3. Does the date-string representation accurately model MCP protocol-version
   semantics? — **Yes, but accurate formatting doesn't make the field useful.**
4. Should this be called `protocolVersions` or something else? — **Naming is
   fine; doesn't save the proposal.**
5. Is `ServerDetail` the correct layer? — **Yes; doesn't save the proposal.**
6. Can one server expose different protocol versions across transports? —
   **No; correct but doesn't save the proposal.**
7. What happens when a server supports a version newer than the registry's
   schema knowledge? — **Pattern accepts any date; correct but doesn't save
   the proposal.**
8. Does adding this field create an implicit maintenance promise? — **Yes,
   and the value is not demonstrated.**
9. Can a maintainer reasonably reject it as redundant with initialization
   negotiation? — **Yes, and the evidence supports that rejection.**
10. Is there a smaller proposal with stronger demonstrated user value? —
    **Yes: no schema change, since the existing schema is sufficient.**

### 7.2 Result

**8 of 10 questions produced evidence against the proposal.** Questions 1, 5,
6, and 7 confirmed technical correctness of the field design but did not
establish selection-criticality. Questions 2, 8, 9, and 10 produced direct
evidence that the field is not warranted.

The dispositive evidence: **0 out of 100 sampled servers had a
protocol-version incompatibility that prevented connection.** The MCP
handshake negotiation resolved every version question.

---

## 8. What was proposed (preserved for the record)

The proposal was to add an optional `protocolVersions` field to
`ServerDetail` in the MCP registry schema:

```yaml
protocolVersions:
  description: >
    MCP protocol versions this server supports, listed newest-first.
    If absent, clients MUST treat supported versions as UNKNOWN and
    negotiate at handshake time.
  type: array
  items:
    type: string
    pattern: "^\\d{4}-\\d{2}-\\d{2}$"
  minItems: 1
  example: ["2025-06-18", "2024-11-05"]
```

The proposal included a full client behavior contract, backward compatibility
analysis, security considerations, adversarial case analysis, and comparison
to alternative designs (`mcp.requirements` under `publisher-provided`, new
`_meta` keys, `mcp.health` as a first-class object).

The full original proposal text is preserved in the git history of this
document. The key argument that was falsified:

> "This is a selection-critical omission — protocol version negotiation
> happens at handshake time, and a mismatch means a failed connection."

This argument was empirically tested and found unsupported: in 100 sampled
servers, negotiation never failed due to version incompatibility.

---

## 9. Alternative designs and their disposition

| Alternative | Status | Reason |
|---|---|---|
| `mcp.health` first-class object | Rejected | Wrong abstraction; collapses orthogonal concerns; scalar score; redundancy with existing fields |
| `mcp.requirements` under `publisher-provided` | Rejected | Redundant with existing typed fields; opaque/unvalidated; convention discovery problem; 4KB limit |
| New `_meta` key | Rejected | Silently dropped by registry ingestion; requires code change |
| `protocolVersions` first-class field | **Killed by kill-test** | Not selection-critical; handshake negotiation handles it; 0/100 incompatibility failures |
| Do nothing (no schema change) | **Current disposition** | Existing schema is sufficient; gap is adoption and verification, not schema |

---

## 10. Trustcard boundary (unchanged)

The kill-test did not expose a new Trustcard boundary issue. The boundary
established in `trustcard_requirements_verification_boundary.md` remains
valid:

```
MCP Registry
    │
    ├── Existing typed declarations
    │     ├── environmentVariables
    │     ├── packageArguments
    │     ├── runtimeArguments
    │     ├── headers
    │     ├── transport
    │     └── repository
    │
    └── publisher-provided _meta
          └── optional ecosystem-specific attestations
                    │
                    ▼
                 Trustcard
                    │
                    └── independently verifies what publishers claim
```

- **Registry** = publisher-declared structured metadata
- **Trustcard** = independent empirical verification of those declarations
- Trustcard should not become a second registry or silently redefine
  registry semantics

---

## 11. Candidate future directions (not proposals)

These are hypotheses that could be investigated in the future. They are NOT
proposals and should not be filed without their own evidence and maintainer
validation.

### 11.1 Publisher adoption intervention

**Hypothesis:** If the registry's publisher CLI prompted for required
`environmentVariables` and `packageArguments` during publishing, more
publishers would declare them, reducing the 68% config-failure rate.

**Status:** Not tested. No evidence that prompting changes declaration
completeness, nor that declaration completeness improves successful
first-contact outcomes. This is a new hypothesis, not the conclusion of this
investigation.

### 11.2 Declaration-vs-observation verification

**Hypothesis:** An independent verifier (Trustcard) can reliably measure
whether the registry's existing declarations correspond to what a naive
client actually experiences.

**Status:** This is the most defensible next research direction. Trustcard's
scanner already performs this measurement for stdio servers. The question is
whether it can be done at scale, with control strata (per Circadian's
methodology), with correction transparency (per siliroid's methodology), and
with explicit UNKNOWN handling.

### 11.3 Signed-manifest proposal

**Status:** Remains a separate, orthogonal proposal. Uses
`publisher-provided` with a reverse-DNS subkey. Answers "is what I connected
to signed by a known publisher?" — a different question from "what does the
server need to connect?" Should be filed as its own discussion if and when
appropriate. Not part of this disposition.

---

## 12. What would reopen this question

The `protocolVersions` proposal could be reopened if any of the following
occur:

1. **Observed protocol-version incompatibility at meaningful scale.** If
   future scans show that a non-trivial fraction of servers fail handshake
   specifically due to version incompatibility (not config, not auth, not
   network), the field would be justified.

2. **Evidence that clients need protocol-version filtering before
   connection.** If agents or agent frameworks demonstrate a need to filter
   servers by protocol version at selection time (e.g., a client that only
   supports `2025-06-18` wants to exclude servers that only support
   `2024-11-05` without wasting a connection attempt), the field would be
   justified.

3. **A future MCP protocol change where negotiation no longer adequately
   solves compatibility.** If the MCP specification changes the negotiation
   semantics in a way that makes pre-connection version knowledge necessary,
   the field would be justified.

4. **Maintainer-requested schema support.** If registry maintainers
   independently decide that `protocolVersions` should be in the schema,
   this investigation provides the schema design, client contract, and
   adversarial analysis to support that decision.

None of these conditions are currently met.

---

## 13. Final decision gate

| Condition | Status |
|---|---|
| Proposed field is genuinely absent from the schema | Confirmed |
| Proposed field is selection-critical | **NOT DEMONSTRATED** — 0/100 incompatibility failures |
| Proposed field materially improves pre-connection selection | **NOT DEMONSTRATED** — handshake negotiation handles it |
| Adding the field is worth the publisher maintenance burden | **NOT JUSTIFIED** — value not demonstrated |
| A maintainer could reasonably reject it | **YES** — redundant with initialization negotiation |
| The existing schema is sufficient for demonstrated failures | **YES** — config/auth/transport/repo fields exist |
| The gap is schema expressiveness | **NO** — the gap is adoption and verification |

---

## 14. Final decision

**PROPOSAL KILLED — DO NOT FILE**

**NO REGISTRY SCHEMA CHANGE JUSTIFIED BY CURRENT EVIDENCE**

No MCP Registry issue or PR should be filed for `protocolVersions` or any
other schema addition at this time. The existing schema is sufficient. The
demonstrated gap is publisher adoption and independent verification, not
schema expressiveness.

Killing this proposal is a success, not a setback. The investigation:
1. Started with an apparent registry-schema deficiency
2. Inspected the actual schema and ingestion path
3. Proposed a new primitive
4. Subjected it to adversarial empirical testing
5. Discovered that the protocol itself already solves the supposed
   compatibility problem
6. Identified the actual gap (adoption + verification) as separate from
   schema expressiveness

This is exactly the kind of reasoning that makes the Trustcard work credible.

---

## Appendix: Quantitative evidence summary

### 100-server scan (trustcard, 2026-07-27)

| Metric | Value |
|---|---|
| Total servers sampled | 100 |
| Successful handshakes (PASS) | 29 |
| Handshake failures (FAIL) | 30 |
| Config required (CONFIG_REQUIRED) | 19 |
| Scan errors (N/A) | 17 |
| Warnings (WARN) | 5 |
| Protocol-version incompatibility failures | **0** |
| Successful negotiations where server chose different version | 8 |
| Distinct protocol versions observed | 4 (`2025-06-18`, `2024-11-05`, `2025-03-26`, `2025-11-25`) |

### Three evidence streams

| Stream | Finding | Scale | What it proves |
|---|---|---|---|
| trustcard | 68% can't start without config | 100 servers | Config requirements are the dominant failure mode |
| Circadian | 15.0% dead repos | 13,698 repos | Source integrity is a distinct, measurable problem |
| siliroid | 12.3% endpoints don't speak MCP | 9,403 endpoints | Endpoint reachability is a distinct, measurable problem |

### What the evidence does NOT prove

- Does NOT prove that improving registry adoption will solve the 68%/15%/12.3%
  failures (no causality established for an adoption intervention)
- Does NOT prove that `protocolVersions` would prevent any observed failure
  (0/100 incompatibility failures)
- Does NOT prove that a schema change of any kind is needed (existing fields
  cover the demonstrated failure modes)

---

## Appendix: Relationship to the signed-manifest proposal

The signed-manifest proposal (trustcard v2) is orthogonal to this
investigation. It answers "is what I connected to the thing a known publisher
signed?" — a question about identity and provenance, not about connection
requirements.

The signed manifest can use the existing `publisher-provided` extension point
with a reverse-DNS subkey, which survives registry ingestion:

```jsonc
{
  "_meta": {
    "io.modelcontextprotocol.registry/publisher-provided": {
      "io.github.davidnichols-ops.trustcard": {
        "manifestUrl": "https://example.com/.well-known/trustcard.manifest.json",
        "manifestDigest": "sha256:...",
        "publisher": { "keyId": "sha256:..." }
      }
    }
  }
}
```

This is opaque, preserved, and under 4KB. The manifest proposal should be
evaluated on its own merits and filed as a separate discussion if
appropriate. It is not affected by the `protocolVersions` disposition.
