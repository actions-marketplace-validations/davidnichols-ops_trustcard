# Trustcard MCP Registry Research Conclusion

**Date:** 2026-07-28
**Status:** Internal research artifact — not for publication
**Purpose:** Preserve the complete reasoning chain from initial hypothesis to
final disposition, prevent reopening of rejected proposals, and document why
"no upstream change" was an evidence-based conclusion.

**Predecessor documents:**
- `trustcard_mcp_health_external_reassessment.md` — rejection of `mcp.health`
- `mcp_requirements_registry_proposal.md` — killed `protocolVersions` proposal
- `trustcard_requirements_verification_boundary.md` — registry/Trustcard boundary

---

## 1. Initial hypothesis

The Trustcard project began with an apparent registry-schema deficiency. Three
independent measurement streams showed significant failure rates when clients
attempted to use MCP servers as advertised:

| Stream | Measurer | Finding | Scale |
|---|---|---|---|
| stdio installability | trustcard | 68% of sampled servers cannot start without configuration | 100-server sample |
| repository existence | Circadian-agent | 15.0% of declared GitHub repos return NOT_FOUND | 13,698 repos, 40/40 control-verified |
| remote endpoint reachability | siliroid | 12.3% of remote endpoints don't speak MCP at the advertised URL | 9,403 endpoints (corrected from 14.4% after two measurement bugs, 80/80 two-seed control) |

The initial hypothesis was:

> MCP Registry lacks machine-readable selection metadata, therefore add
> `mcp.health` / `mcp.requirements` / `protocolVersions` to enable agents to
> make better pre-connection decisions.

This hypothesis was tested and rejected.

---

## 2. Registry schema investigation

### 2.1 Schema inspection

The actual `server.schema.json` (version `2025-12-11`) was fetched from
`https://static.modelcontextprotocol.io/schemas/2025-12-11/server.schema.json`
and inspected in full. The registry's Go source code
(`pkg/api/v0/types.go`, `internal/validators/validators.go`) was examined to
confirm the ingestion path.

### 2.2 Key finding: the schema already has structured fields

The registry already has typed, schema-validated fields for the demonstrated
selection-critical requirements:

| Requirement | Existing field | Richness |
|---|---|---|
| Environment variables / auth | `Package.environmentVariables` | `name`, `isRequired`, `isSecret`, `description`, `placeholder`, `choices`, `format`, `value` |
| CLI arguments | `Package.packageArguments` | `type` (positional/named), `name`, `isRequired`, `isSecret`, `description`, `valueHint`, `placeholder` |
| Runtime arguments (docker/npx) | `Package.runtimeArguments` | Same as packageArguments |
| Transport type | `Package.transport` / `RemoteTransport.type` | `stdio`, `streamable-http`, `sse` |
| Remote auth headers | `RemoteTransport.headers` | `name`, `isRequired`, `isSecret`, `description` |
| Repository reference | `Repository` | `url`, `source`, `id`, `subfolder` |

### 2.3 `_meta` ingestion path

Confirmed from Go source and official docs:

- Only `_meta["io.modelcontextprotocol.registry/publisher-provided"]` is
  preserved during ingestion. All other `_meta` keys are silently dropped
  (Go struct unmarshaling — `ServerMeta` has one field:
  `PublisherProvided map[string]interface{}`).
- `publisher-provided` is opaque (`additionalProperties: true`), with a 4KB
  size limit enforced by `validatePublisherExtensions()`.
- 0 of 200 sampled live registry entries use `publisher-provided`.
- The registry docs recommend reverse-DNS subkeys under `publisher-provided`
  (e.g., `io.github.some-org.metadata`).

### 2.4 Live registry API inspection

200 entries were sampled from `https://registry.modelcontextprotocol.io/v0/servers`:

- 17/50 had packages; 33/50 had remotes; 27/50 had repository metadata
- 1/50 had `environmentVariables` declared
- 0/50 had `packageArguments` declared
- 6/50 remote servers had `headers` declared
- 0/200 had `publisher-provided` metadata

The existing fields are sparsely adopted but structurally present and
schema-validated.

---

## 3. Proposed fields considered

Three fields/objects were proposed and investigated in sequence:

### 3.1 `mcp.health` (rejected — wrong abstraction)

A first-class object containing a scalar health score (0-100), sub-scores per
dimension, and verification metadata. Full analysis in
`trustcard_mcp_health_external_reassessment.md`.

**Rejected because:**
- "Health" collapses at least seven orthogonal observability layers
  (installability, handshake, endpoint reachability, repo existence,
  freshness, transport, protocol compatibility) into one object
- The scalar score creates false precision — hides which dimensions were
  measured, which failed, and which weren't measured at all
- Most proposed sub-fields already exist as typed schema fields
- Runtime observations (latency, failure rate) don't belong in static
  registry metadata

### 3.2 `mcp.requirements` (rejected — redundant)

A metadata object under `publisher-provided` containing `protocolVersions`,
`requiresAuth`, `requiresArgs`, and `transport`.

**Rejected because:**
- `requiresAuth` is redundant with `environmentVariables` (with
  `isRequired`/`isSecret`) and `headers` (with `isRequired`/`isSecret`)
- `requiresArgs` is redundant with `packageArguments` and `runtimeArguments`
- `transport` is already a first-class field
- `publisher-provided` is opaque — no schema validation, no type checking
- Clients would need out-of-band convention discovery
- 4KB size limit could be exceeded
- Namespacing ambiguity (whose namespace is `mcp`?)

### 3.3 `protocolVersions` (killed by empirical kill-test)

A first-class optional array field on `ServerDetail` containing MCP protocol
version strings (`^\d{4}-\d{2}-\d{2}$`).

**This was the one field not redundant with existing schema.** It was
subjected to an adversarial kill-test and killed. Details in §4 below.

---

## 4. Kill tests performed

### 4.1 `mcp.health` kill analysis

Not a formal kill-test but a structural rejection. The abstraction was wrong
before any empirical test was needed — it collapsed orthogonal concerns with
different trust properties, staleness rates, and owners.

### 4.2 `mcp.requirements` kill analysis

Structural rejection via schema inspection. The proposed fields were
redundant with existing typed fields that are richer and already
schema-validated.

### 4.3 `protocolVersions` kill-test

A formal 10-question adversarial kill-test was conducted. The dispositive
evidence came from the MCP specification and trustcard's empirical scan data.

#### MCP specification negotiation semantics

From `schema/2025-03-26/schema.ts`:

```
InitializeRequest.protocolVersion: string
  "The latest version of the Model Context Protocol that the client supports.
   The client MAY decide to support older versions as well."

InitializeResult.protocolVersion: string
  "The version of the Model Context Protocol that the server wants to use.
   This may not match the version that the client requested.
   If the client cannot support this version, it MUST disconnect."
```

The protocol negotiates version at handshake. The client sends its latest;
the server responds with one it supports; if the client can't handle it, it
disconnects. This is by design.

#### Empirical scan data

Trustcard's 100-server scan (`data/mcp-ecosystem-2026-07-27-sample100.json`)
tried `2025-06-18` first, then fell back to `2024-11-05` and `2024-10-07`:

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
server's chosen version, and the handshake completed.

**Zero out of 100 servers had a protocol-version incompatibility that
prevented connection.**

---

## 5. Evidence that rejected each field

### 5.1 `mcp.health` — structural evidence

| Evidence | What it proves |
|---|---|
| Seven orthogonal observability layers with different trust properties | "Health" is the wrong abstraction |
| Scalar score hides measurement coverage | False precision; gameable |
| Most sub-fields redundant with existing typed schema fields | Adding them creates summary/detail disagreement risk |
| Runtime observations are transient and environment-dependent | Don't belong in static registry metadata |

### 5.2 `mcp.requirements` — schema evidence

| Evidence | What it proves |
|---|---|
| `environmentVariables` with `isRequired`/`isSecret` already exists | `requiresAuth` is redundant |
| `packageArguments` with `isRequired` already exists | `requiresArgs` is redundant |
| `transport` is already first-class | `transport` is redundant |
| `publisher-provided` is opaque with 4KB limit | Unvalidated; size-constrained |
| Registry docs recommend reverse-DNS subkeys | Bare `mcp.requirements` is namespacing-ambiguous |

### 5.3 `protocolVersions` — empirical evidence

| Evidence | Source | What it proves |
|---|---|---|
| 0/100 protocol-version incompatibility failures | trustcard 100-server scan | Handshake negotiation resolves version compatibility in practice |
| 8/29 successful negotiations where server chose a different version | trustcard 100-server scan | Negotiation works even when client and server prefer different versions |
| 30 FAIL + 19 CONFIG_REQUIRED are config-related, not version-related | trustcard 100-server scan | The demonstrated failures are in a different layer |
| MCP spec defines single-version negotiation with disconnect fallback | `schema/2025-03-26/schema.ts` | The protocol handles version compatibility by design |
| Registry schema already has typed fields for config/auth/transport/repo | `server.schema.json` 2025-12-11 | The demonstrated failure modes are expressible in existing fields |

### 5.4 The core lesson

> **The absence of a registry field does not imply a registry schema
> deficiency. A missing field only justifies schema expansion when its
> presence enables materially better decisions than existing protocol
> mechanisms and metadata.**

`protocolVersions` is absent but not needed — the protocol's handshake
negotiation already solves the compatibility problem. Adding the field would
introduce publisher maintenance burden without demonstrated material
selection benefit.

---

## 6. Final architecture

```
                    MCP Registry
                         |
        -----------------------------------
        |                                 |
 Publisher declarations             Trustcard verification
        |                                 |
 environmentVariables               Does it actually need them?
 packageArguments                   Does it actually start?
 runtimeArguments                   Does auth behave as declared?
 headers                            Does endpoint speak MCP?
 transport                          Does source exist?
 repository
        |                                 |
        |                                 |
 _meta.publisher-provided           Evidence records
        |                            (Trustcard's own store,
        |                             not in the registry)
        |
 io.github.davidnichols-ops.trustcard
   (signed manifest URL + digest
    + publisher key ID)
```

### The two trust layers

**The registry answers:**
> "What does the publisher claim?"

**Trustcard answers:**
> "What happens when a naive client actually tries?"

These are different trust layers and should remain separate.

### Design principles

1. **The registry declares. Trustcard verifies. They do not merge.**
2. **The registry does not depend on Trustcard.** Existing fields are useful
   without any verifier.
3. **Trustcard does not write to the registry.** Evidence records live in
   Trustcard's store.
4. **Contradictions are published, not silently corrected.** If Trustcard
   observes a declaration/behavior mismatch, it publishes a `CONTRADICTED`
   evidence record. The registry entry is unchanged.
5. **The signed manifest is optional and orthogonal.** It uses
   `publisher-provided` with a reverse-DNS subkey. It answers "is what I
   connected to signed by a known publisher?" — a different question from
   "what does the server need to connect?"
6. **Trustcard's internal score is not standardized.** The 0-100 scorecard
   is CLI convenience, not a registry field, not a standard, not part of any
   upstream proposal.

---

## 7. Open research questions

### 7.1 The primary research question

> **Can an independent verifier reliably measure whether the registry's
> existing declarations correspond to what a naive client actually
> experiences?**

This is the most defensible Trustcard research direction. It:
- Aligns with the empirical work already done (100-server scan, three
  evidence streams)
- Does not require any registry schema change
- Does not require maintainer approval
- Has technical novelty (declaration-vs-observation gap measurement)
- Produces evidence that is useful to the ecosystem without becoming a
  second source of truth

### 7.2 Sub-questions

1. **Declaration completeness:** What fraction of registry entries declare
   their `environmentVariables`, `packageArguments`, and `headers`? (Initial
   sample: 1/50 for env vars, 0/50 for args, 6/50 for headers — very low.)

2. **Declaration accuracy:** When declarations are present, do they match
   runtime behavior? (Does a declared `isRequired: true` env var actually
   prevent startup when absent?)

3. **Declaration coverage:** What fraction of the 68% config-failure rate is
   attributable to missing declarations vs. incorrect declarations vs.
   undeclarable requirements?

4. **Verification reproducibility:** Can a second verifier using different
   tooling reproduce Trustcard's observations? (The siliroid correction
   demonstrated that single-instrument blind spots are real.)

5. **Scale:** Can the verification methodology scale from 100 servers to the
   full registry (~13,000+ entries) without losing control strata or
   correction transparency?

### 7.3 Questions that are NOT open

- ~~Should the registry add `protocolVersions`?~~ — No. Killed by kill-test.
- ~~Should the registry add `mcp.health`?~~ — No. Wrong abstraction.
- ~~Should the registry add `mcp.requirements`?~~ — No. Redundant.
- ~~Should we file a registry issue or PR?~~ — No. Not warranted by evidence.
- ~~Should we propose a publisher-CLI prompting intervention?~~ — Not yet.
  No evidence that prompting changes declaration completeness or that
  declaration completeness improves first-contact outcomes. This is a new
  hypothesis requiring its own evidence.

### 7.4 What would reopen the `protocolVersions` question

1. Observed protocol-version incompatibility at meaningful scale
2. Evidence that clients need protocol-version filtering before connection
3. A future MCP protocol change where negotiation no longer adequately
   solves compatibility
4. Maintainer-requested schema support

None of these conditions are currently met.

---

## 8. Why "no upstream change" is an evidence-based conclusion

A weaker project would have forced a contribution because "we need a PR."
This investigation did the opposite:

1. Found a perceived schema gap
2. Inspected the actual schema and ingestion pipeline
3. Proposed a minimal addition
4. Designed a kill test
5. Collected evidence
6. Rejected its own proposal

The likely maintainer reaction to a `protocolVersions` issue would have been:

> "MCP already negotiates this. Why are we making publishers maintain
> duplicated information?"

The kill-test arrived at that answer before spending maintainer time.

**Killing the proposal is a success, not a setback.** The investigation
produced a stronger result than a schema proposal: it proved that the
registry's existing schema is sufficient, and the actual gap is publisher
adoption and independent verification — problems that live outside the
registry schema.

---

## 9. Artifact index

| Document | Status | Purpose |
|---|---|---|
| `trustcard_mcp_health_external_reassessment.md` | Complete | Rejection of `mcp.health` — wrong abstraction |
| `mcp_requirements_registry_proposal.md` | Killed | `protocolVersions` proposal disposition — killed by kill-test |
| `trustcard_requirements_verification_boundary.md` | Active | Registry/Trustcard boundary — registry declares, Trustcard verifies |
| `trustcard_mcp_registry_research_conclusion.md` | This document | Complete reasoning chain and open research questions |
| `PHASE-1-FINDINGS.md` | Historical | Initial ecosystem scan findings |
| `PHASE-2-FINDINGS.md` | Historical | Extended scan with control strata |
| `PHASE-2.5-EVIDENCE-DESIGN.md` | Active | Evidence record design (atomic, content-addressed, protocol-neutral) |
| `PROPOSAL.md` | Superseded | Original trustcard v2 signed-manifest proposal |
| `REGISTRY-INTEGRATION.md` | Superseded | Original registry integration plan (used wrong `_meta` key) |

---

## 10. Final disposition

**No MCP Registry issue or PR should be filed.**

**No registry schema change is warranted by current evidence.**

**The next phase is Trustcard validation research: measuring whether the
registry's existing declarations correspond to what a naive client actually
experiences.**

This is where the technical novelty lives. It does not require upstream
advocacy. It requires empirical probing, provenance, evidence boundaries, and
reproducibility — exactly the work Trustcard has already begun.
