# Phase 2.5 — Evidence Model Design Review

**Date:** 2026-07-27
**Status:** Design review — not implementation. This document defines the atomic primitive of Trustcard: the evidence record.
**Predecessor:** `docs/PHASE-2-ARCHITECTURE.md` (architecture proposal, accepted)
**Successor:** Phase 3 implementation (only after this design is reviewed and approved)

---

## 0. Purpose

The Phase 2 architecture established that **evidence is the primary artifact**, not scores. This document defines what an evidence record IS — its schema, identity model, lifecycle, taxonomy, storage, and relationship to existing Trustcard components.

`lib/evidence.js` will be the foundational protocol design decision. Getting it wrong means every downstream consumer (trust reasoning, agent queries, research analysis, enforcement) inherits the error. Getting it right means the system can evolve for years without breaking the evidence format.

The central question every evidence record must answer:

> **What was observed, about what entity, by what method, at what time, with what confidence, and how can another party independently verify it?**

---

## 1. Evidence Record Specification

### 1.1 Design constraints

1. **Zero dependencies** — consistent with Trustcard's philosophy. Pure Node.js stdlib.
2. **Content-addressed** — reuse existing JCS (`canon.js`) + SHA-256 (`hash.js`) infrastructure. Every record has a digest that is recomputable from its content.
3. **Protocol-neutral** — the record format must not encode MCP-specific assumptions. MCP is the first protocol; the format must survive adding REST, gRPC, or agent-to-agent.
4. **Immutable** — records are never modified after creation. Corrections are new records that supersede, not in-place edits.
5. **Reproducible** — every record carries enough information for a third party to independently reproduce the observation.
6. **Compact** — records are the atomic unit of storage. Millions will exist. No redundant fields, no nested objects where a flat field suffices.
7. **Forward-compatible** — unknown fields are preserved, not dropped. Schema versioning is explicit.

### 1.2 The evidence record schema

```json
{
  "$schema": "trustcard.dev/evidence@1",
  "id": "ev_sha256:ABC123...",
  "timestamp": "2026-07-27T14:32:00.123Z",
  "observer": {
    "agent": "trustcard",
    "version": "3.0.0",
    "method": "github-repo-verify",
    "probeVersion": "1.0.0"
  },
  "subject": {
    "kind": "capability-provider",
    "identifiers": {
      "registryName": "io.github.frumu-ai/tandem",
      "repoUrl": "https://github.com/frumu-ai/tandem",
      "version": "0.3.2"
    }
  },
  "claim": {
    "predicate": "repository-resolves",
    "value": true,
    "layer": 1,
    "confidence": 1.0,
    "payload": {
      "httpStatus": 200,
      "repoId": 12345678,
      "stars": 114,
      "language": "Rust",
      "pushedAt": "2026-07-20T..."
    }
  },
  "reproducibility": {
    "command": "curl -s -H 'Accept: application/vnd.github+json' https://api.github.com/repos/frumu-ai/tandem",
    "credentials": "github-token",
    "environment": "macos-arm64-local"
  },
  "related": [],
  "supersedes": null,
  "digest": "sha256:DEF456..."
}
```

### 1.3 Field specification

| Field | Type | Required | Purpose |
|---|---|---|---|
| `$schema` | string | yes | Schema version. Always `"trustcard.dev/evidence@1"`. |
| `id` | string | yes | Content-addressed ID: `"ev_" + digest`. Immutable. Recomputable. |
| `timestamp` | string (ISO 8601 UTC) | yes | When the observation was made. Millisecond precision. |
| `observer.agent` | string | yes | What made the observation (e.g. `"trustcard"`, `"manual"`, `"external-researcher"`). |
| `observer.version` | string | yes | Version of the observing software. |
| `observer.method` | string | yes | Specific observation method (e.g. `"github-repo-verify"`, `"mcp-handshake"`, `"npm-registry-lookup"`). This is the probe name. |
| `observer.probeVersion` | string | no | Version of the specific probe (if different from agent version). |
| `subject.kind` | string | yes | What the observation is about. See §2 for valid values. |
| `subject.identifiers` | object | yes | The identity constellation snapshot at observation time. Key-value pairs of identifier type → value. |
| `claim.predicate` | string | yes | What is being asserted. Controlled vocabulary. See §4. |
| `claim.value` | any | yes | The observed value. Type depends on predicate. |
| `claim.layer` | integer (0-4) | yes | Evidence layer. See §4. |
| `claim.confidence` | float (0.0-1.0) | yes | How reliable the observation method is for this predicate. NOT a trust score. See §1.5. |
| `claim.payload` | object | no | Raw observation data (method-specific). This is the evidence backing the claim. |
| `reproducibility.command` | string | no | How to reproduce this observation. Shell command or API call. |
| `reproducibility.credentials` | string | no | What credentials were used (named, never values). E.g. `"github-token"`, `"none"`. |
| `reproducibility.environment` | string | no | Where it ran. E.g. `"macos-arm64-local"`, `"linux-x64-ci"`. |
| `related` | array of strings | no | IDs of related evidence records. For linking observations about the same subject or supporting evidence. |
| `supersedes` | string \| null | no | ID of a prior evidence record that this one corrects or replaces. See §3. |
| `digest` | string | yes | Content address: `sha256:<base64url>` of JCS-canonicalized record with `digest` and `id` fields removed. Reuses existing `hash.js` infrastructure. |

### 1.4 Digest computation

The digest is computed exactly as existing Trustcard digests:

```
digest = sha256_base64url(JCS(canonicalPayload))
```

Where `canonicalPayload` is the record with `digest` and `id` fields removed, canonicalized via RFC 8785 (JCS) using the existing `canon.js`.

The `id` field is `"ev_" + digest` — a namespaced content address that distinguishes evidence IDs from other Trustcard digests (manifests, descriptors, receipts).

**Why `ev_` prefix?** The existing system uses `sha256:` prefixes for digests. Evidence IDs need to be distinguishable from manifest digests, descriptor digests, and receipt digests in cross-references. The `ev_` prefix makes an evidence ID unambiguous in any context.

### 1.5 Confidence semantics

Confidence is **per-observation**, not per-subject. It answers: "How reliable is this observation method for this predicate?"

| Method | Predicate | Confidence | Rationale |
|---|---|---|---|
| GitHub API 200 | `repository-resolves` | 1.0 | Authoritative source |
| GitHub API 404 | `repository-not-found` | 0.95 | Could be temporary outage, but we got a definitive response |
| GitHub API 403 | `repository-resolves` | 0.0 | Rate limited — no observation was made |
| npm registry 200 | `package-resolves` | 1.0 | Authoritative source |
| MCP handshake success | `handshake-succeeds` | 0.95 | Could be transient, but we got a successful handshake |
| MCP handshake failure | `handshake-fails` | 0.80 | Could be network/config issue, not server fault |
| Danger detector (3-engine, high) | `destructive-capability-detected` | 0.85 | Heuristic, but triply-confirmed |
| Danger detector (single engine) | `destructive-capability-detected` | 0.60 | Heuristic, single signal |
| Dependency analysis | `dependency-observed` | 0.90 | package.json is authoritative |
| Manual observation | any | 0.50-1.0 | Set by the human observer |

**Confidence is NOT a trust score.** A high-confidence observation that a repo is dead is not a trust judgment — it's a reliable fact. The trust decision is a consumption-layer function that reads multiple evidence records.

**Confidence 0.0** means "no observation was made" — the method attempted but failed to produce a result. This is distinct from a low-confidence observation (which DID produce a result, just with uncertain reliability).

### 1.6 What is NOT in the evidence record

Deliberately excluded:

- **No score.** Scores are derived by consumers, not stored in evidence.
- **No trust state.** Trust is a consumption-layer decision, not an observation.
- **No recommendation.** The system is neutral.
- **No agent identity (beyond observer).** Who consumed the evidence is not part of the evidence.
- **No expiry.** Observations are facts that were true at a timestamp. They don't expire. (The subject's state may change, but the observation remains valid as a historical fact.)
- **No encryption.** Evidence is public. If sensitive data is in the payload, it should be redacted before recording.

### 1.7 Relationship to existing Trustcard data structures

| Existing structure | Relationship to evidence |
|---|---|
| Signed manifest (`provenance.js`) | A manifest is a publisher-signed claim about a server's toolset. It can be referenced by an evidence record as supporting data, but it is not itself an evidence record (it's a publisher attestation, not an observation). |
| Enforcement manifest (`manifest.js`) | Consumption-layer artifact. Not evidence. Derived from observations + danger analysis. |
| Observation (`observe.js`) | An observation IS evidence (or rather, produces evidence). The current `observeServer()` output maps to multiple evidence records (one per claim: handshake-succeeds, tools-exposed, etc.). |
| Receipt (`receipts.js`) | A receipt is evidence of a specific invocation. It's a specialized evidence record with its own schema (`trustcard.dev/receipt@1`). Evidence records generalize this pattern. |
| Pin (`pin.js`) | A pin is a consumption-layer decision (TOFU). Not evidence. But the observation that led to the pin IS evidence. |
| Trust state (`trust.js`) | Consumption-layer state machine. Not evidence. Reads evidence to make transitions. |
| Fingerprint (`fingerprint.js`) | A fingerprint is a composite view (package identity + observation + provenance + pin). Each component can produce evidence records. The fingerprint itself is a derived view. |
| Danger analysis (`danger-detector.js`) | Produces evidence: `destructive-capability-detected`, `injection-marker-detected`, etc. |

---

## 2. Identity Constellation Specification

### 2.1 The problem

No single identifier is stable across all changes a capability can undergo:

| Identifier | Can change? | How? |
|---|---|---|
| Registry name | Yes | Registry reorganization, namespace transfer |
| Repository URL | Yes | Repo rename, ownership transfer |
| Package name | Yes | Package rename, ownership transfer |
| Package version | Yes | Every release (by design) |
| Publisher key | Yes | Key rotation |
| Interface digest | Yes | Contract evolution (by design) |
| Implementation digest | Yes | Every build (by design) |
| Endpoint URL | Yes | Server migration |

A single identifier cannot serve as the stable referent. The identity is the **set of identifiers that have been observed to refer to the same thing**.

### 2.2 Subject kinds

The `subject.kind` field classifies what the observation is about:

| Kind | Description | Example identifiers |
|---|---|---|
| `capability-provider` | An MCP server, REST API, gRPC service, or other capability surface | registryName, repoUrl, packageName, version, endpointUrl, serverDigest |
| `capability` | A single tool/function within a provider | interfaceDigest, name, namespace, providerSubject |
| `repository` | A source code repository | repoUrl, repoId, ownerLogin |
| `package` | A distributable package (npm, PyPI, etc.) | packageName, registry, version, integrity |
| `publisher` | An entity that publishes capabilities or packages | keyId, publicKey, ownerLogin, publisherName |
| `endpoint` | A network endpoint | url, transport, protocol |

### 2.3 Identifier strength classification

| Identifier | Strength | Rationale |
|---|---|---|
| `keyId` (SHA-256 of publisher public key) | **Cryptographic** | Cannot be forged without the private key. Survives rename/transfer. |
| `interfaceDigest` (SHA-256 of semantic projection) | **Cryptographic** | Content-addressed. Byte-exact. Survives endpoint migration. |
| `serverDigest` (SHA-256 of server + protocol + toolset) | **Cryptographic** | Content-addressed. But changes on every toolset change. |
| `descriptorDigest` (SHA-256 of full descriptor) | **Cryptographic** | Content-addressed. Includes implementation + provenance. |
| `npm integrity` (SHA-512 of tarball) | **Cryptographic** | Content-addressed. Proves the tarball, not the running process. |
| `repoId` (GitHub numeric ID) | **Strong** | Immutable even through rename. But platform-specific. |
| `ownerId` (GitHub numeric ID) | **Strong** | Immutable even through username change. |
| `packageName` + `version` | **Medium** | Can change ownership. Version is precise but ephemeral. |
| `registryName` | **Medium** | Human-readable. Can change via registry reorganization. |
| `repoUrl` | **Weak** | Breaks on rename. But human-verifiable. |
| `endpointUrl` | **Weak** | Can migrate. Can be load-balanced. |
| `packageName` (without version) | **Weak** | Can change ownership. |
| `ownerLogin` (GitHub username) | **Weak** | Can change. |

### 2.4 Identity continuity

The system does NOT assign a synthetic UUID to subjects. Instead, identity continuity is maintained through the **constellation graph**:

1. **First observation:** A subject is identified by whatever identifiers the probe finds. The evidence record stores all of them in `subject.identifiers`.

2. **Subsequent observations:** New evidence records for the same subject include whatever identifiers the probe finds. The evidence store matches subjects by any shared identifier.

3. **Identifier change:** When an identifier changes (e.g., repo rename), a new evidence record with predicate `identifier-changed` links the old and new values. The subject persists.

4. **Identifier conflict:** If two subjects are found to share an identifier that was not previously shared (e.g., a package transfers ownership), the system records both observations. The conflict is visible, not hidden.

5. **Identity merge:** If the system discovers that two subjects are actually the same (e.g., same repoId, different repoUrl), an `identifier-observed` record on one subject that includes an identifier from the other establishes the link.

**Why no synthetic UUID?** A UUID is a hidden mapping. It can be wrong (two subjects get the same UUID) and the error is invisible. The constellation is transparent — anyone can audit which identifiers linked two subjects and when.

### 2.5 Subject matching algorithm

When a new evidence record arrives, the evidence store matches it to existing subjects:

```
1. For each identifier in the new record's subject.identifiers:
   a. Find existing evidence records with the same identifier value.
   b. If found, the new record is about the same subject.

2. If no match is found:
   a. The record establishes a new subject.
   b. The identifiers in the record become the initial constellation.

3. If matches are found for SOME but not ALL identifiers:
   a. The new record is linked to the matched subject.
   b. The unmatched identifiers are added to the constellation.
   c. If the unmatched identifiers match a DIFFERENT subject, this is a potential identity merge — record it but don't auto-merge.
```

**Strong identifiers take precedence.** If `keyId` matches but `repoUrl` doesn't, the subject is the same (key rotation or repo rename). If `repoUrl` matches but `keyId` doesn't, this is suspicious (potential key compromise) — record both, flag the conflict.

---

## 3. Evidence Lifecycle

### 3.1 Immutability

Evidence records are **immutable forever**. Once written, a record is never modified. This is enforced by:

1. **Content addressing:** The `id` is derived from the content. Any modification changes the `id`, breaking all references.
2. **Append-only storage:** The store only appends, never updates. See §5.
3. **No update API:** The evidence store API has `append()` and `query()` but no `update()` or `delete()`.

### 3.2 Conflicting observations

Conflicts are **preserved, not resolved**. If two observations disagree:

```
Record A (2026-07-27T14:32Z): repository-resolves = true
Record B (2026-07-27T15:00Z): repository-not-found = true
```

Both records exist in the store. The conflict is visible to any consumer. The system does NOT:
- Delete the older record
- Update the older record
- Pick a "winner"
- Merge them into a single record

The consumer sees both and can reason about why they differ (temporary outage? repo deleted between observations? API error?).

### 3.3 Corrections — the `supersedes` field

If an observation is later proven wrong (e.g., the probe had a bug that produced false results), a new evidence record is created with `supersedes` pointing to the incorrect record:

```json
{
  "id": "ev_sha256:NEW789...",
  "supersedes": "ev_sha256:OLD456...",
  "claim": {
    "predicate": "repository-resolves",
    "value": false,
    "confidence": 1.0,
    "payload": { "correctionReason": "probe bug #123 — false positive due to redirect handling" }
  }
}
```

The old record is NOT deleted. Both exist. The `supersedes` link tells consumers: "this record corrects that one." Consumers can choose to follow supersession chains or not.

**Why not delete?** The old record may have been used to make decisions. Those decisions have a provenance that references the old record's ID. Deleting it would break that provenance. The history of what was observed and when it was corrected IS the data.

### 3.4 Absence of evidence

Absence of evidence is represented by a record with `confidence: 0.0` and `claim.value: null`:

```json
{
  "claim": {
    "predicate": "handshake-succeeds",
    "value": null,
    "confidence": 0.0,
    "payload": { "error": "connection timeout after 30s" }
  }
}
```

This is distinct from:
- `claim.value: false` — the observation was made and the answer is "no"
- No record at all — no observation was attempted

**Three states of knowledge:**
1. **Observed true:** Record exists, `value: true`, `confidence > 0`
2. **Observed false:** Record exists, `value: false` or `value: null`, `confidence > 0`
3. **Not observed:** No record exists. We don't know.

The system never confuses "we looked and found nothing" with "we didn't look."

### 3.5 Uncertainty

Uncertainty is represented by `confidence < 1.0`. This is NOT:
- A probability that the claim is true
- A trust score
- A quality rating

It IS:
- A measurement of the observation method's reliability for this predicate
- A way to weight evidence in aggregation
- A way to flag observations that need corroboration

**Example:** A danger detector with single-engine match produces `confidence: 0.60`. This means "this method is 60% reliable for this predicate." A consumer might require two independent observations with `confidence > 0.80` before acting on a destructive-capability finding.

### 3.6 Evidence aging

Evidence does not expire. But evidence has a **temporal validity window** that is consumer-defined, not system-defined:

- A consumer might consider existence evidence > 30 days old as "stale" and request a fresh observation.
- Another consumer might accept year-old evidence for identity but require fresh evidence for behavior.
- The system stores all evidence and lets consumers decide what's stale.

The `timestamp` field enables temporal reasoning. The system does not enforce a TTL.

---

## 4. Evidence Taxonomy

### 4.1 Design principle

The taxonomy is **extensible, not exhaustive**. The initial vocabulary covers the predicates that existing probes can produce. New predicates are added as new probes are built.

Each predicate has:
- A name (controlled vocabulary, kebab-case)
- A layer (0-4)
- A value type (boolean, string, number, object, null)
- A confidence baseline (default confidence for this predicate when observed by its canonical method)

### 4.2 Layer 0 — Identity

| Predicate | Value type | Description |
|---|---|---|
| `identifier-observed` | object | A new identifier was seen for this subject. Payload: `{ type, value, source }` |
| `identifier-changed` | object | An identifier changed. Payload: `{ type, oldValue, newValue, reason }` |
| `publisher-key-rotated` | object | Publisher's signing key changed. Payload: `{ oldKeyId, newKeyId, rotationCert }` |
| `identity-merge-detected` | object | Two subjects appear to be the same. Payload: `{ sharedIdentifiers, subjectA, subjectB }` |

### 4.3 Layer 1 — Existence

| Predicate | Value type | Description |
|---|---|---|
| `repository-resolves` | boolean | Repo URL returns 200 |
| `repository-not-found` | boolean | Repo URL returns 404 |
| `repository-redirected` | object | Repo URL redirects. Payload: `{ from, to, permanent }` |
| `package-resolves` | boolean | Package exists in registry |
| `package-not-found` | boolean | Package missing from registry |
| `package-yanked` | boolean | Package exists but version yanked |
| `endpoint-responds` | boolean | Server endpoint accepts connections |
| `endpoint-unreachable` | boolean | Server endpoint refuses/times out |
| `handshake-succeeds` | boolean | Protocol handshake completed |
| `handshake-fails` | boolean | Protocol handshake failed |
| `version-resolves` | boolean | Declared version exists in registry |

### 4.4 Layer 2 — Vitality

| Predicate | Value type | Description |
|---|---|---|
| `last-push-observed` | string (ISO 8601) | Repository had a push at time T |
| `release-published` | object | New version published. Payload: `{ version, publishedAt }` |
| `issue-opened` | object | Issue activity. Payload: `{ number, openedAt }` |
| `issue-closed` | object | Issue activity. Payload: `{ number, closedAt }` |
| `endpoint-uptime` | object | Endpoint responded to N of M probes. Payload: `{ successes, attempts, window }` |
| `protocol-version-current` | boolean | Server uses latest protocol version |
| `protocol-version-stale` | object | Server uses old protocol. Payload: `{ version, latest }` |
| `commit-activity` | object | Commit frequency. Payload: `{ count, window, since, until }` |

### 4.5 Layer 3 — Behavior

| Predicate | Value type | Description |
|---|---|---|
| `tools-exposed` | object | Server exposes N tools. Payload: `{ count, toolDigests, toolsetDigest }` |
| `schema-valid` | string | Tool schema validates. Value: tool name. |
| `schema-invalid` | object | Tool schema fails validation. Payload: `{ tool, errors }` |
| `destructive-capability-detected` | object | Tool has destructive markers. Payload: `{ tool, score, confidence, engines }` |
| `injection-marker-detected` | object | Tool description contains injection patterns. Payload: `{ tool, markers, score }` |
| `capability-invoked` | object | Tool was called with test args. Payload: `{ tool, argsDigest, resultDigest, succeeded }` |
| `response-consistent` | string | Repeated calls produce same shape. Value: tool name. |
| `response-inconsistent` | object | Repeated calls produce different shapes. Payload: `{ tool, variance }` |
| `toolset-changed` | object | Toolset differs from prior observation. Payload: `{ diff, changeLevel }` |

### 4.6 Layer 4 — Ecosystem

| Predicate | Value type | Description |
|---|---|---|
| `publisher-concentration` | object | Publisher has N servers. Payload: `{ publisher, count, percentOfRegistry }` |
| `dependency-observed` | object | Server depends on package X. Payload: `{ package, version, type }` |
| `anomaly-detected` | object | Publisher behavior deviates from baseline. Payload: `{ metric, baseline, observed, zScore }` |
| `schema-duplication` | object | Multiple servers share identical tool schemas. Payload: `{ toolsetDigest, servers }` |

### 4.7 Predicate registration

New predicates are registered in a vocabulary file (`lib/evidence-predicates.js`) that maps predicate names to their metadata:

```javascript
export const PREDICATES = {
  "repository-resolves": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 1.0,
    description: "Repository URL returns HTTP 200",
  },
  "destructive-capability-detected": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 0.85,
    description: "Tool has destructive capability markers (3-engine fusion, high confidence)",
  },
  // ...
};
```

Unknown predicates (not in the vocabulary) are still accepted by the store. The vocabulary is advisory metadata, not a gate. This allows external probes to produce evidence with new predicates without modifying Trustcard.

---

## 5. Storage Decision

### 5.1 Requirements

1. Append-only — never modify or delete
2. Content-addressed — tampering detectable
3. Time-indexed — query "what did we know at time T?"
4. Subject-indexed — query "what evidence exists for subject X?"
5. Predicate-indexed — query "all repository-not-found observations"
6. Portable — export, mirror, audit by third parties
7. Zero external dependencies — pure Node.js stdlib

### 5.2 Decision: JSONL + index file

**Primary storage:** `data/evidence/YYYY/MM/YYYY-MM-DD.jsonl`
- One file per day
- One JSON record per line
- Append-only (never rewrite)
- Human-readable, git-diffable, trivially portable

**Index:** `data/evidence/index.json`
- Maps subject identifier → record IDs
- Maps predicate → record IDs
- Rebuildable from JSONL files (not a source of truth)
- Updated on append

**Why not SQLite?**
- Adds a dependency (unless we use node:sqlite, which is experimental in Node 22)
- Binary format — not human-readable, not git-diffable
- Overkill for the initial scale
- Migration path exists if needed (see §5.4)

**Why not content-addressed blobs (git-like)?**
- More complex to implement
- Directory explosion (sharding by hash prefix)
- No advantage over JSONL for our access patterns (we query by subject and time, not by hash)

**Why not event sourcing?**
- Evidence IS event sourcing — each record is an event
- JSONL is the simplest possible event log
- No need for a framework; `appendFileSync` is the event append

### 5.3 File layout

```
data/
└── evidence/
    ├── 2026/
    │   └── 07/
    │       ├── 2026-07-25.jsonl    (4,892 records)
    │       ├── 2026-07-26.jsonl    (5,103 records)
    │       └── 2026-07-27.jsonl    (3,417 records, growing)
    └── index.json                   (rebuilt from JSONL)
```

### 5.4 Migration path

**Phase 1 (now):** JSONL + JSON index. Handles ~200K records/day, ~70M/year.

**Phase 2 (if needed):** SQLite via `node:sqlite` (Node 22+ experimental, Node 24+ stable). Same schema, SQL queries. The evidence record format does NOT change — only the storage backend.

**Phase 3 (if needed):** Content-addressed blobs for large payloads + JSONL for metadata. The `claim.payload` field could be stored as a separate content-addressed blob for large observations (e.g., full tool schemas), with the evidence record referencing the blob hash.

**The evidence record format is storage-agnostic.** The schema defined in §1 does not change across storage backends.

### 5.5 Integrity verification

Any third party can verify the evidence store:

1. Download JSONL files
2. For each record, recompute the digest from the content
3. Verify `id` matches `"ev_" + digest`
4. Verify no two records share the same `id` (no tampering via duplication)
5. Verify records are in timestamp order within each file (no reordering)

This is the Certificate Transparency model: the log is public, append-only, and verifiable.

---

## 6. Mapping to Existing Trustcard Components

### 6.1 Three-layer separation

```
┌─────────────────────────────────────────────────────┐
│                  CONSUMPTION LAYER                   │
│   trust.js, guard.js, policy.js, agent query API     │
│   Reads evidence, makes decisions                    │
└──────────────────────┬──────────────────────────────┘
                       │ queries evidence
┌──────────────────────┴──────────────────────────────┐
│                   EVIDENCE LAYER                     │
│   evidence.js, evidence-store.js (NEW)               │
│   Stores, indexes, queries evidence records          │
└──────────────────────┬──────────────────────────────┘
                       │ receives evidence records
┌──────────────────────┴──────────────────────────────┐
│                  OBSERVATION LAYER                   │
│   checks.js, existence.js, observe.js,               │
│   danger-detector.js, client-http.js                 │
│   Probes capabilities, emits evidence records        │
└─────────────────────────────────────────────────────┘
```

### 6.2 Component mapping

| Existing component | Current role | Evidence role | Change required |
|---|---|---|---|
| `existence.js` | Layer 1 verifier | **Evidence producer** | Add evidence record emission after each verification |
| `checks.js` | Scanner (8 checks → score) | **Evidence producer** | Each check emits evidence records. Scorecard becomes derived view. |
| `observe.js` | Server probe | **Evidence producer** | Observation emits multiple evidence records (handshake, tools-exposed, etc.) |
| `danger-detector.js` | Danger analysis | **Evidence producer** | Emits `destructive-capability-detected`, `injection-marker-detected` records |
| `provenance.js` | Signed manifest builder | **Evidence producer** (manifest verification is an observation) | Manifest verification emits `publisher-key-verified` evidence |
| `descriptor.js` | Capability descriptor | **Evidence subject source** | Descriptor digests become identifiers in the constellation |
| `identity.js` | Tool identity computation | **Evidence subject source** | Tool digests become identifiers in the constellation |
| `pin.js` | TOFU pin store | **Evidence consumer** (reads evidence to decide pinning) + **evidence producer** (pinning is an observation about trust state) | No change to pin format. Pin operations emit evidence records. |
| `trust.js` | Trust state machine | **Evidence consumer** | Reads evidence to drive state transitions. No change to state machine. |
| `guard.js` | Enforcement gate | **Evidence consumer** (reads evidence for trust decisions) + **evidence producer** (receipts are evidence) | Receipts already have their own schema. Cross-reference with evidence records. |
| `policy.js` | Invocation policy | **Independent** (consumption layer) | No change. Policy is per-relying-party, not evidence. |
| `receipts.js` | Receipt/chaining system | **Specialized evidence** | Receipts are evidence of invocations with their own schema. Cross-reference via `related` field. |
| `diff.js` | Change classification | **Evidence producer** | Diff results emit `toolset-changed` evidence |
| `change.js` | Change vector | **Evidence producer** | Change vectors emit `toolset-changed` evidence with vector payload |
| `fingerprint.js` | Composite identity card | **Derived view** | Fingerprint becomes a view over evidence records, not a separate computation |
| `manifest.js` | Enforcement manifest | **Independent** (consumption layer) | No change. Enforcement manifest is policy, not evidence. |
| `rotation.js` | Key rotation | **Evidence producer** | Key rotation emits `publisher-key-rotated` evidence |
| `session.js` | Live connection | **Evidence consumer** + **evidence producer** | Session observations emit evidence. Trust decisions consume evidence. |
| `auth.js` | Token validation | **Independent** (consumption layer) | No change. Auth is enforcement, not evidence. |

### 6.3 What becomes an evidence producer?

Every component that observes something about a capability:

1. `existence.js` → Layer 1 evidence (repository-resolves, package-resolves, etc.)
2. `checks.js` → Layer 1-3 evidence (handshake, schema, danger, etc.)
3. `observe.js` → Layer 1-3 evidence (handshake, tools-exposed, etc.)
4. `danger-detector.js` → Layer 3 evidence (destructive-capability, injection-marker)
5. `diff.js` / `change.js` → Layer 3 evidence (toolset-changed)
6. `provenance.js` → Layer 0 evidence (publisher-key-verified)
7. `rotation.js` → Layer 0 evidence (publisher-key-rotated)
8. `pin.js` → Layer 0 evidence (identifier-observed, when pinning reveals new identifiers)
9. `session.js` → Layer 1-3 evidence (handshake, tools-exposed, toolset-changed)

### 6.4 What becomes an evidence consumer?

Every component that makes decisions based on observations:

1. `trust.js` → reads evidence to drive state transitions
2. `guard.js` → reads evidence for Gate 1 trust decisions
3. `session.js` → reads evidence for connection decisions
4. `fingerprint.js` → reads evidence to compose the identity card
5. Future: agent query API → reads evidence to answer trust questions

### 6.5 What remains independent?

1. `policy.js` — per-relying-party invocation authorization. Not evidence-based.
2. `manifest.js` — enforcement manifest. Policy document, not evidence.
3. `auth.js` — token validation. Enforcement, not evidence.
4. `canon.js` — canonicalization. Infrastructure, not evidence.
5. `hash.js` — hashing. Infrastructure, not evidence.

---

## 7. Agent Consumption Model

### 7.1 Design principle

Agents query evidence, not scores. The answer to "can I use this server?" is not a boolean — it's a dataset. The agent (or its trust framework) reads the evidence and decides.

### 7.2 Query patterns

**Q1: "What evidence exists for this capability?"**

```
evidence query --subject io.github.frumu-ai/tandem
```

Returns all evidence records for the subject, grouped by layer and predicate:

```json
{
  "subject": {
    "kind": "capability-provider",
    "identifiers": {
      "registryName": "io.github.frumu-ai/tandem",
      "repoUrl": "https://github.com/frumu-ai/tandem",
      "version": "0.3.2"
    }
  },
  "evidence": {
    "totalRecords": 47,
    "lastObserved": "2026-07-27T14:32Z",
    "layers": {
      "0": { "records": 5, "latest": "identifier-observed" },
      "1": { "records": 30, "latest": { "repository-resolves": true, "handshake-succeeds": true } },
      "2": { "records": 10, "latest": { "last-push-observed": "2026-07-20T..." } },
      "3": { "records": 2, "latest": { "tools-exposed": { "count": 5 } } }
    }
  }
}
```

**Q2: "What changed since last week?"**

```
evidence diff --subject io.github.frumu-ai/tandem --since 2026-07-20
```

Returns evidence records added since the given date, highlighting changes:

```json
{
  "subject": "io.github.frumu-ai/tandem",
  "since": "2026-07-20T00:00:00Z",
  "newEvidence": [
    { "id": "ev_sha256:...", "predicate": "toolset-changed", "timestamp": "2026-07-25T...", "payload": { "changeLevel": "BREAKING" } },
    { "id": "ev_sha256:...", "predicate": "release-published", "timestamp": "2026-07-22T...", "payload": { "version": "0.3.3" } }
  ]
}
```

**Q3: "Why is confidence low?"**

```
evidence explain --subject io.github.frumu-ai/tandem --predicate handshake-succeeds
```

Returns all evidence records for that predicate, showing the confidence history:

```json
{
  "predicate": "handshake-succeeds",
  "records": [
    { "timestamp": "2026-07-27T14:32Z", "value": true, "confidence": 0.95, "method": "mcp-handshake" },
    { "timestamp": "2026-07-20T10:15Z", "value": false, "confidence": 0.80, "method": "mcp-handshake", "payload": { "error": "timeout" } },
    { "timestamp": "2026-07-13T09:00Z", "value": true, "confidence": 0.95, "method": "mcp-handshake" }
  ],
  "explanation": "2 of 3 observations succeeded. The failure on 2026-07-20 was a timeout (confidence 0.80 — could be transient). Latest observation succeeds."
}
```

**Q4: "Can I use this filesystem server?"**

This is NOT an evidence query — it's a trust decision. The agent asks the evidence store for the evidence, then makes the decision. The evidence store returns:

```
evidence query --subject io.github.modelcontextprotocol/server-filesystem
```

The agent's trust framework (not the evidence store) evaluates the evidence and decides.

### 7.3 Query API

The evidence store provides:

```javascript
// Query by subject
store.query({ subject: "io.github.frumu-ai/tandem" })

// Query by subject and layer
store.query({ subject: "io.github.frumu-ai/tandem", layer: 1 })

// Query by subject and predicate
store.query({ subject: "io.github.frumu-ai/tandem", predicate: "repository-resolves" })

// Query by time range
store.query({ since: "2026-07-20T00:00:00Z", until: "2026-07-27T00:00:00Z" })

// Query by predicate across all subjects
store.query({ predicate: "repository-not-found" })

// Get latest observation per predicate for a subject
store.latest({ subject: "io.github.frumu-ai/tandem" })

// Get evidence count per subject
store.stats({ groupBy: "subject" })
```

### 7.4 What the answer looks like

The answer to any trust question is **a set of evidence records with timestamps and confidence values**. The agent sees:

- What was observed
- When it was observed
- How it was observed (method)
- How reliable the method is (confidence)
- How to reproduce it (command)
- What changed and when

The agent does NOT see:
- A score (that's a derived output)
- A recommendation (the system is neutral)
- A trust level (that's a consumption-layer decision)
- A binary "safe/unsafe" verdict (that's the agent's decision to make)

---

## 8. Example Evidence Records

### 8.1 Layer 1 — Repository existence

```json
{
  "$schema": "trustcard.dev/evidence@1",
  "id": "ev_sha256:abc123...",
  "timestamp": "2026-07-27T14:32:00.123Z",
  "observer": {
    "agent": "trustcard",
    "version": "3.0.0",
    "method": "github-repo-verify"
  },
  "subject": {
    "kind": "capability-provider",
    "identifiers": {
      "registryName": "io.github.frumu-ai/tandem",
      "repoUrl": "https://github.com/frumu-ai/tandem",
      "version": "0.3.2"
    }
  },
  "claim": {
    "predicate": "repository-resolves",
    "value": true,
    "layer": 1,
    "confidence": 1.0,
    "payload": {
      "httpStatus": 200,
      "repoId": 12345678,
      "stars": 114,
      "language": "Rust",
      "pushedAt": "2026-07-20T10:30:00Z",
      "license": "MIT"
    }
  },
  "reproducibility": {
    "command": "curl -s -H 'Accept: application/vnd.github+json' https://api.github.com/repos/frumu-ai/tandem",
    "credentials": "github-token",
    "environment": "macos-arm64-local"
  },
  "related": [],
  "supersedes": null,
  "digest": "sha256:def456..."
}
```

### 8.2 Layer 1 — Repository dead (conflict example)

```json
{
  "$schema": "trustcard.dev/evidence@1",
  "id": "ev_sha256:ghi789...",
  "timestamp": "2026-08-15T09:00:00.000Z",
  "observer": {
    "agent": "trustcard",
    "version": "3.0.0",
    "method": "github-repo-verify"
  },
  "subject": {
    "kind": "capability-provider",
    "identifiers": {
      "registryName": "io.github.frumu-ai/tandem",
      "repoUrl": "https://github.com/frumu-ai/tandem",
      "version": "0.3.2"
    }
  },
  "claim": {
    "predicate": "repository-not-found",
    "value": true,
    "layer": 1,
    "confidence": 0.95,
    "payload": {
      "httpStatus": 404
    }
  },
  "reproducibility": {
    "command": "curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/frumu-ai/tandem",
    "credentials": "github-token",
    "environment": "macos-arm64-local"
  },
  "related": ["ev_sha256:abc123..."],
  "supersedes": null,
  "digest": "sha256:jkl012..."
}
```

Note: Both §8.1 and §8.2 exist in the store. The conflict is visible.

### 8.3 Layer 3 — Destructive capability detected

```json
{
  "$schema": "trustcard.dev/evidence@1",
  "id": "ev_sha256:mno345...",
  "timestamp": "2026-07-27T15:00:00.000Z",
  "observer": {
    "agent": "trustcard",
    "version": "3.0.0",
    "method": "danger-analysis",
    "probeVersion": "2.2.1"
  },
  "subject": {
    "kind": "capability",
    "identifiers": {
      "interfaceDigest": "sha256:pqr678...",
      "name": "execute_command",
      "namespace": "shell-server/run_command"
    }
  },
  "claim": {
    "predicate": "destructive-capability-detected",
    "value": true,
    "layer": 3,
    "confidence": 0.85,
    "payload": {
      "tool": "execute_command",
      "score": 0.92,
      "confidence": "high",
      "engines": {
        "heuristic": { "score": 0.90, "reasons": ["destructive verb: execute", "dangerous param: command"] },
        "semantic": { "score": 0.88, "topMatch": "execute arbitrary shell command" },
        "injection": { "score": 0.15, "markers": [] }
      }
    }
  },
  "reproducibility": {
    "command": "node bin/mcp-trustcard.js scan -- npm:@shell/server",
    "credentials": "none",
    "environment": "macos-arm64-local"
  },
  "related": [],
  "supersedes": null,
  "digest": "sha256:stu901..."
}
```

### 8.4 Layer 0 — Publisher key rotation

```json
{
  "$schema": "trustcard.dev/evidence@1",
  "id": "ev_sha256:vwx234...",
  "timestamp": "2026-07-27T16:00:00.000Z",
  "observer": {
    "agent": "trustcard",
    "version": "3.0.0",
    "method": "key-rotation-verify"
  },
  "subject": {
    "kind": "publisher",
    "identifiers": {
      "oldKeyId": "sha256:aaa111...",
      "newKeyId": "sha256:bbb222..."
    }
  },
  "claim": {
    "predicate": "publisher-key-rotated",
    "value": true,
    "layer": 0,
    "confidence": 1.0,
    "payload": {
      "rotationCertDigest": "sha256:ccc333...",
      "verified": true,
      "oldKeySigned": true
    }
  },
  "reproducibility": {
    "command": "node bin/mcp-trustcard.js verify rotation-cert.json",
    "credentials": "none",
    "environment": "macos-arm64-local"
  },
  "related": [],
  "supersedes": null,
  "digest": "sha256:ddd444..."
}
```

### 8.5 Absence of evidence (probe failure)

```json
{
  "$schema": "trustcard.dev/evidence@1",
  "id": "ev_sha256:eee555...",
  "timestamp": "2026-07-27T17:00:00.000Z",
  "observer": {
    "agent": "trustcard",
    "version": "3.0.0",
    "method": "mcp-handshake"
  },
  "subject": {
    "kind": "capability-provider",
    "identifiers": {
      "registryName": "io.github.some/server",
      "endpointUrl": "https://api.example.com/mcp"
    }
  },
  "claim": {
    "predicate": "handshake-succeeds",
    "value": null,
    "layer": 1,
    "confidence": 0.0,
    "payload": {
      "error": "connection timeout after 30s",
      "attempts": 3
    }
  },
  "reproducibility": {
    "command": "node bin/mcp-trustcard.js scan https://api.example.com/mcp",
    "credentials": "none",
    "environment": "macos-arm64-local"
  },
  "related": [],
  "supersedes": null,
  "digest": "sha256:fff666..."
}
```

---

## 9. Open Questions

### 9.1 Should evidence records be signed?

**Current proposal:** No. Evidence records are observations by Trustcard's own probes. The `observer.agent` and `observer.version` fields identify the source. The content address proves integrity.

**Alternative:** Sign each record with an Ed25519 key. This would allow external probes to produce verifiable evidence.

**Recommendation:** Start unsigned. Add signing as an optional field (`observer.signature`) when external probes are introduced. The schema is forward-compatible — adding a signature field doesn't break existing records.

### 9.2 How large can `claim.payload` be?

**Current proposal:** No limit. The payload is part of the record, part of the digest, part of the JSONL line.

**Risk:** Some observations (e.g., full tool schemas, complete API responses) could be large. A single evidence record could be several KB.

**Recommendation:** Start with no limit. If records exceed ~10KB, move large payloads to content-addressed blobs and reference them: `"payload": { "$blob": "sha256:..." }`. The blob store is a separate file (`data/evidence/blobs/`). This is a Phase 3 enhancement.

### 9.3 Should the index be mandatory or lazy?

**Current proposal:** The index is a cache, rebuilt from JSONL files. It can be deleted and rebuilt.

**Question:** Should the store update the index on every append, or rebuild it on query?

**Recommendation:** Update on append (for fast queries). Rebuild on startup (for crash recovery). The index is never a source of truth — if it's lost, it's rebuilt.

### 9.4 How to handle evidence from external sources?

**Current proposal:** External probes produce evidence records with `observer.agent` set to their identity (not "trustcard"). The records are stored alongside Trustcard's own evidence.

**Question:** Should external evidence be trusted differently? Should it be in a separate store?

**Recommendation:** Same store, same format. The `observer.agent` field distinguishes the source. Consumers can filter by observer if they want only Trustcard evidence. This keeps the system open and extensible.

### 9.5 How to represent evidence about evidence?

**Question:** If a probe is found to have a bug, we create a superseding record. But what if we want to record WHY the probe was buggy?

**Recommendation:** The `supersedes` field links the correction. The correcting record's `claim.payload` includes the reason. For deeper analysis (e.g., "this probe version had a bug affecting 1000 records"), create a separate evidence record with `subject.kind: "probe"` and a predicate like `probe-bug-detected`.

### 9.6 Should evidence records include a `ttl` or `stale_after` field?

**Current proposal:** No. Evidence is a fact at a timestamp. It doesn't expire. Consumers define staleness.

**Alternative:** Add a `staleAfter` field that the probe sets based on the predicate type (e.g., existence evidence might be stale after 7 days, identity evidence after 90 days).

**Recommendation:** No `staleAfter` in the record. Staleness is consumer-defined. The predicate vocabulary can include a `recommendedFreshness` advisory in `lib/evidence-predicates.js`, but it's not in the record itself.

### 9.7 How to handle evidence store corruption?

**Question:** If a JSONL file is corrupted (partial write, disk error), what happens?

**Recommendation:** Follow the pin store's fail-closed pattern. On load, if a line fails to parse, log the error with the line number and skip that line. The rest of the file is still valid. The index is rebuilt from the valid lines. A `evidence verify` command checks all files and reports corruption.

### 9.8 What about privacy and sensitive data?

**Question:** Some observations might include sensitive data (e.g., API keys in error messages, private repo URLs).

**Recommendation:** Probes MUST redact sensitive data before emitting evidence. The `reproducibility.credentials` field names the credential type, never the value. The `claim.payload` should not include raw credential values. A `redact.js` utility (already exists) can be used by probes to strip sensitive patterns.

### 9.9 Should evidence records be linked to receipts?

**Question:** Receipts (`receipts.js`) are evidence of specific tool invocations. Should they be converted to evidence records?

**Recommendation:** Not initially. Receipts have their own schema (`trustcard.dev/receipt@1`) and their own storage (JSONL with chaining). Cross-reference via the `related` field: an evidence record about a tool invocation can reference the receipt ID. Converting receipts to evidence records would lose the chaining property.

### 9.10 How does this interact with the existing pin store?

**Question:** The pin store (`pin.js`) is a JSON file with atomic writes. Evidence is JSONL append-only. How do they coexist?

**Recommendation:** They coexist. The pin store is a consumption-layer cache (TOFU decisions). Evidence is the observation layer (facts). When a pin is created, an evidence record is emitted (`identifier-observed` or `toolset-pinned`). When a pin mismatch occurs, an evidence record is emitted (`toolset-changed`). The pin store can be rebuilt from evidence if needed, but it's not — the pin store is the fast-path for enforcement, evidence is the slow-path for reasoning.

---

## 10. Implementation Plan (NOT for this phase)

This section outlines what Phase 3 implementation will look like. It is NOT part of this design review.

### 10.1 `lib/evidence.js` — Evidence record format

- `buildEvidenceRecord({ observer, subject, claim, reproducibility, related, supersedes })` — constructs a record, computes digest
- `evidenceDigest(record)` — reuses `canon.js` + `hash.js`
- `verifyEvidenceRecord(record)` — checks digest, schema version, required fields
- `EVIDENCE_SCHEMA` — `"trustcard.dev/evidence@1"`

### 10.2 `lib/evidence-store.js` — Append-only storage

- `EvidenceStore` class
- `append(record)` — validates, writes to JSONL, updates index
- `query(filters)` — by subject, predicate, layer, time range
- `latest(subject)` — latest record per predicate
- `stats()` — summary statistics
- `verify()` — integrity check
- `rebuildIndex()` — rebuild from JSONL files

### 10.3 `lib/evidence-predicates.js` — Predicate vocabulary

- `PREDICATES` object mapping predicate names to metadata
- `registerPredicate(name, metadata)` — add new predicate
- `LAYER_NAMES` — `["identity", "existence", "vitality", "behavior", "ecosystem"]`

### 10.4 Probe refactoring

Each existing probe gets an `emitEvidence()` function that produces evidence records from its observations. The existing scorecard output remains as a derived view.

### 10.5 CLI

```
mcp-trustcard evidence query --subject <name>
mcp-trustcard evidence history --subject <name>
mcp-trustcard evidence export --since <date>
mcp-trustcard evidence stats
mcp-trustcard evidence verify
```

---

## 11. Summary

### The evidence record is:

- **Atomic** — the smallest unit of observation
- **Immutable** — never modified after creation
- **Content-addressed** — tampering is detectable
- **Timestamped** — a fact at a moment in time
- **Reproducible** — carries its own reproduction instructions
- **Protocol-neutral** — MCP is the first instance, not the assumption
- **Confidence-bearing** — method reliability, not trust score
- **Linked** — related records and supersession chains

### The evidence record is NOT:

- A score (derived by consumers)
- A trust decision (made by consumers)
- A recommendation (the system is neutral)
- A manifest (publisher attestation, not observation)
- A receipt (specialized evidence with its own schema)
- A pin (consumption-layer TOFU decision)

### The evidence record answers:

> **What was observed, about what entity, by what method, at what time, with what confidence, and how can another party independently verify it?**

- **What:** `claim.predicate` + `claim.value` + `claim.payload`
- **About what:** `subject.kind` + `subject.identifiers`
- **By what method:** `observer.method` + `observer.version`
- **At what time:** `timestamp`
- **With what confidence:** `claim.confidence`
- **How to verify:** `reproducibility.command` + `reproducibility.credentials` + content address

### Storage decision:

JSONL append-only files + rebuildable JSON index. Zero dependencies. Migration path to SQLite if scale demands.

### Migration strategy:

Additive. Existing components continue to work. Probes gain evidence emission as an additional output. Scorecard remains as a derived view. No breaking changes to v2 crypto layer or enforcement layer.

### Open questions requiring resolution before implementation:

1. Should evidence records be signed? (Recommendation: start unsigned, add later)
2. How large can payloads be? (Recommendation: no limit initially, blob store later)
3. How to handle external evidence sources? (Recommendation: same store, `observer.agent` distinguishes)
4. Should receipts be converted to evidence records? (Recommendation: no, cross-reference instead)

---

## 12. Next step

This design review is complete. The next step is implementation of `lib/evidence.js`, beginning with the evidence record format and its test suite. No production code should be written until this design is reviewed and approved.
