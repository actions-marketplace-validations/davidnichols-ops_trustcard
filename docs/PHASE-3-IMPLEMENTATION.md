# Phase 3 Implementation — Evidence Substrate

**Date:** 2026-07-27
**Status:** Implementation complete. 456 tests passing. Zero breaking changes.
**Predecessor:** `docs/PHASE-2.5-EVIDENCE-DESIGN.md` (design review, approved)

---

## What Was Built

### Phase 3.1 — Evidence Core

**`lib/evidence.js`** — The atomic primitive.

The evidence record is a 12-field, content-addressed, immutable observation. Every record answers: *What was observed, about what entity, by what method, at what time, with what confidence, and how can another party independently verify it?*

- **Schema:** `$schema`, `id`, `timestamp`, `observer`, `subject`, `claim`, `reproducibility`, `related`, `supersedes`, `digest` (10 user-visible fields + `id` and `digest` derived from content)
- **Content-addressing:** Reuses existing `canon.js` (RFC 8785 JCS) + `hash.js` (SHA-256). Digest computed over the record with `digest` and `id` fields removed — same pattern as manifest digests.
- **Namespaced IDs:** `id = "ev_" + digest` — distinguishes evidence IDs from manifest/descriptor/receipt digests in cross-references.
- **Strict validation:** Rejects records with forbidden fields (scores, trust states, recommendations, expiry). Rejects malformed records (missing required fields, invalid layers, confidence out of range, undefined values).
- **Three-state knowledge model:** `value: true` (observed true), `value: false` (observed false), `value: null` + `confidence: 0.0` (observation failed). Absence of a record = not observed.
- **Supersession:** `correctEvidence()` creates a new record that supersedes an old one. The old record is never deleted — both exist, linked by `supersedes`.
- **Serialization:** `serializeRecord()` produces JCS canonical output (single line, deterministic). `parseRecord()` round-trips with digest verification.

**`lib/evidence-predicates.js`** — The predicate vocabulary.

- **5 layers, ~30 predicates:** identity (4), existence (11), vitality (8), behavior (9), ecosystem (4)
- **Advisory, not a gate:** Unknown predicates are accepted by the store. The vocabulary is metadata, not a validation gate. External probes can produce evidence with new predicates without modifying trustcard.
- **Identifier strength classification:** Cryptographic (keyId, digests) > Strong (repoId, ownerId) > Medium (packageName, registryName) > Weak (repoUrl, endpointUrl). Used for subject matching precedence.
- **Runtime registration:** `registerPredicate()` allows external probes to register new predicates at runtime.

**`test/evidence.test.js`** — 81 tests covering construction, digest determinism, immutability, validation, forbidden fields, three-state model, supersession, serialization, predicate vocabulary, and protocol neutrality.

### Phase 3.2 — Evidence Store

**`lib/evidence-store.js`** — Append-only JSONL storage with multi-key indexing.

- **Storage:** `data/evidence/YYYY/MM/YYYY-MM-DD.jsonl` — one file per day, one record per line, append-only. Human-readable, git-diffable, trivially portable.
- **Multi-key index:** Every identifier in `subject.identifiers` gets its own index entry. This enables efficient subject matching by any identifier (registryName, repoUrl, repoId, keyId, etc.) without scanning all records — critical for the identity constellation model.
- **Query API:** `query({ subject, predicate, layer, observer, method, since, until, limit })` — all filters optional, combined with AND logic. Results sorted by timestamp ascending.
- **Specialized queries:** `latest(subject)` returns most recent record per predicate. `findByIdentifier(value)` searches by any identifier value. `contradictions(subject)` finds same-predicate value conflicts.
- **Index management:** Index is a cache — `rebuildIndex()` reconstructs from JSONL files. `flushIndex()` persists to `index.json`. Corrupt index triggers automatic rebuild.
- **Integrity:** `verify()` re-reads all files, recomputes digests, checks for duplicates. Content-address verification on every read.
- **Corruption handling:** Unparseable lines are skipped with logged errors. Valid records in the same file are preserved.
- **Batch append:** `appendBatch()` groups writes by day file, tracks line numbers correctly for indexing.
- **No update/delete API:** The store has `append()` and `query()` only. Immutability is enforced by the API surface, not just by convention.

**`test/evidence-store.test.js`** — 34 tests covering append/retrieve, duplicate rejection, query by all filter types, time range, sorting, limit, latest(), stats(), index rebuild, index persistence, corruption handling, verify(), identity constellation lookup, contradiction detection, batch append, export, and deterministic file paths.

### Phase 3.3 — Probe Integration

**`lib/evidence-adapters.js`** — Bridge between observation layer and evidence layer.

Pure functions that convert existing probe outputs to evidence records. The existing probe outputs remain unchanged — evidence emission is an additional output path, not a replacement.

- **`existenceToEvidence()`** — Converts `existence.js` output to Layer 0-1 records: `repository-resolves`, `repository-not-found`, `package-resolves`, `package-not-found`, `identifier-observed`. Handles three states: exists, not found, observation failed.
- **`healthcheckToEvidence()`** — Converts `checks.js` report to Layer 1-3 records: `handshake-succeeds`, `handshake-fails`, `tools-exposed`, `schema-valid`, `schema-invalid`, `destructive-capability-detected`, `injection-marker-detected`, `protocol-version-current`, `protocol-version-stale`. Handles CONFIG_REQUIRED as observation-failed (value: null, confidence: 0.0).
- **`observationToEvidence()`** — Converts `observe.js` output to Layer 0-3 records with full tool digests and server digest as identifier.
- **`registryEntryToEvidence()`** — Converts a registry entry to Layer 0 identity record, establishing the initial identity constellation.

**`test/evidence-adapters.test.js`** — 15 tests covering all adapters, including the three-state model, destructive capability detection, protocol version staleness, and verification that no adapter produces forbidden fields.

### Phase 3.4 — Research Query Interface

**CLI `evidence` subcommand** — The beginning of the observatory.

```
mcp-trustcard evidence query --subject <name> [--predicate <p>] [--layer <n>] [--json]
mcp-trustcard evidence history --subject <name> [--since <date>]
mcp-trustcard evidence stats [--json]
mcp-trustcard evidence verify
mcp-trustcard evidence export [--since <date>] [--json-out <file>]
mcp-trustcard evidence contradictions --subject <name>
```

- **query:** Filter evidence by subject, predicate, layer, time range. Output as human-readable table or JSON.
- **history:** Chronological evidence for a subject, grouped by date. Shows observation failures with error details.
- **stats:** Summary statistics — total records, records per layer, top predicates, observer breakdown.
- **verify:** Integrity check — re-reads all files, verifies digests, checks for duplicates.
- **export:** Dataset export for publication. Includes export timestamp and record count.
- **contradictions:** Shows conflicting observations for a subject (same predicate, different values).

---

## Architecture Decisions

### 1. Evidence records are the atomic unit, not scores

The scorecard (0-100 score from `runHealthcheck()`) is a derived view. The evidence store contains the raw observations. The scorecard can be computed from evidence records, but evidence records cannot be reconstructed from a score. This inverts the current dependency: scores depend on evidence, not the other way around.

**Implementation:** The adapters (`evidence-adapters.js`) convert probe output to evidence records. The existing scorecard output remains unchanged. Both coexist — the scorecard for quick consumption, the evidence store for historical analysis and reproducibility.

### 2. Content-addressing reuses existing infrastructure

The evidence digest uses the same JCS (`canon.js`) + SHA-256 (`hash.js`) pipeline as all other trustcard digests (manifests, descriptors, receipts). This ensures:
- Byte-exact reproducibility across implementations
- Interoperability with existing supply-chain tooling (SRI/npm integrity syntax)
- No new cryptographic dependencies
- Consistent tamper detection

### 3. Multi-key indexing for identity constellation

The index maps every identifier value to the records that reference it. This means a subject can be found by `registryName`, `repoUrl`, `repoId`, `keyId`, or any other identifier — without scanning all records. This is critical for the identity constellation model where no single identifier is the primary key.

**Tradeoff:** The index is larger than a single-key index (every record is indexed under N keys). For 18,760 servers × 3 identifiers each × 10 observations, that's ~560K index entries — manageable in memory and JSON.

### 4. Append-only JSONL, not a database

JSONL files are:
- Human-readable (you can `cat` them)
- Git-diffable (you can see what was added)
- Trivially portable (copy the files)
- Append-only by construction (no rewrite needed)
- Zero-dependency (no SQLite, no external service)

**Tradeoff:** Query performance is O(index size) for indexed queries, O(all records) for unindexed queries. For the current scale (~200K records/day), this is fine. The migration path to SQLite (`node:sqlite` in Node 22+) is documented and the evidence record format is storage-agnostic.

### 5. Adapters are pure functions, not probe modifications

The adapters convert probe output to evidence records without modifying the probes. This means:
- Existing probes continue to work unchanged
- The scorecard output remains as a derived view
- Evidence emission is an opt-in additional output path
- New probes can be added without touching the evidence layer

**Tradeoff:** The adapter must understand the probe's output format. If the probe output changes, the adapter must be updated. This is acceptable because the probe output format is stable (it's the scorecard format, used by CI).

### 6. Three-state knowledge model enforced in the schema

The evidence record distinguishes:
- `value: true, confidence > 0` — observed true
- `value: false, confidence > 0` — observed false
- `value: null, confidence: 0.0` — observation attempted but failed
- No record — not observed

This prevents the most common error in trust systems: confusing "we looked and found nothing" with "we didn't look." The schema enforces this by requiring `value` to be present (not `undefined`) and allowing `null` only with `confidence: 0.0`.

### 7. Forbidden fields are rejected, not just discouraged

The evidence record schema actively rejects fields that would make it a trust decision instead of an observation: `score`, `trustState`, `recommendation`, `expiresAt`, etc. This is a hard constraint, not a convention. If someone tries to store a score in an evidence record, the system refuses.

This prevents the most dangerous failure mode: evidence records gradually accumulating trust-related fields until they become trust decisions, at which point the separation between observation and consumption is lost.

---

## Tradeoffs

### What we gained
- **Historical tracking:** Every observation is preserved. We can answer "when did this repo die?" and "what did we know at time T?"
- **Reproducibility:** Every record carries reproduction instructions. Any researcher can verify our observations.
- **Tamper detection:** Content-addressed records make tampering detectable. The `verify` command checks the entire store.
- **Protocol neutrality:** The evidence format has no MCP-specific assumptions. Adding REST API probes requires no format changes.
- **Ecosystem analysis:** Multi-key indexing enables graph-like queries (find all records sharing an identifier, find contradictions).

### What we traded away
- **Query performance:** JSONL + JSON index is slower than SQLite for complex queries. Acceptable for current scale; migration path exists.
- **Storage efficiency:** JSONL is larger than a binary format. ~200 bytes per record vs ~100 bytes in SQLite. Acceptable for the volume.
- **Real-time updates:** The store is batch-oriented (append + periodic index flush). Not designed for streaming. Acceptable — observations are periodic, not real-time.
- **No concurrent writers:** `appendFileSync` is not safe for concurrent processes writing to the same file. Acceptable — the observatory runs as a single process. If concurrent writers are needed, the SQLite migration path handles it.

---

## Remaining Unknowns

### 1. Evidence graph vs. flat store
The current store is flat (records with subject identifiers). Graph queries (traverse the identity constellation, find all capabilities from a publisher) are possible but require client-side traversal. If graph queries become common, we may need a graph index (adjacency list) alongside the current index.

**Current assessment:** The flat store is sufficient. Graph queries can be built as analysis scripts that read the flat store. A graph index would be premature optimization.

### 2. Evidence signing
Records are currently unsigned. The `observer.agent` and `observer.version` fields identify the source. For external observers (third-party researchers, organizations), signing would allow verifiable attribution.

**Current assessment:** Start unsigned. Add `observer.signature` as an optional field when external observers are introduced. The schema is forward-compatible.

### 3. Payload size limits
No limit on `claim.payload` size. Large observations (full tool schemas, complete API responses) could produce multi-KB records.

**Current assessment:** No limit initially. If records exceed ~10KB, move large payloads to content-addressed blobs and reference them: `"payload": { "$blob": "sha256:..." }`. The blob store is a separate file. This is a Phase 4 enhancement.

### 4. Evidence federation
Multiple independent observers producing evidence about the same ecosystem. Competing measurements. Observer reputation.

**Current assessment:** Not implemented. The schema supports it (`observer.agent` distinguishes sources). Federation is a research direction, not an immediate need.

### 5. Logical contradictions vs. predicate-level contradictions
The `contradictions()` method finds same-predicate value conflicts. But `repository-resolves = true` and `repository-not-found = true` are logically contradictory even though they're different predicates. A higher-level contradiction detector would understand predicate semantics.

**Current assessment:** The current method is correct for its scope (same-predicate conflicts). Logical contradiction detection is a consumption-layer function that understands predicate semantics.

---

## Next Research Opportunities

### 1. Full ecosystem scan with evidence emission
Run the existing `scan-ecosystem.mjs` script with evidence emission enabled. This would produce the first evidence-based ecosystem dataset — every observation stored as an immutable, content-addressed record.

### 2. Historical drift analysis
With evidence stored over time, we can answer: "How has the ecosystem changed?" — new servers appearing, repos dying, tool schemas evolving, protocol versions being adopted. This is the first longitudinal study of the MCP ecosystem.

### 3. pipeworx-io investigation with evidence
Scan 50 pipeworx-io servers. Store the evidence. Query for schema duplication (`schema-duplication` predicate). This would be the first evidence-based anomaly investigation.

### 4. Agent consumption API
Build the query API that lets an agent ask "I need a filesystem capability" and receive evidence-ranked options. This is the consumption-layer counterpart to the evidence store.

### 5. Evidence dataset publication
Export the evidence store as a public dataset (CC BY 4.0). This is the Certificate Transparency model — the log is public, append-only, and verifiable. Researchers, companies, and open-source maintainers can use it.

### 6. Multi-protocol probes
Write the first non-MCP probe (e.g., a REST API probe that reads OpenAPI specs). Verify that the evidence format handles it without changes. This validates the protocol neutrality claim.

---

## Test Summary

| Test file | Tests | Status |
|---|---|---|
| `test/evidence.test.js` | 81 | All pass |
| `test/evidence-store.test.js` | 34 | All pass |
| `test/evidence-adapters.test.js` | 15 | All pass |
| Existing tests (all other files) | 326 | All pass |
| **Total** | **456** | **All pass** |

Zero breaking changes. The existing 326 tests (covering JCS canonicalization, hashing, identity digests, diff classification, trust state machine, manifests, provenance, TOFU pinning, enforcement guard, policy, auth, rotation, danger detection, and the scanner) all pass unchanged.

---

## Files Created

| File | Purpose | Lines |
|---|---|---|
| `lib/evidence.js` | Evidence record format — the atomic primitive | 290 |
| `lib/evidence-predicates.js` | Predicate vocabulary registry | 210 |
| `lib/evidence-store.js` | Append-only JSONL storage with multi-key indexing | 380 |
| `lib/evidence-adapters.js` | Bridge between existing probes and evidence layer | 310 |
| `test/evidence.test.js` | Evidence record tests | 410 |
| `test/evidence-store.test.js` | Evidence store tests | 370 |
| `test/evidence-adapters.test.js` | Evidence adapter tests | 260 |
| `bin/mcp-trustcard.js` | CLI `evidence` subcommand (added) | +200 |

**No dependencies added.** Pure Node.js stdlib. Consistent with trustcard's zero-dependency philosophy.

---

## What This Enables

The evidence substrate is now the foundation. Everything built on top of it — trust reasoning, agent queries, research reports, ecosystem monitoring — reads from and writes to this layer.

The telescope is built. The observatory can begin.
