# Phase 2 Architecture Proposal — The Evidence Substrate

**Date:** 2026-07-27
**Author:** Devin (autonomous research architect, human oversight)
**Status:** Architecture proposal — not implementation. This document attacks previous assumptions and proposes what should exist.

---

## 0. Preamble: What this document does

This document re-evaluates the project from first principles. It does not assume the Four-Layer Model is correct. It does not assume trustcard's current primitives are the right ones. It does not assume MCP is the boundary. It proposes an architecture, explains why, and identifies where the current design must change.

---

## 1. Revised Mission Statement

### Previous mission
"Build the world's first continuously operating autonomous agent ecosystem observatory."

### The problem with it
It describes the activity (observing) not the outcome (what observing enables). An observatory is a building; we need to know what instrument it houses.

### Revised mission

> **Build the evidence infrastructure that allows autonomous agents to make trust decisions about external capabilities they did not build, do not control, and cannot inspect.**

The system produces, preserves, and makes queryable the evidence required for trust decisions. It does not make trust decisions itself — that is the relying party's job. It ensures the evidence exists, is reproducible, and is available.

The distinction is critical: **we are not building an oracle. We are building a telescope.** A telescope doesn't tell you what to believe about the stars. It ensures you can see them clearly enough to form your own conclusions.

---

## 2. Core Architectural Principles

### P1. Evidence is the atomic unit, not scores

A score is a lossy compression of evidence into a number. It is a derived output, not a primary artifact. The system must store evidence first and derive scores (if at all) as a consumption-layer concern.

**Implication:** The core data structure is an evidence record, not a scorecard. The current `runHealthcheck()` output (score + checks) is a derived view, not the storage format.

### P2. Observations are immutable and timestamped

Every observation is a fact that was true at a moment in time. "Repository X returned 404 on 2026-07-27T14:32Z" is a fact. "Repository X is dead" is an inference. The system stores facts, not inferences.

**Implication:** Evidence records are append-only. We never update or delete an observation. We add new observations that may contradict old ones. The history IS the data.

### P3. Identity is a constellation, not a single key

No single identifier is stable across all changes a capability can undergo. Registry names can change. Repositories can be renamed. Packages can transfer ownership. Publisher keys rotate. Server endpoints migrate.

The system tracks a **constellation of identifiers** for each capability. Any one can change without breaking identity. All of them changing simultaneously is the signal of something suspicious, not a normal transition.

**Implication:** The identity model is multi-key, not single-key. The current `serverDigest` is one identifier in the constellation, not the identity.

### P4. The system is protocol-neutral; MCP is the first instance

The trust problem ("should an agent use this external capability?") is not specific to MCP. MCP is one protocol for exposing capabilities. REST APIs, gRPC services, CLI tools, agent-to-agent protocols, and model providers all present the same problem.

The architecture must be general enough to measure any capability provider, with MCP as the reference implementation. The evidence model, storage format, and query API are protocol-neutral. The observation methods (how you probe an MCP server vs a REST API) are protocol-specific plugins.

**Implication:** The system has a protocol-neutral core and protocol-specific probes. The current code is MCP-specific throughout — this needs separation.

### P5. Reproducibility is mandatory

Every observation must include enough information to reproduce it: the method, the tool version, the command, the environment, and the timestamp. An observation that cannot be reproduced is an opinion, not evidence.

**Implication:** Evidence records carry their own reproduction instructions. This is already partially implemented (scan output includes `runAt`, spec, and tool version) but needs to be formalized.

### P6. The system is neutral

The system does not rank, recommend, or censor. It presents evidence. Ranking and recommendation are consumption-layer concerns that may be built on top of the evidence, but they are not the evidence itself.

**Implication:** No "approved list." No "top 10 MCP servers." The output is a dataset, not a leaderboard. Leaderboards can be derived from the dataset by third parties.

---

## 3. What is the actual unsolved problem?

### The surface problem
Agents need to use external tools. There are 18,760+ MCP servers. Most of them are unvetted. Some are dead. Some are malicious. Some are abandoned. How does an agent decide which to use?

### The deeper problem
Trust decisions require evidence. Evidence requires observation. Observation requires infrastructure. **No one is building the observation infrastructure for the agent ecosystem.**

Circadian observed the ecosystem once, published a dataset, and left. The registry publishes metadata but doesn't verify it. npm audit checks for known vulnerabilities but doesn't observe runtime behavior. Certificate Transparency logs certificate issuance but doesn't assess the CA's competence.

The unsolved problem is: **there is no continuously operating, reproducible, evidence-producing observation system for agent capabilities.**

### What this is NOT
- Not a trust framework (that's a standard, not infrastructure)
- Not a registry (that's a directory, not an observer)
- Not a scanner (that's a tool, not a system)
- Not a score (that's a derived output, not evidence)
- Not an enforcement layer (that's a consumer, not a producer)

### What this IS
An **evidence substrate** — the lowest layer of the trust stack. It produces the raw material that trust frameworks, registries, scanners, scores, and enforcement layers all depend on but none of them provide.

---

## 4. Is MCP the correct abstraction boundary?

### Short answer
No. MCP is a protocol, not a trust domain. The trust problem is about **capabilities**, not protocols. MCP is the first protocol to study because it's the first with a registry and standardized tool discovery. But the architecture must not assume MCP is the only capability surface.

### Long answer

A capability is an abstract function: "search a filesystem," "send an email," "query a database." Capabilities are exposed through protocols — MCP, REST, gRPC, CLI, agent-to-agent. The trust question is about the capability, not the protocol:

- Is this capability provided by something that exists?
- Is the provider maintained?
- Does the capability do what it claims?
- Is it safe to invoke?

These questions are protocol-neutral. The methods for answering them are protocol-specific:

| Protocol | How you discover tools | How you probe behavior | How you verify identity |
|---|---|---|---|
| MCP | `tools/list` | `tools/call` | tool digest (semantic projection) |
| REST | OpenAPI spec | HTTP request | API spec hash |
| gRPC | reflection | gRPC call | proto file hash |
| CLI | `--help` | execute with args | man page / binary hash |
| Agent-to-agent | capability advertisement | protocol-specific | TBD |

**Architecture implication:** The system has a protocol-neutral core (evidence model, storage, query API) and protocol-specific probe plugins. Adding a new protocol means writing a new probe, not rebuilding the system.

### What this means for trustcard today
trustcard is currently MCP-specific in its bones: `McpStdioClient`, `McpHttpClient`, `tools/list`, `tools/call`, MCP protocol versions. This is fine for the first implementation but the evidence model and storage layer must not encode MCP assumptions.

---

## 5. Re-evaluating the Four-Layer Model

### The current model
```
Layer 1: Existence    — "Does this thing exist?"
Layer 2: Health       — "Is this thing alive?"
Layer 3: Behavior     — "Does it do what it claims?"
Layer 4: Trust        — "Should an agent use this?"
```

### What's right
The four layers capture a real hierarchy of questions. You can't assess health without first establishing existence. You can't assess behavior without a running server. Trust reasoning requires all prior evidence.

### What's wrong

**Problem 1: Layer 4 is not a layer, it's a consumer.**
"Should an agent use this?" is not an observation — it's a decision. The system should not make trust decisions. It should produce the evidence that trust decisions are made from. Layer 4 belongs in the consumption layer, not the observation layer.

**Problem 2: The model is missing a Layer 0 — Identity.**
Before you can ask "does this exist?" you need to know what "this" is. Identity is the foundation: what is the stable referent that we're making observations about? This is the hardest problem (repos rename, packages transfer, servers migrate) and the model doesn't address it.

**Problem 3: The model is missing context.**
The same capability is riskier in a production environment with real credentials than in a sandbox. The model treats each capability as having intrinsic properties, but many properties are context-dependent.

**Problem 4: The model is missing ecosystem-level evidence.**
Publisher concentration (pipeworx-io: 1,270 servers), dependency chains (server A depends on server B), and supply chain patterns are trust-relevant but don't fit into any layer — they're properties of the graph, not of individual servers.

**Problem 5: The model is a pipeline, but evidence is a graph.**
A dead repo (Layer 1) affects health assessment (Layer 2) and feeds back into identity confidence (Layer 0). A behavioral anomaly (Layer 3) changes what we measure in Layer 2. The layers are not a pipeline; they're evidence categories that interact.

### Revised model

```
Layer 0: Identity     — "What is this thing, stably?"
Layer 1: Existence    — "Does it exist right now?"
Layer 2: Vitality     — "Is it maintained and responsive?"
Layer 3: Behavior     — "Does it do what it claims?"
Layer 4: Ecosystem    — "What is its context in the network?"

(Trust reasoning is not a layer. It is a consumption-layer
function that reads evidence from all layers.)
```

### Evidence by layer

**Layer 0 — Identity** (the stable referent)
- Registry name (e.g. `io.github.owner/server`)
- Repository URL (GitHub, GitLab, etc.)
- Package identifier (npm, PyPI, etc.)
- Publisher key (Ed25519 public key)
- Interface digest (content-addressed contract)
- Implementation identity (npm dist integrity, source commit, container digest)
- Endpoint URL (for remote servers)

These form a constellation. The system tracks all of them. Any one can change. The identity is the set, not any single member.

**Layer 1 — Existence** (current state)
- Repository resolves (200/404/redirect)
- Package resolves in registry
- Endpoint responds (HTTP 200/connection refused/timeout)
- Protocol handshake succeeds
- Publisher key is valid
- Version exists in registry

**Layer 2 — Vitality** (maintenance + responsiveness)
- Last commit date, push date
- Release frequency
- Issue open/close rate
- Dependency freshness
- Endpoint uptime (repeated probes)
- Protocol version currency
- Registry metadata freshness (last published vs last repo push)

**Layer 3 — Behavior** (what it actually does)
- Tool schemas valid
- Declared capabilities match observed capabilities
- Destructive capability analysis
- Prompt injection detection
- Response consistency (repeated calls produce consistent results)
- Capability invocation tests (does `search` actually search?)

**Layer 4 — Ecosystem** (network context)
- Publisher concentration (how many servers from this publisher?)
- Dependency graph (does this server depend on others?)
- Supply chain (what packages does it use? are any compromised?)
- Adoption signals (stars, forks, downloads — but never as primary trust signal)
- Anomaly detection (is this publisher generating servers at abnormal rate?)

### Which layers create the highest leverage?

**Layer 0 (Identity)** is the highest leverage because everything depends on it. If identity is wrong, all downstream evidence is misattributed. This is also the hardest layer and the one the current system handles most poorly.

**Layer 1 (Existence)** is the cheapest to collect and already produces the most striking findings (25% dead repos). It's the foundation of ecosystem visibility.

**Layer 4 (Ecosystem)** is the highest research leverage because no one else is doing it. Individual server assessment is useful but not novel. Ecosystem-level analysis (concentration, supply chain, anomaly detection) is unexplored territory.

---

## 6. Recommended System Architecture

### Three-system separation

```
┌─────────────────────────────────────────────────────┐
│                  CONSUMPTION LAYER                   │
│   (trust decisions, enforcement, agent queries)      │
│   trust.js, guard.js, policy.js, future query API    │
└──────────────────────┬──────────────────────────────┘
                       │ reads evidence
┌──────────────────────┴──────────────────────────────┐
│                   EVIDENCE LAYER                     │
│   (storage, indexing, querying, historical tracking) │
│   NEW: evidence store, evidence graph, query engine  │
└──────────────────────┬──────────────────────────────┘
                       │ fed by observations
┌──────────────────────┴──────────────────────────────┐
│                  OBSERVATION LAYER                   │
│   (probes, crawlers, verifiers — protocol-specific)  │
│   checks.js, existence.js, crawl-registry, future    │
│   REST probes, gRPC probes, behavioral tests         │
└─────────────────────────────────────────────────────┘
```

The current trustcard conflates all three. The scanner (observation) directly produces a scorecard (consumption). There is no evidence layer — observations are not stored, they're printed and discarded.

### What changes

**Observation layer:** Mostly exists already. The scanner, existence checker, and registry crawler are observation tools. They need to output evidence records instead of (or in addition to) scorecards. Protocol-specific probes are plugins.

**Evidence layer:** Does not exist. This is the primary thing to build. It is the core asset. It stores observations immutably, indexes them by subject and time, and provides a query API.

**Consumption layer:** Partially exists. trust.js, guard.js, policy.js are consumption-layer components. The score in checks.js is a consumption-layer derived output. The agent query API ("I need a filesystem capability") is a future consumption-layer feature.

---

## 7. Data Model Proposal

### The Evidence Record (atomic unit)

```json
{
  "id": "ev_sha256:ABC123...",
  "type": "observation",
  "timestamp": "2026-07-27T14:32:00.000Z",
  "observer": {
    "agent": "trustcard",
    "version": "3.0.0",
    "method": "github-repo-verify",
    "environment": "M4-Mac-local"
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
    "predicate": "repository-exists",
    "value": true,
    "layer": 1,
    "confidence": 1.0,
    "evidence": {
      "httpStatus": 200,
      "repoId": 12345678,
      "stars": 114,
      "language": "Rust",
      "pushedAt": "2026-07-20T..."
    }
  },
  "reproducibility": {
    "command": "curl -s -H 'Accept: application/vnd.github+json' https://api.github.com/repos/frumu-ai/tandem",
    "seed": null,
    "credentials": "github-token"
  }
}
```

### Evidence Record fields

| Field | Purpose |
|---|---|
| `id` | Content-addressed hash of the record (JCS + SHA-256). Immutable. |
| `type` | `observation` (future: `hypothesis`, `experiment`, `finding`) |
| `timestamp` | When the observation was made (ISO 8601, UTC) |
| `observer.agent` | What made the observation (e.g. "trustcard") |
| `observer.version` | Version of the observing software |
| `observer.method` | Specific observation method (e.g. "github-repo-verify", "mcp-handshake") |
| `observer.environment` | Where it ran (e.g. "M4-Mac-local", "T4-Colab") |
| `subject.kind` | What the observation is about (capability-provider, repository, package, publisher) |
| `subject.identifiers` | The constellation of identifiers for the subject |
| `claim.predicate` | What is being asserted (e.g. "repository-exists", "handshake-succeeds") |
| `claim.value` | The observed value |
| `claim.layer` | Which evidence layer (0-4) |
| `claim.confidence` | 0.0-1.0 — how confident the observation method is |
| `claim.evidence` | Raw observation data (method-specific) |
| `reproducibility.command` | How to reproduce this observation |
| `reproducibility.credentials` | What credentials were used (named, not values) |

### The Evidence Graph

Evidence records reference subjects. Subjects reference each other. The graph structure:

```
Publisher ──owns──→ Repository ──produces──→ Package ──provides──→ Capability
     │                  │                        │                     │
     │                  │                        │                     │
  evidence           evidence                 evidence              evidence
  records            records                  records               records
  (Layer 0,4)       (Layer 1,2,4)          (Layer 1,2)          (Layer 1,3)
```

Each node has:
- A set of identifiers (the constellation)
- A set of evidence records (observations over time)
- Edges to related nodes

Each edge has:
- A type (owns, produces, provides, depends-on, derives-from)
- A time range (when was this edge valid?)
- Evidence supporting the edge

### Why a graph, not a table?

1. **Identity changes.** A repo can rename. In a table, this is a foreign key update. In a graph, it's a new identifier node linked to the same subject.

2. **Ecosystem analysis.** "How many servers depend on packages from publisher X?" is a graph query. It's not answerable from per-server tables.

3. **Evidence propagation.** If a publisher is compromised, all capabilities from that publisher inherit reduced confidence. This is graph traversal, not a per-record computation.

4. **Contradiction detection.** If two observations disagree (repo exists vs repo 404), the graph stores both with timestamps. The contradiction is visible, not hidden by an update.

---

## 8. Evidence Model Proposal

### Predicates (vocabulary of claims)

The system uses a controlled vocabulary of predicates. Each predicate is a specific, observable property:

**Layer 0 — Identity:**
- `identifier-observed` — a new identifier was seen for this subject
- `identifier-changed` — an identifier changed (e.g. repo renamed)
- `publisher-key-rotated` — publisher's signing key changed

**Layer 1 — Existence:**
- `repository-resolves` — repo URL returns 200
- `repository-not-found` — repo URL returns 404
- `package-resolves` — package exists in registry
- `package-not-found` — package missing from registry
- `endpoint-responds` — server endpoint accepts connections
- `endpoint-unreachable` — server endpoint refuses/times out
- `handshake-succeeds` — protocol handshake completed
- `handshake-fails` — protocol handshake failed
- `version-resolves` — declared version exists

**Layer 2 — Vitality:**
- `last-push-observed` — repository had a push at time T
- `release-published` — new version published
- `issue-opened` / `issue-closed` — issue activity
- `endpoint-uptime` — endpoint responded to N of M probes
- `protocol-version-current` / `protocol-version-stale`

**Layer 3 — Behavior:**
- `tools-exposed` — server exposes N tools with schemas
- `schema-valid` / `schema-invalid` — tool schemas validate
- `destructive-capability-detected` — tool has destructive markers
- `injection-marker-detected` — tool description contains injection patterns
- `capability-invoked` — tool was called with test args
- `response-consistent` / `response-inconsistent` — repeated calls produce same shape

**Layer 4 — Ecosystem:**
- `publisher-concentration` — publisher has N servers (X% of registry)
- `dependency-observed` — server depends on package X
- `anomaly-detected` — publisher behavior deviates from baseline

### Confidence

Confidence is per-observation, not per-subject. It reflects how reliable the *observation method* is, not how reliable the *subject* is.

| Method | Confidence | Rationale |
|---|---|---|
| GitHub API 200 response | 1.0 | Authoritative |
| GitHub API 404 response | 0.95 | Could be temporary outage (but we verified this) |
| npm registry 200 | 1.0 | Authoritative |
| MCP handshake success | 0.95 | Could be transient |
| MCP handshake failure | 0.80 | Could be network/config issue |
| Danger detector (3-engine, high confidence) | 0.85 | Heuristic, but triply-confirmed |
| Danger detector (single engine) | 0.60 | Heuristic |
| Dependency analysis | 0.90 | Package.json is authoritative |

Confidence is NOT a trust score. It is a measurement of the observation method's reliability. A high-confidence observation that a repo is dead is not a trust judgment — it's a reliable fact.

---

## 9. Storage Strategy

### Requirements
1. **Append-only** — never modify or delete observations
2. **Content-addressed** — each record has a hash; tampering is detectable
3. **Time-indexed** — can query "what did we know about X at time T?"
4. **Subject-indexed** — can query "what evidence exists for subject X?"
5. **Portable** — can be exported, mirrored, audited by third parties
6. **No external dependencies** — consistent with trustcard's zero-dep philosophy

### Proposed: JSONL files + index

**Primary storage:** `data/evidence/YYYY/MM/DD.jsonl` — one file per day, JSON Lines format. Each line is one evidence record. Append-only. Content-addressed by hash.

**Index:** `data/evidence/index.json` — maps subject identifiers to record IDs and timestamps. Rebuilt from JSONL files. Not a source of truth — a cache.

**Why not a database?**
- SQLite would be convenient but adds a dependency and a binary format
- The data volume is manageable: ~18,760 servers × ~10 observations each × daily scans = ~190K records/day, ~70M/year. JSONL handles this fine.
- JSONL is human-readable, git-diffable, and trivially portable
- A database can be built on top later if query performance demands it

**Why not git?**
- Git is for source code, not data. 50MB JSON files don't diff well.
- But: evidence files CAN be committed to a separate data repo for public auditability
- The primary storage is the filesystem; git is optional for publication

### Historical tracking

The system maintains a running history. For each subject:
- All observations ever made, in chronological order
- The current "view" (latest observation per predicate)
- The change log (what changed and when)

This enables:
- "When did this repo die?" — find the first `repository-not-found` after a `repository-resolves`
- "How has this server's toolset evolved?" — sequence of `tools-exposed` records over time
- "Is this publisher accelerating?" — count of `identifier-observed` records per month

### Mirroring and audit

The evidence store is designed to be mirrored. Any third party can:
1. Download the JSONL files
2. Verify content addresses (re-hash each record)
3. Rebuild the index
4. Run their own analysis

This is the Certificate Transparency model: the log is public, append-only, and verifiable.

---

## 10. Scanning Architecture

### Current state
The scanner is a monolithic function (`runHealthcheck`) that runs 8 checks and produces a scorecard. It's called once per server and the output is printed or saved to a file.

### Proposed architecture

```
Probe Registry
    ├── RegistryProbe        — crawls the MCP registry
    ├── GitHubRepoProbe      — verifies repository existence
    ├── NpmPackageProbe      — verifies package existence
    ├── PublisherProbe       — verifies publisher identity
    ├── McpStdioProbe        — MCP handshake + tools/list (stdio)
    ├── McpHttpProbe         — MCP handshake + tools/list (HTTP/SSE)
    ├── DangerAnalysisProbe  — destructive capability analysis
    ├── SchemaValidationProbe — tool schema validation
    ├── DependencyProbe      — package dependency analysis
    ├── BehavioralProbe      — (future) capability invocation tests
    └── EcosystemProbe       — (future) publisher concentration, anomaly detection
```

Each probe:
- Is independently runnable
- Produces evidence records (not scores)
- Has a protocol-specific interface but a protocol-neutral output format
- Includes reproducibility metadata
- Can be scheduled independently

### Probe orchestration

A coordinator schedules probes:
- **Daily:** RegistryProbe (delta crawl), GitHubRepoProbe (for new/changed entries)
- **Weekly:** McpStdioProbe + McpHttpProbe (for a sample of the ecosystem)
- **On-demand:** Any probe for a specific subject
- **Continuous:** EcosystemProbe (anomaly detection over accumulated evidence)

The coordinator is NOT a scheduler framework. It's a script that runs probes and writes evidence records. Cron or launchd handles timing.

### What changes from current code

The current `runHealthcheck()` function would be refactored:
- Each check becomes a separate probe
- Each probe outputs evidence records instead of score components
- The scorecard becomes a derived view computed from evidence records
- The `scan` CLI command becomes a convenience that runs multiple probes and shows the derived scorecard

**This is a refactor, not a rewrite.** The observation logic (handshake, schema validation, danger detection) stays. What changes is the output format and storage.

---

## 11. Research Pipeline

### The loop (from the North Star)

```
Observe → Find anomalies → Generate hypotheses → Design experiments →
Collect evidence → Update trust model → Publish findings → Improve infrastructure
```

### How the architecture supports this

1. **Observe:** Probes run continuously, producing evidence records.
2. **Find anomalies:** Analysis scripts query the evidence store for outliers (e.g. pipeworx-io's 1,270 servers, sudden death spikes, tool poisoning patterns).
3. **Generate hypotheses:** The researcher (human or agent) forms hypotheses from anomalies.
4. **Design experiments:** Write new probes or analysis scripts. Run them against the evidence store.
5. **Collect evidence:** New probes produce new evidence records.
6. **Update trust model:** The consumption layer updates its reasoning based on new evidence types.
7. **Publish findings:** Export evidence datasets and analysis reports.
8. **Improve infrastructure:** Add probes, fix bugs, extend the model.

### What this looks like in practice

**Week 1:** Run full ecosystem scan. Observe that 25% of repos are dead. Hypothesize that dead repos correlate with single-version registry entries. Design experiment: cross-reference repo death with registry version count. Collect evidence: query the evidence store. Finding: "Servers with dead repos are 3x more likely to have only one registry version." Publish. Improve: add a probe that flags single-version + dead-repo as a high-risk combination.

**Week 2:** Observe pipeworx-io anomaly. Hypothesize that these are auto-generated stubs. Design experiment: scan 50 pipeworx-io servers, compare tool schemas. Collect evidence: run McpStdioProbe + McpHttpProbe against pipeworx-io servers. Finding: "47 of 50 pipeworx-io servers expose identical tool schemas with different descriptions — consistent with templated generation." Publish. Improve: add a probe that detects schema duplication across publishers.

---

## 12. Implementation Roadmap

### Phase 3: Evidence Substrate (2-3 weeks)

**Goal:** Build the evidence layer. This is the core asset.

1. **Evidence record format** (`lib/evidence.js`)
   - Define the record schema
   - Content-addressed hashing (reuse existing JCS + SHA-256)
   - Serialize/deserialize
   - Tests

2. **Evidence store** (`lib/evidence-store.js`)
   - Append-only JSONL storage
   - Index by subject and timestamp
   - Query API: by subject, by predicate, by time range
   - Tests

3. **Refactor probes to emit evidence records**
   - `existence.js` → emits Layer 1 evidence records
   - `checks.js` → each check becomes a probe that emits evidence
   - `crawl-registry.mjs` → emits Layer 0 identity records
   - Keep existing scorecard as a derived view

4. **Evidence CLI** (`bin/mcp-trustcard.js evidence <subcommand>`)
   - `evidence query --subject <name>` — show all evidence for a subject
   - `evidence history --subject <name>` — chronological evidence
   - `evidence export --since <date>` — export evidence dataset
   - `evidence stats` — summary statistics

### Phase 4: Ecosystem Visibility (2-3 weeks)

**Goal:** Complete population-scale visibility.

1. **Full existence scan** — run Layer 1 probes against all 18,760 servers
2. **Layer 2 vitality probes** — GitHub metadata (commits, releases, issues)
3. **Delta crawler** — incremental registry updates (not full re-crawl)
4. **First ecosystem dataset publication** — reproducible, CC BY 4.0

### Phase 5: Research Instruments (3-4 weeks)

**Goal:** Start the research loop.

1. **Anomaly detection scripts** — pipeworx-io, schema duplication, death spikes
2. **Layer 3 behavioral probes** — capability invocation tests (sandboxed)
3. **Layer 4 ecosystem probes** — publisher concentration, dependency graph
4. **First research report** — State of MCP Ecosystem, Q3 2026

### Phase 6: Consumption Layer (ongoing)

**Goal:** Make evidence useful to agents.

1. **Agent query API** — "I need a filesystem capability" → evidence-ranked options
2. **Trust reasoning model** — multi-evidence confidence, not a single score
3. **Integration with enforcement layer** — guard.js reads from evidence store
4. **Public dataset publication** — regular releases, like CT logs

### What NOT to build (yet)

- No dashboard (build the telescope first)
- No ranking system (evidence, not opinions)
- No real-time monitoring (daily/weekly is sufficient for now)
- No sandbox layer (needed for behavioral testing, but not yet)
- No multi-protocol support (MCP first, generalize later)
- No blockchain (content-addressed JSONL is sufficient)

---

## 13. Risks and Incorrect Assumptions

### Risk 1: We might be building the wrong thing

**Assumption:** Agents need evidence to make trust decisions.
**Counter:** Maybe agents will just use whatever the registry gives them and ignore trust signals. Maybe the market will centralize around a few trusted publishers (like npm's most-downloaded packages) and the long tail doesn't matter.

**Mitigation:** The evidence substrate is useful even if agents don't consume it directly. Researchers, security teams, and registry maintainers can use it. Circadian's dataset proved that ecosystem-level evidence has value even without a consumption layer.

### Risk 2: The evidence store might not scale

**Assumption:** JSONL files can handle the data volume.
**Counter:** 18,760 servers × 10 probes × daily = 190K records/day. Over a year that's ~70M records, ~50GB. JSONL might get unwieldy.

**Mitigation:** Start with JSONL. If it becomes a problem, migrate to SQLite (still no external service dependency). The evidence record format is storage-agnostic — the schema doesn't change, only the storage backend.

### Risk 3: GitHub API rate limits might cap observation frequency

**Assumption:** 5000 requests/hour is enough for population-scale scanning.
**Counter:** 18,760 servers × 1 repo check = 18,760 requests = ~4 hours. That's fine for daily checks but not for real-time monitoring.

**Mitigation:** Use conditional requests (ETag/If-Modified-Since) to reduce API calls. Cache results aggressively. Only re-check servers that have changed in the registry.

### Risk 4: MCP might not survive

**Assumption:** MCP is the first protocol to study, and the architecture generalizes.
**Counter:** MCP might be replaced by a different protocol. If we've invested heavily in MCP-specific infrastructure, that investment is lost.

**Mitigation:** The evidence model is protocol-neutral. The probe architecture is plugin-based. If MCP is replaced, we write new probes for the new protocol. The evidence store, query API, and research pipeline are reusable.

### Risk 5: The score might be more useful than evidence for practical adoption

**Assumption:** Evidence is the primary artifact; scores are derived.
**Counter:** Developers and agents might prefer a simple score. "Is this safe? 87/100." is easier to consume than "Here are 47 evidence records."

**Mitigation:** The score can still exist as a derived output. The system produces both. But the evidence is the asset; the score is a convenience. If we only build the score, we're another scanner. If we build the evidence, we're infrastructure.

### Risk 6: We might be solving a problem that doesn't exist yet

**Assumption:** The agent ecosystem needs trust infrastructure now.
**Counter:** There are 18,760 MCP servers but probably fewer than 100 are actually used in production. The trust problem might not be real yet because the ecosystem hasn't matured enough for agents to encounter it at scale.

**Mitigation:** The evidence substrate is valuable now for research (understanding the ecosystem) even if the trust consumption layer isn't needed yet. Building the telescope before you need it is the point — you can't build it when the supernova is already happening.

### Incorrect assumption I'm calling out: "The Four-Layer Model is the architecture"

The Four-Layer Model is a classification scheme for evidence types. It is NOT the architecture. The architecture is the evidence substrate (storage + probes + query). The Four-Layer Model is a vocabulary for labeling evidence records. Don't confuse the map with the territory.

---

## 14. The Migration Path

### What stays
- All observation logic (handshake, schema validation, danger detection, existence checks)
- The crypto layer (descriptors, manifests, provenance, TOFU)
- The enforcement layer (guard, policy, receipts)
- The CLI
- The test suite (326 tests)
- The zero-dependency philosophy

### What changes
- `runHealthcheck()` output is refactored: probes emit evidence records, scorecard is derived
- New `lib/evidence.js` and `lib/evidence-store.js` modules
- `scripts/scan-ecosystem.mjs` writes to evidence store instead of a flat JSON file
- CLI gets `evidence` subcommand for querying the store

### What's new
- Evidence record format and store (the core asset)
- Probe architecture (observation plugins)
- Query API (by subject, by time, by predicate)
- Historical tracking (append-only, never delete)

### Migration sequence

1. Build `lib/evidence.js` (record format) — no existing code changes
2. Build `lib/evidence-store.js` (storage) — no existing code changes
3. Wrap existing probes to emit evidence records — additive, scorecard still works
4. Add `evidence` CLI subcommand — additive
5. Refactor `scan-ecosystem.mjs` to use evidence store — replaces flat JSON output
6. Existing tests still pass; new tests for evidence format and store

**This is additive, not breaking.** The v2 crypto layer and enforcement layer are untouched. The observation layer gets a new output format. The evidence layer is new.

---

## 15. Research Questions (from the prompt, answered)

### Q1: How do we uniquely identify a capability over time?

**Answer:** We don't use a single identifier. We use a **constellation**.

A capability provider has multiple identifiers:
- Registry name (human-readable, can change)
- Repository URL (can be renamed/transferred)
- Package name (can change ownership)
- Publisher key (can rotate)
- Interface digest (changes when the contract evolves)
- Endpoint URL (can migrate)

The system tracks all of them. The identity is the **set of identifiers that have been observed to refer to the same thing**. When one changes, we record the change as an evidence record (`identifier-changed` predicate). The subject persists across the change.

This is how human identity works: your name can change, your address can change, your passport number can change, but you're still you. The government tracks all of them and links them. We do the same for capabilities.

**What trustcard already has:** `serverDigest` (content-addressed binding of serverInfo + protocol + toolsetDigest). This is one identifier in the constellation. The descriptor's `interfaceDigest` is another. The publisher's `keyId` is another. We need to formalize the constellation as a first-class concept.

### Q2: How do we preserve observations over months and years?

**Answer:** Append-only JSONL files with content-addressed records.

Every observation is a record with a hash. Records are never modified or deleted. The store grows monotonically. Historical queries ask "what did we know at time T?" by filtering records by timestamp.

For long-term storage (>1 year), records can be compacted (e.g. "repo was alive every day from Jan to Jun" becomes one record) but the raw observations are never deleted.

For public auditability, the evidence store can be mirrored to a git repo or a content-addressed storage system (IPFS, etc.). The format is portable.

### Q3: What API enables agent consumption?

**Answer:** A capability search + evidence retrieval API.

```
# Agent asks for a capability
GET /capabilities?query=filesystem+search

# System responds with evidence, not scores
{
  "results": [
    {
      "capability": "filesystem.search",
      "providers": [
        {
          "name": "io.github.modelcontextprotocol/server-filesystem",
          "evidence": {
            "records": 47,
            "lastObserved": "2026-07-27T...",
            "layers": {
              "identity": { "records": 5, "lastChange": "2026-06-15T..." },
              "existence": { "records": 30, "latest": "exists" },
              "vitality": { "records": 10, "latest": "active" },
              "behavior": { "records": 2, "latest": "valid" }
            }
          },
          "history": "https://observatory.example/evidence/io.github.modelcontextprotocol/server-filesystem"
        }
      ]
    }
  ]
}
```

The agent gets:
- What capabilities match the query
- Who provides them
- What evidence exists for each provider
- A link to the full evidence history

The agent (or its trust framework) makes the decision. The observatory provides the evidence.

### Q4: What measurements would be valuable to researchers?

**Answer:** The measurements no one else can produce.

1. **Ecosystem health over time** — how many servers are alive, dead, growing, shrinking. No one tracks this continuously.
2. **Publisher concentration dynamics** — is the ecosystem centralizing? Are bulk publishers accelerating?
3. **Capability evolution** — how do tool schemas change over time? What patterns of change are normal vs suspicious?
4. **Failure mode taxonomy** — what fraction fail at handshake vs auth vs schema vs runtime? How does this change over time?
5. **Supply chain mapping** — what packages do MCP servers depend on? Are any dependencies shared across many servers (systemic risk)?
6. **Adoption vs trust correlation** — do stars/downloads correlate with existence verification, maintenance, or behavioral validity? (Circadian's data suggests popularity is NOT a useful filter — top 100 repos hold 89.6% of stars.)
7. **Protocol version adoption** — how fast does the ecosystem adopt new MCP protocol versions?
8. **Anomaly detection** — which publishers behave unlike others? Which servers changed their toolset unexpectedly?

These are publishable, citable findings. They're the output of a scientific instrument, not a product.

### Q5: How do we generalize beyond MCP?

**Answer:** Protocol-neutral core + protocol-specific probes.

The evidence record format is protocol-neutral:
- `subject.kind` = "capability-provider" (not "mcp-server")
- `observer.method` = "mcp-handshake" (protocol-specific)
- `claim.predicate` = "handshake-succeeds" (generic, but the method is specific)

Adding a new protocol means:
1. Write a new probe (e.g. `RestApiProbe` that reads OpenAPI specs and makes HTTP requests)
2. Define protocol-specific predicates (e.g. "openapi-spec-valid")
3. The evidence store, query API, and research pipeline work unchanged

The capability descriptor (from TRUST-SUBSTRATE.md) is already protocol-neutral:
- `interfaceDigest` = hash of the semantic projection (works for any interface definition)
- `implementationIdentity` = typed (npm-dist, source, container, etc.)
- `provenance` = publisher key + signature

The generalization path is:
1. MCP (now) — the reference implementation
2. REST APIs (next) — OpenAPI spec as the interface, HTTP probe
3. Agent-to-agent protocols (future) — whatever the protocol defines as capability advertisement
4. Model providers (future) — model cards as the interface, API probes
5. Distributed compute (future) — resource descriptors as the interface

The evidence substrate doesn't change. The probes do.

---

## 16. Summary: What should exist

### The one-sentence version
An append-only, content-addressed evidence store that records observations about agent capabilities, fed by protocol-specific probes, queryable by subject and time, producing reproducible datasets that enable trust decisions by autonomous agents.

### The three-system view
1. **Observation layer** (exists, needs refactoring): probes that observe capabilities and emit evidence records
2. **Evidence layer** (does not exist, is the core asset): append-only store, query API, historical tracking
3. **Consumption layer** (partially exists): trust reasoning, enforcement, agent query API

### The first thing to build
`lib/evidence.js` — the evidence record format. Everything else builds on this. It's the atom.

### What I disagree with in the current design
1. **The score is too prominent.** The 0-100 scorecard is a consumption-layer derived output that's currently treated as the primary artifact. It should be a view, not the storage format.
2. **Observations are not stored.** The scanner produces output, prints it, and discards it. There is no history. The same server scanned twice produces two independent scorecards with no relationship. This is the biggest gap.
3. **Identity is implicit.** The system identifies servers by their spec string (npm package name or URL). There's no formal identity model that handles renames, transfers, and migrations. The constellation concept needs to be implemented.
4. **The Four-Layer Model is treated as the architecture.** It's a vocabulary, not a system design. The architecture is the evidence substrate.

### What I agree with and want to preserve
1. **The crypto layer is correct.** Descriptors, manifests, provenance, TOFU, Gate 1/Gate 2 — this is well-designed and should be untouched.
2. **The observation logic is sound.** The handshake, schema validation, and danger detection are good probes. They just need to emit evidence records.
3. **The zero-dependency philosophy.** No external services, no databases, no frameworks. JSONL + Node stdlib.
4. **The neutrality principle.** Evidence, not recommendations.
5. **The research loop.** Observe → hypothesize → experiment → publish. This is the right operating model.

---

## 17. Final statement

The agent ecosystem is growing faster than any previous software ecosystem, and it has no trust substrate. Certificate Transparency took years to build after PKI was already broken. npm audit came after supply chain attacks were already common. We have the chance to build the infrastructure before the crisis.

The instrument is not a scanner. It is not a score. It is not a registry. It is an evidence system — the lowest layer of the trust stack, the thing that makes everything above it possible.

Build the telescope before building the observatory website. Build the evidence store before building the trust framework. Build the instrument before building the product.

The first commit should be `lib/evidence.js`.
