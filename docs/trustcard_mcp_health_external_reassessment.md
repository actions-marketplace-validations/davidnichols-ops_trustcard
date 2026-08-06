# Trustcard / MCP Registry — External Evidence Reassessment

**Date:** 2026-07-28
**Status:** Architecture memo — no implementation changes authorized
**Author:** Principal architect (Devin session)
**Predecessors:** `PROPOSAL.md`, `docs/REGISTRY-INTEGRATION.md`, `docs/ANALYSIS.md`,
`docs/PHASE-1-FINDINGS.md`, `docs/PHASE-2-FINDINGS.md`, `docs/PHASE-2.5-EVIDENCE-DESIGN.md`,
`docs/SECURITY-MODEL.md`

---

## 1. Executive Finding

The original `mcp.health` proposal is **too broad and uses the wrong abstraction**. It
collapses at least seven distinct observability layers into a single object with a
scalar score, conflates publisher-declared claims with verifier-observed facts, and
cannot represent the measurement uncertainty that the external evidence has now
proven is real and significant.

The evidence supports a **narrower upstream proposal**: a machine-readable
requirements-and-compatibility field that tells agents what they need to connect,
plus a verification-provenance model that distinguishes DECLARED from OBSERVED from
VERIFIED. The scalar score should be removed from the registry proposal entirely.

The signed-manifest proposal (`PROPOSAL.md` v2) is **orthogonal** to this narrower
field and remains valid — it answers "is what I connected to the thing a known
publisher signed?" rather than "can I connect and what do I need?" The two compose.

**Stop/go decision: GO** — proceed to revise the registry proposal along the lines
described in §16, but do NOT proceed with the original `mcp.health` schema as written.

---

## 2. What the New Evidence Changes

### 2.1 Three independent evidence streams

| Stream | Measurer | What was measured | Population | Finding |
|---|---|---|---|---|
| stdio/installability | trustcard (us) | Can a naive client (`npx -y <pkg>`, no args/env) complete a handshake? | 10 recognizable servers, then 100-server stratified sample | 3/10 couldn't handshake; 68% of 100-server sample can't start without config |
| repository existence | Circadian-agent (external) | Does the declared GitHub repo URL resolve? | 13,698 distinct repos | 2,049 (15.0%) return NOT_FOUND; 40/40 suspect + 40/40 control verified |
| remote endpoint reachability | siliroid (external) | Does the advertised remote URL speak MCP? | 9,403 measured (846 unknown excluded) | 1,154 (12.3%) not speaking MCP at the advertised URL; corrected from 14.4% after two measurement bugs were found |

### 2.2 What each stream proves

Each stream measures a **different layer** and a **different failure mode**:

- **stdio/installability** proves that the package can be launched and can complete
  a protocol handshake without configuration. Failure means: missing env vars,
  missing args, launch crash, handshake timeout.

- **repository existence** proves that the declared source reference still resolves.
  Failure means: deleted repo, renamed repo without redirect, never-existed repo.
  This is a **registry/source integrity** signal, not a runtime signal.

- **remote endpoint reachability** proves that the advertised URL speaks MCP.
  Failure means: dead endpoint, wrong protocol, auth gate, transport mismatch,
  transient outage, or measurement error.

### 2.3 The siliroid correction — the most important lesson

The siliroid measurement was initially reported as 14.4%, then **corrected to 12.3%**
after two measurement bugs were identified:

1. **Response truncation** incorrectly classified valid SSE responses as failures.
2. **Excessive concurrency** induced rate limiting, and 429 handling was incorrect.

The architectural lesson is not "the corrected number is 12.3%." The lesson is:

> **Repeated measurement with the same instrument does not establish truth if the
> instrument has a systematic blind spot.**

The strongest validation came from:
- an **independent measurement method** (different from the original)
- a **control stratum** (known-good endpoints tested alongside suspect ones)
- **explicit UNKNOWN state** (846 endpoints excluded, not counted as failures)
- **reproducible sampling** (two independent seeds, 80/80 control confirmation)
- **correction/retraction** when methodology was shown to be flawed

This lesson applies directly to trustcard's own scanner. Our stdio scan is a single
instrument. If it has a systematic blind spot (e.g., mishandling SSE framing,
misclassifying auth gates as dead endpoints, truncating responses), repeated scans
will produce the same wrong answer with high confidence. **The registry proposal
must not encode single-instrument observations as if they were ground truth.**

### 2.4 Does the evidence change the proposal?

| Question | Answer |
|---|---|
| Does Circadian evidence strengthen the proposal? | **Yes** — it proves registry/source integrity is a distinct, measurable problem at population scale (15% dead repos). This was not in the original `mcp.health` scope. |
| Does siliroid evidence strengthen it? | **Yes** — it proves remote endpoint reachability is a distinct, measurable problem (12.3% not speaking MCP). This was not in the original `mcp.health` scope either. |
| Does the siliroid correction reveal weakness in our methodology? | **Yes** — our stdio scan is a single instrument with the same class of vulnerability to systematic blind spots. We have not independently validated our scanner with a control stratum or a second method. |
| Does the evidence suggest a broader registry architecture? | **Yes** — the three streams measure three orthogonal layers. A single `mcp.health` object cannot represent all three without conflating them. |
| Does the evidence justify `mcp.health` or a narrower concept? | **A narrower concept.** The evidence justifies machine-readable selection-time evidence with explicit provenance, not a generic "health" object with a score. |

---

## 3. Problem Decomposition

The original `mcp.health` proposal collapsed at least twelve distinct concerns.
Here they are separated, with classification:

| # | Concern | Observable? | Who asserts? | Verifier-observed? | Time-dependent? | Environment-dependent? | Inherently uncertain? |
|---|---|---|---|---|---|---|---|
| 1 | Package/installability | Yes (launch test) | Verifier | Yes | Yes (deps change) | Yes (Node version, OS, arch) | Yes (transient failures) |
| 2 | Protocol handshake | Yes (initialize) | Verifier | Yes | Yes (server updates) | Yes (network, config) | Yes (transient) |
| 3 | Auth/configuration requirements | Partially (probe can detect gate) | Publisher (declared) + Verifier (observed) | Partially | Yes | Yes | Yes (auth may be conditional) |
| 4 | Remote endpoint protocol reachability | Yes (HTTP probe) | Verifier | Yes | Yes (uptime) | Yes (network) | Yes (transient outages) |
| 5 | Repository/source existence | Yes (HTTP 200/404) | Verifier | Yes | Yes (repos get deleted) | No | Low (authoritative API) |
| 6 | Registry metadata freshness | Yes (compare versions) | Registry | Yes | Yes (by definition) | No | Low |
| 7 | Transport correctness | Yes (connect test) | Publisher (declared) + Verifier (observed) | Yes | Yes | Yes | Yes (transport may vary by client) |
| 8 | Protocol-version compatibility | Yes (negotiation) | Publisher (declared) + Verifier (observed) | Yes | Yes (protocol evolves) | Yes (client version) | Yes (negotiation may succeed/fail per client) |
| 9 | Tool-schema validity | Yes (JSON Schema validation) | Verifier | Yes | Yes (tools change) | No | Low |
| 10 | Capability/security posture | Partially (static analysis) | Publisher (declared) + Verifier (observed) | Partially | Yes | No | **High** — heuristic, not proof |
| 11 | Runtime behavioral health | No (not at selection time) | Nobody (at selection time) | No | Yes | Yes | **Very high** — requires sandboxed execution |
| 12 | Measurement uncertainty | Yes (meta-observation) | Verifier | Yes | Yes | Yes | **Inherent** — uncertainty about uncertainty |

### Key insight

Concerns 1-9 are **objectively observable at selection time** (with varying degrees
of environment-dependence and transience). Concern 10 is **partially observable**
(heuristic, not proof). Concern 11 is **not observable at selection time** — it
requires sandboxed execution, which is out of scope for registry metadata.
Concern 12 is **meta-level** — it's about the quality of the measurement itself.

The original `mcp.health` proposal did not distinguish these. A scalar score
(86) over all twelve concerns is not a fact about the server — it's a
**lossy compression** of heterogeneous evidence that hides which concerns were
measured, which were inferred, and which were not measured at all.

---

## 4. Evidence-Quality Assessment

### 4.1 trustcard stdio scan

| Dimension | Assessment |
|---|---|
| Instrument | Single (our scanner) |
| Control stratum | **None** — we have not validated against known-good/known-bad sets |
| Independent method | **None** — no second implementation has verified our results |
| UNKNOWN handling | Partial — we have CONFIG_REQUIRED vs FAIL, but don't distinguish PROBE_FAILED from SERVER_FAILED |
| Reproducibility | Good — `node bin/mcp-trustcard.js scan <spec> --json` is deterministic |
| Correction history | None yet — but the siliroid correction shows this is a real risk |
| Sample size | 10 (initial) + 100 (Phase 2) — too small for population claims |

**Verdict:** Our evidence is real but **single-instrument and unvalidated by an
independent method.** The siliroid correction proves this is a meaningful risk.

### 4.2 Circadian repository-existence measurement

| Dimension | Assessment |
|---|---|
| Instrument | GitHub API (authoritative) |
| Control stratum | **Yes** — 40/40 suspect + 40/40 control |
| Independent method | Renames ruled out via anonymous HTTPS probe |
| UNKNOWN handling | **Yes** — PRESENT/ABSENT/UNKNOWN explicitly separated |
| Reproducibility | Yes — dataset published (CC BY 4.0) |
| Correction history | None reported |
| Sample size | 13,698 — population-scale |

**Verdict:** This is the **strongest evidence** of the three streams. Authoritative
source, control stratum, explicit UNKNOWN, reproducible, population-scale.

### 4.3 siliroid remote-endpoint measurement

| Dimension | Assessment |
|---|---|
| Instrument | Custom HTTP/SSE probe |
| Control stratum | **Yes** (added after correction) — 80/80 two-seed control |
| Independent method | Yes (separate from trustcard and Circadian) |
| UNKNOWN handling | **Yes** — 846 endpoints excluded, not counted as failures |
| Reproducibility | Yes — two independent seeds produced 80/80 confirmation |
| Correction history | **Yes** — corrected from 14.4% to 12.3% after two bugs found |
| Sample size | 9,403 — population-scale |

**Verdict:** The correction is actually a **strength** — it demonstrates
methodological integrity. The final result is credible because the correction
process was transparent. However, the initial false confidence (14.4% reported
as fact before the bugs were found) is a cautionary tale for our own work.

### 4.4 Cross-stream independence

The three streams are **genuinely independent**:

- Different measurers (trustcard, Circadian, siliroid)
- Different instruments (stdio launch, GitHub API, HTTP/SSE probe)
- Different layers (installability, source existence, endpoint reachability)
- Different populations (npm packages, GitHub repos, remote URLs)

They overlap only in the **conclusion** that a significant fraction of registry
entries cannot be used as advertised. The specific failure modes are disjoint.
This is strong convergent evidence for the general problem, but **not** for any
single field's specific value.

---

## 5. Measurement Failure Analysis

### 5.1 Failure classes modeled

| Failure class | Can affect trustcard? | Can affect registry metadata? | Distinguishable from server failure? |
|---|---|---|---|
| Truncated responses | Yes (stdio buffer) | No (metadata is static) | **No** — would look like handshake failure |
| SSE framing errors | Yes (HTTP client) | No | **No** — would look like protocol mismatch |
| Rate limiting (429) | Yes (GitHub API) | No | **Partially** — if we log HTTP status |
| DNS failures | Yes (remote scan) | No | **No** — would look like dead endpoint |
| HTTP failures (5xx) | Yes (remote scan) | No | **Partially** — if we log HTTP status |
| Authentication gates | Yes (remote scan) | No | **Partially** — if we detect 401/403 |
| Transport mismatch | Yes (SSE vs streamable-http) | No | **Yes** — if we try both transports |
| Protocol mismatch | Yes (version negotiation) | No | **Yes** — if we log negotiated version |
| Transient outages | Yes (all probes) | No | **No** — single probe can't distinguish |
| Endpoint-specific behavior | Yes | No | **Yes** — if we probe the specific endpoint |
| Host-level behavior | Yes | No | **No** — single probe can't isolate |
| Instrumentation bugs | **Yes** (the siliroid lesson) | No | **No** — the probe doesn't know it's wrong |
| Systematic false negatives | **Yes** | No | **No** — requires independent method |
| Systematic false positives | **Yes** | No | **No** — requires independent method |

### 5.2 The critical gap

trustcard's current evidence architecture **cannot distinguish** these states:

```
SERVER_FAILED          — the server is broken
PROBE_FAILED           — our instrument failed
PROBE_INCONCLUSIVE     — we got a result but can't interpret it
SERVER_REJECTED_REQUEST — the server refused our request (auth, rate limit)
SERVER_REQUIRES_AUTH   — the server needs credentials
SERVER_IS_NOT_MCP      — the endpoint doesn't speak MCP
SERVER_IS_MCP_BUT_WRONG_TRANSPORT — it speaks MCP but not the transport we tried
UNKNOWN                — we don't know
```

Our scanner currently produces `FAIL` for all of these. This is the same blind
spot that produced siliroid's initial 14.4% error.

### 5.3 Architectural implication

The registry proposal must not encode `FAIL` as a binary state. It must encode
the **specific failure class** (or UNKNOWN) and the **method that produced it**.
A `handshake: false` field without a method and failure-class is not evidence —
it's an unsupported assertion.

---

## 6. Current Schema Audit

Auditing every field from the original `mcp.health` proposal:

### 6.1 `schemaVersion: "0.1"`

| Question | Answer |
|---|---|
| What fact does this represent? | The version of the health schema |
| Who asserts it? | Publisher or registry |
| How to verify? | Structural (schema validation) |
| How quickly stale? | Only on schema change |
| Deterministic? | Yes |
| UNKNOWN meaning? | N/A |
| Malicious publisher risk? | Low — schema version is structural |
| Verifier can prove false? | N/A |
| Belongs in registry? | **Yes** — if the field is in the registry at all |
| Selection-critical? | No — informational |

**Classification: KEEP** (if any health field is kept at all)

### 6.2 `protocolVersions: []`

| Question | Answer |
|---|---|
| What fact? | Which MCP protocol versions the server supports |
| Who asserts? | Publisher (declared) |
| How to verify? | Connect and negotiate — but result is client-dependent |
| How quickly stale? | On every server update |
| Deterministic? | No — negotiation depends on client version |
| UNKNOWN meaning? | Publisher didn't declare |
| Malicious publisher risk? | **High** — can claim newer protocol support than real |
| Verifier can prove false? | Yes — if negotiation fails for a claimed version |
| Belongs in registry? | **Yes** — selection-critical (client needs to know if it can talk to this server) |
| Selection-critical? | **Yes** |

**Classification: KEEP as DECLARED, with OBSERVED verification possible**

### 6.3 `requiresAuth: {}`

| Question | Answer |
|---|---|
| What fact? | What authentication the server requires |
| Who asserts? | Publisher (declared) |
| How to verify? | Connect without auth and observe rejection |
| How quickly stale? | On every server update |
| Deterministic? | Partially — auth requirements may be conditional |
| UNKNOWN meaning? | Publisher didn't declare |
| Malicious publisher risk? | **Very high** — can hide required credentials to trap agents |
| Verifier can prove false? | Partially — can detect that auth IS required, but can't prove it ISN'T |
| Belongs in registry? | **Yes** — selection-critical (agent needs to know if it has the right credentials) |
| Selection-critical? | **Yes** |

**Classification: KEEP — this is the most selection-critical field. Must be DECLARED with OBSERVED verification.**

### 6.4 `requiresArgs: []`

| Question | Answer |
|---|---|
| What fact? | What command-line arguments or env vars the server needs |
| Who asserts? | Publisher (declared) |
| How to verify? | Launch without args and observe failure mode |
| How quickly stale? | On every server update |
| Deterministic? | Mostly — args are usually stable |
| UNKNOWN meaning? | Publisher didn't declare |
| Malicious publisher risk? | Moderate — can omit required args |
| Verifier can prove false? | Yes — if launch fails without declared args |
| Belongs in registry? | **Yes** — selection-critical (agent needs to know how to launch) |
| Selection-critical? | **Yes** |

**Classification: KEEP — second most selection-critical field. DECLARED with OBSERVED verification.**

### 6.5 `transport: []`

| Question | Answer |
|---|---|
| What fact? | What transports the server supports (stdio, sse, streamable-http) |
| Who asserts? | Publisher (declared) |
| How to verify? | Connect via each declared transport |
| How quickly stale? | On every server update |
| Deterministic? | Yes |
| UNKNOWN meaning? | Publisher didn't declare |
| Malicious publisher risk? | Low — transport is structural |
| Verifier can prove false? | Yes — if connection fails on declared transport |
| Belongs in registry? | **Yes** — selection-critical (client needs to know how to connect) |
| Selection-critical? | **Yes** |

**Classification: KEEP — already in the registry schema (transport is part of `server.json`). May not need a new field.**

### 6.6 `destructiveTools: "declared"`

| Question | Answer |
|---|---|
| What fact? | Whether the server has tools with destructive capabilities |
| Who asserts? | Publisher (declared) or verifier (observed) |
| How to verify? | Static analysis of tool definitions (heuristic, not proof) |
| How quickly stale? | On every toolset change |
| Deterministic? | **No** — heuristic, not proof |
| UNKNOWN meaning? | Not analyzed |
| Malicious publisher risk? | **Very high** — can omit destructive tools from declaration |
| Verifier can prove false? | **No** — can detect presence, cannot prove absence |
| Belongs in registry? | **No** — this is Trustcard-only evidence, not registry metadata |
| Selection-critical? | Informational, not selection-critical |

**Classification: MOVE OUT OF REGISTRY** — this is verifier-observed heuristic evidence. It belongs in Trustcard's evidence store, not in registry metadata. A publisher-declared version is gameable; a verifier-observed version is heuristic and stale-prone.

### 6.7 `secretsInToolOutput: false`

| Question | Answer |
|---|---|
| What fact? | Whether tool outputs contain secrets |
| Who asserts? | Nobody (requires runtime execution) |
| How to verify? | Call tools and inspect outputs — requires sandboxed execution |
| How quickly stale? | On every call |
| Deterministic? | **No** — depends on inputs and state |
| UNKNOWN meaning? | Not tested |
| Malicious publisher risk? | N/A — publisher can't meaningfully assert this |
| Verifier can prove false? | **No** — can detect presence, cannot prove absence |
| Belongs in registry? | **No** — not observable at selection time |
| Selection-critical? | No |

**Classification: REMOVE from registry proposal. This is runtime behavioral health (concern #11), not selectable at registry time.**

### 6.8 `latency: {}`

| Question | Answer |
|---|---|
| What fact? | Response time for tool calls |
| Who asserts? | Verifier (observed) |
| How to verify? | Measure — but result is environment-dependent |
| How quickly stale? | **Very fast** — seconds to minutes |
| Deterministic? | **No** — depends on network, load, time of day |
| UNKNOWN meaning? | Not measured |
| Malicious publisher risk? | Low — but publisher could optimize for the probe |
| Verifier can prove false? | No — it was true at the time of measurement |
| Belongs in registry? | **No** — too transient, too environment-dependent |
| Selection-critical? | No — informational at best |

**Classification: REMOVE from registry proposal. Latency is a runtime observation that becomes stale immediately. It belongs in Trustcard evidence, not registry metadata.**

### 6.9 `failureRate: 0.01`

| Question | Answer |
|---|---|
| What fact? | Fraction of calls that fail |
| Who asserts? | Verifier (observed) |
| How to verify? | Make many calls — but result is environment and input dependent |
| How quickly stale? | Fast |
| Deterministic? | **No** |
| UNKNOWN meaning? | Not measured |
| Malicious publisher risk? | Low — but publisher could make the probe path reliable |
| Verifier can prove false? | No |
| Belongs in registry? | **No** — requires sustained observation, not selection-time metadata |
| Selection-critical? | No |

**Classification: REMOVE from registry proposal. Same as latency — too transient, too environment-dependent.**

### 6.10 `lastVerified: "..."`

| Question | Answer |
|---|---|
| What fact? | When the server was last verified |
| Who asserts? | Verifier |
| How to verify? | Timestamp is self-certifying (trust the verifier) |
| How quickly stale? | Immediately — the moment it's written, it starts aging |
| Deterministic? | Yes |
| UNKNOWN meaning? | Never verified |
| Malicious publisher risk? | Low — publisher doesn't control this |
| Verifier can prove false? | N/A — it's a fact about the verifier's action |
| Belongs in registry? | **Yes** — but only as part of a provenance record, not a standalone field |
| Selection-critical? | Yes — stale verification is a warning signal |

**Classification: MODIFY — keep the concept, but move it into a provenance object that includes method, verifier identity, and scope.**

### 6.11 `verifiedBy: "..."`

| Question | Answer |
|---|---|
| What fact? | Who verified the server |
| Who asserts? | Verifier (self-attested) |
| How to verify? | Check the verifier's published methodology |
| How quickly stale? | On verifier methodology change |
| Deterministic? | Yes |
| UNKNOWN meaning? | Not verified |
| Malicious publisher risk? | Low — publisher doesn't control this |
| Verifier can prove false? | N/A |
| Belongs in registry? | **Yes** — but insufficient alone. Needs method, scope, environment. |
| Selection-critical? | Yes — who verified matters as much as what they found |

**Classification: MODIFY — expand into a provenance object (see §8).**

### 6.12 `score: 86`

| Question | Answer |
|---|---|
| What fact? | A scalar summary of health |
| Who asserts? | Verifier |
| How to verify? | **Cannot** — the aggregation function is opaque |
| How quickly stale? | Immediately |
| Deterministic? | **No** — depends on which checks were run, in what environment |
| UNKNOWN meaning? | Undefined — is it 0? Is it absent? |
| Malicious publisher risk? | **High** — if publisher can influence inputs, they can game the score |
| Verifier can prove false? | **No** — it's an opinion, not a fact |
| Belongs in registry? | **No** |
| Selection-critical? | **Misleadingly so** — clients will use it as a universal ranking |

**Classification: REMOVE. See §9 for full analysis.**

### 6.13 Audit summary

| Field | Classification | Rationale |
|---|---|---|
| `schemaVersion` | KEEP | Structural, necessary |
| `protocolVersions` | KEEP (DECLARED + OBSERVED) | Selection-critical, verifiable |
| `requiresAuth` | KEEP (DECLARED + OBSERVED) | Most selection-critical, verifiable |
| `requiresArgs` | KEEP (DECLARED + OBSERVED) | Selection-critical, verifiable |
| `transport` | KEEP (already in registry) | Selection-critical, already exists |
| `destructiveTools` | MOVE OUT OF REGISTRY | Heuristic, gameable, Trustcard evidence |
| `secretsInToolOutput` | REMOVE | Not observable at selection time |
| `latency` | REMOVE | Too transient, environment-dependent |
| `failureRate` | REMOVE | Too transient, environment-dependent |
| `lastVerified` | MODIFY → provenance object | Keep concept, expand |
| `verifiedBy` | MODIFY → provenance object | Keep concept, expand |
| `score` | REMOVE | See §9 |

---

## 7. Health-vs-Evidence Architecture Decision

### 7.1 The question

> Is the valuable primitive "health", or is it machine-readable selection-time evidence?

### 7.2 Analysis

"Health" implies a **state** — the server is healthy or it isn't. This is wrong
for several reasons:

1. **Health is multi-dimensional.** A server can have a working handshake but a
   dead repo. A server can have a live endpoint but require auth the agent doesn't
   have. A server can pass all checks today and fail tomorrow. There is no single
   "healthy" state.

2. **Health is environment-dependent.** The same server may handshake successfully
   on one machine and fail on another (different Node version, different network,
   different credentials). A health field that doesn't specify the environment is
   a false universal.

3. **Health is time-dependent.** Any observation has a timestamp. Without it, the
   observation is meaningless. "Healthy" with no timestamp is not a fact.

4. **Health conflates declared and observed.** The publisher declares
   `requiresAuth`; the verifier observes whether auth is actually required. These
   are different facts from different sources with different trust properties.
   Collapsing them into one field destroys the distinction.

5. **Health implies a judgment.** "Score: 86" is a judgment. Evidence is a fact:
   "handshake succeeded at T with method M in environment E." Judgments are
   consumption-layer; facts are registry-layer.

### 7.3 Decision

**"Health" is the wrong abstraction.** The valuable primitive is
**machine-readable selection-time evidence with explicit provenance.**

The registry should expose:

1. **Publisher-declared requirements** (what the publisher says you need to connect)
2. **Verifier-observed compatibility** (what an independent verifier found when it tried)
3. **Verification provenance** (who measured, how, when, in what environment)

These are three distinct concepts with distinct trust properties. They should not
be collapsed into a single `mcp.health` object.

### 7.4 Relationship to the signed-manifest proposal

The signed-manifest proposal (`PROPOSAL.md` v2) answers a different question:
"Is what I connected to the thing a known publisher signed?" This is about
**identity and provenance**, not about **requirements and compatibility**.

The two compose:
- Requirements/compatibility field: "Can I connect and what do I need?"
- Signed manifest: "Is what I connected to the thing a known publisher signed?"

Neither subsumes the other. Both are needed. Both are orthogonal to "health."

---

## 8. Verification/Provenance Model

### 8.1 The claim ladder

Trustcard should inherit VisionConform's scientific-integrity discipline:

> A plausible observation must not silently become a stronger claim than the
> evidence supports.

The claim ladder for MCP registry metadata:

```
DECLARED       — publisher says X (in server.json)
OBSERVED       — a verifier observed X at time T (single observation)
VERIFIED       — an independent verifier reproduced X (independent method)
STALE          — the observation was VERIFIED but is now old (consumer-defined threshold)
CONTRADICTED   — a later observation disagrees with an earlier one
UNKNOWN        — no observation was made (distinct from "observed false")
```

### 8.2 What the registry is permitted to communicate in each state

| State | Registry may say | Registry may NOT say |
|---|---|---|
| DECLARED | "Publisher declares X" | "X is true" |
| OBSERVED | "Verifier observed X at T" | "X is always true" |
| VERIFIED | "Independent verifiers agree on X as of T" | "X will remain true" |
| STALE | "Last verification was at T (N days ago)" | "X is still true" |
| CONTRADICTED | "Observations disagree: A at T1, B at T2" | "X is true" or "X is false" |
| UNKNOWN | "No verification has been performed" | "X is false" or "X is true" |

### 8.3 Provenance object

A single `verifiedBy: "mcp-trustcard@0.1.0"` string is **insufficient**. It
doesn't tell the consumer what method was used, what environment, what scope,
or what the limitations are.

The provenance model should include:

```json
{
  "verifier": {
    "identity": "mcp-trustcard",
    "version": "3.0.0",
    "method": "stdio-launch-and-handshake",
    "methodVersion": "1.0.0"
  },
  "observation": {
    "timestamp": "2026-07-28T14:32:00Z",
    "environment": "linux-x64-ci",
    "scope": ["handshake", "installability", "protocol-version"],
    "result": "PASS",
    "failureClass": null,
    "confidence": 0.95
  },
  "evidence": {
    "recordId": "ev_sha256:...",
    "reproducibilityCommand": "npx -y <pkg> && ..."
  }
}
```

### 8.4 Is this too complex for the registry?

**Yes, if it's in the registry schema.** The full provenance object belongs in
**Trustcard's evidence store** (as defined in `PHASE-2.5-EVIDENCE-DESIGN.md`),
not in the registry.

The registry should carry only:
- A **pointer** to where evidence can be found (a URL or a verifier identity)
- A **summary** of the verification state (VERIFIED / OBSERVED / UNKNOWN / STALE)
- A **timestamp** of the last verification

The full evidence record (method, environment, payload, reproducibility command)
lives in the verifier's evidence store and is fetchable by interested parties.

### 8.5 Multiple verifiers

The model must support **multiple independent verifiers**. Different verifiers
may use different methods, reach different conclusions, or verify different
scopes. The registry should not pick a winner — it should expose all
verification summaries and let the consumer decide.

This is directly motivated by the siliroid correction: if only one verifier
exists and it has a systematic blind spot, the registry encodes a wrong answer
as fact. Multiple independent verifiers with different methods are the
mitigation.

---

## 9. Score Assessment

### 9.1 The case against `score: 86`

| Problem | Explanation |
|---|---|
| Hides incompatible dimensions | A server can score 86 with a working handshake but dead repo, or 86 with a live repo but broken handshake. The score doesn't tell you which. |
| Environment-dependent | The same server may score differently on different machines. A score without an environment is a false universal. |
| Becomes stale too quickly | Any runtime observation (handshake, latency) can change between measurement and use. A score doesn't tell you how old it is. |
| Clients will misuse it as universal ranking | Agents will sort by score and pick the top. This is a misuse — the score is one observation, not a recommendation. |
| Encourages gaming | Publishers can optimize for the probe (fast handshake, no auth gate) while being unreliable in production. |
| Creates false precision | "86" implies a precision that the underlying measurements don't have. Our scanner has 8 checks with varying reliability. Aggregating them into a number suggests we know more than we do. |
| Aggregation function is opaque | What does 86 mean? Which checks passed? Which failed? Which weren't run? The score doesn't say. |

### 9.2 Information value comparison

```
score: 86
```

vs.

```
protocol: verified (independent, 2026-07-28)
requirements: declared (requiresAuth: oauth, requiresArgs: GITHUB_TOKEN)
repository: reachable (Circadian, 2026-07-27)
endpoint: reachable (siliroid, 2026-07-27)
handshake: observed-pass (trustcard, 2026-07-28, linux-x64)
lastVerified: 2026-07-28
```

The multi-dimensional view is **strictly more informative**. It tells the agent
what was measured, by whom, when, and what the result was. The score tells the
agent nothing actionable.

### 9.3 Decision

**Remove `score` from the registry proposal.** The score may remain as a
Trustcard-internal convenience (the scanner's scorecard), but it should not be
standardized in registry metadata. The registry should expose structured
verification results, not a scalar.

---

## 10. Threat Model

### 10.1 Malicious publisher

| Attack | Mitigation in registry proposal |
|---|---|
| Inflate health | Remove score; use DECLARED vs OBSERVED distinction |
| Hide required credentials | `requiresAuth` is DECLARED; verifier OBSERVES auth gates; contradiction is visible |
| Omit destructive tools | Remove `destructiveTools` from registry; this is Trustcard evidence, not registry metadata |
| Claim newer protocol support | `protocolVersions` is DECLARED; verifier OBSERVES negotiation result; contradiction is visible |
| Report artificially low failure rates | Remove `failureRate` from registry; not observable at selection time |
| Publish stale positive verification | `lastVerified` timestamp + STALE state; consumer defines freshness threshold |
| Manipulate score | Remove score |
| Selectively expose healthy endpoints | Registry metadata describes the registry entry, not a specific endpoint; if the server serves different tools to different clients, only signed manifests catch this |
| Exploit verifier blind spots | Multiple independent verifiers with different methods; the siliroid correction proves this is necessary |

### 10.2 Imperfect verifier

| Failure mode | Mitigation |
|---|---|
| Misclassify a valid server | OBSERVED (not VERIFIED) state; multiple verifiers; control stratum |
| Overload infrastructure | Rate limiting; the siliroid correction shows this produces false results |
| Induce rate limiting | Same as above |
| Fail to support a transport | Transport is DECLARED; verifier notes which transport it tested |
| Interpret auth gate as dead | Failure class taxonomy (SERVER_REQUIRES_AUTH vs SERVER_FAILED) |
| Mistake stale deployment for repo failure | These are different layers; existence check (GitHub API) is independent of runtime check |
| Generate false negative via instrumentation bug | The siliroid lesson: independent method + control stratum + correction/retraction |
| Generate false positive via instrumentation bug | Same |

### 10.3 Trust model principle

The conceptual trust model must account for **both** malicious publishers and
imperfect verifiers. Neither is trusted by default. The registry is a
**distribution point, not a trust root** (this is already in the PROPOSAL.md v2
framing). Trust is established by:

1. Publisher declarations (claims, not facts)
2. Verifier observations (facts, but method-limited)
3. Independent reproduction (stronger facts)
4. Contradiction detection (when declarations and observations disagree)
5. Freshness (when was the last verification?)

---

## 11. Registry Governance Model

### 11.1 Who writes what

| Metadata category | Who writes it | Why |
|---|---|---|
| Publisher-declared requirements | **Publisher** | Only the publisher knows what their server needs |
| Verifier-observed compatibility | **Independent verifier(s)** | The verifier tests empirically; the publisher cannot self-attest this |
| Verification provenance | **The verifier that made the observation** | Provenance is self-certifying (the verifier signs/attests its own methodology) |
| Registry metadata freshness | **Registry** | Only the registry knows when an entry was last updated |
| Contradiction flags | **Registry or any verifier** | Anyone can observe that DECLARED and OBSERVED disagree |

### 11.2 Should health be publisher-declared?

**No.** A publisher-declared "health" is a claim the server makes about itself.
It is gameable and unverifiable without an independent probe. The only
publisher-declared fields that belong in the registry are **requirements**
(what do I need to connect?) — because only the publisher knows this, and
because a false declaration can be caught by a verifier.

### 11.3 Should health be registry-computed?

**No.** The registry is a distribution point, not a trust root. Computing a
health score in the registry makes the registry the trust authority, which
creates a single point of failure and a single point of capture. The registry
should carry pointers to verifier results, not compute its own.

### 11.4 Should health be verifier-attested?

**Yes — but as evidence, not as "health."** Verifiers attest to specific
observations (handshake succeeded, auth required, repo exists). These are
evidence records, not health judgments. Multiple verifiers can attest
independently, and the consumer reconciles.

### 11.5 Should health be periodically refreshed?

**Yes — observations must be timestamped and refreshable.** But "periodically"
is a consumer policy, not a registry policy. The registry carries the timestamp;
the consumer decides what's stale.

### 11.6 Should health be multi-source?

**Yes.** This is the direct lesson from the siliroid correction. A single
verifier with a systematic blind spot produces wrong answers with high
confidence. Multiple independent verifiers with different methods are the
mitigation.

### 11.7 Should evidence be immutable snapshots?

**Yes.** This is already designed in `PHASE-2.5-EVIDENCE-DESIGN.md` — evidence
records are immutable, corrections are new records with `supersedes` links.
The registry should reference evidence snapshots, not mutable state.

### 11.8 Should evidence be derived dynamically?

**No — not in the registry.** Dynamic derivation requires the registry to run
probes, which makes it a verifier. The registry should carry pointers to
verifier-produced evidence. Dynamic derivation can happen client-side (the
agent fetches evidence from multiple verifiers and reconciles).

---

## 12. Minimum Viable Upstream Proposal

### 12.1 MVP candidate

The smallest field set that provides substantial selection-time value:

```jsonc
{
  "_meta": {
    "io.modelcontextprotocol.registry/publisher-provided": {
      "mcp.requirements": {
        "schemaVersion": "0.1",
        "protocolVersions": ["2025-06-18"],
        "requiresAuth": {
          "type": "oauth" | "api-key" | "none" | "unknown",
          "description": "GitHub Personal Access Token via GITHUB_TOKEN env var"
        },
        "requiresArgs": ["--repo-path", "${env:GITHUB_TOKEN}"],
        "transport": ["stdio"]
      }
    }
  }
}
```

**Why this is the MVP:**

1. **All fields are publisher-declared.** This is the cheapest possible registry
   addition — no verifier infrastructure needed, no runtime probing, no
   evidence storage. The publisher fills it in when they publish.

2. **All fields are selection-critical.** An agent needs to know: can I speak
   this protocol version? Do I have the right auth? Do I have the right args?
   What transport do I use?

3. **All fields are verifiable.** A verifier can independently check each
   declaration: try the protocol version, try without auth, try without args,
   try the transport. Contradictions are detectable.

4. **No score.** No scalar that hides incompatible dimensions.

5. **No runtime observations.** No latency, no failure rate, no behavioral
   health. These are too transient and too environment-dependent for registry
   metadata.

6. **Uses the approved `_meta` key.** The official registry only preserves
   `io.modelcontextprotocol.registry/publisher-provided`. The proposal must
   use this key, not a custom reverse-DNS key.

**What this prevents:** The 68% of servers that can't start without config
would at least declare what config they need. An agent can filter at selection
time: "show me servers where I have the required auth and args."

### 12.2 Deferred candidate

Useful information that belongs in a future extension:

```jsonc
{
  "mcp.verification": {
    "schemaVersion": "0.1",
    "verifications": [
      {
        "verifier": "mcp-trustcard",
        "version": "3.0.0",
        "method": "stdio-launch-and-handshake",
        "timestamp": "2026-07-28T14:32:00Z",
        "scope": ["handshake", "installability", "protocol-version"],
        "result": "PASS",
        "failureClass": null,
        "evidenceUrl": "https://trustcard.dev/evidence/ev_sha256:..."
      }
    ]
  }
}
```

**Why this is deferred:**

1. It requires verifier infrastructure (probes, evidence stores, publication).
2. It requires governance (who is allowed to be a verifier? how are results
   reconciled?).
3. It requires the registry to carry verification results, which is a bigger
   change than carrying publisher declarations.
4. The MVP (publisher-declared requirements) already provides most of the
   selection-time value without any of this complexity.

### 12.3 Trustcard-only candidate

Information that should remain in Trustcard evidence, not in registry metadata:

- `destructiveTools` — heuristic, gameable, stale-prone
- `secretsInToolOutput` — not observable at selection time
- `latency` — too transient
- `failureRate` — too transient
- `score` — see §9
- Full evidence records (method, environment, payload, reproducibility)
- Danger detector results (3-engine fusion analysis)
- Signed manifest verification results
- Trust state (UNKNOWN → OBSERVED → PINNED → MISMATCH → REVOKED)
- Gate 2 invocation policy

**Why:** These are either (a) not observable at selection time, (b) too
transient for registry metadata, (c) heuristic rather than factual, or (d)
consumption-layer decisions that are per-agent, not per-server.

### 12.4 Explicitly rejected candidate

Fields that should not be standardized:

- `score` — false precision, gameable, hides incompatible dimensions
- `health` as a single concept — wrong abstraction (see §7)
- `secretsInToolOutput` — not observable at selection time
- `latency` — too transient for registry metadata
- `failureRate` — too transient for registry metadata
- Any field that conflates DECLARED and OBSERVED — destroys the trust model
- Any field that requires Trustcard to function — Trustcard is a reference
  verifier, not a prerequisite

---

## 13. Deferred Fields

Fields that are useful but should not be in the initial proposal:

| Field | Why deferred | When to revisit |
|---|---|---|
| Verification summaries | Requires verifier infrastructure | After MVP is adopted and verifiers exist |
| Repository existence status | Circadian already measures this; registry could carry it | After registry governance for verifier-attested fields is established |
| Endpoint reachability status | siliroid already measures this; registry could carry it | Same as above |
| Tool-schema validity | Requires runtime probing | After verification infrastructure exists |
| Protocol-version compatibility (observed) | Requires runtime probing | Same |
| Multi-verifier reconciliation | Requires multiple verifiers | When 2+ independent verifiers exist |

---

## 14. Trustcard-Only Fields

These remain in Trustcard's evidence store and are NOT proposed for the registry:

| Field | Why Trustcard-only |
|---|---|
| Evidence records (full) | Too detailed for registry metadata; fetchable on demand |
| Danger detector results | Heuristic, not factual; gameable if in registry |
| Signed manifest verification | Part of the manifest proposal, not the requirements proposal |
| Trust state machine | Per-agent consumption-layer state |
| Gate 2 policy | Per-relying-party authorization |
| Receipts | Per-call evidence |
| Score (internal scorecard) | Trustcard convenience; not for standardization |
| Latency / failure rate | Runtime observations, too transient |

---

## 15. Explicitly Rejected Fields

| Field | Why rejected |
|---|---|
| `score` (scalar) | False precision, hides incompatible dimensions, gameable, environment-dependent |
| `health` (single object) | Wrong abstraction — collapses orthogonal concerns |
| `secretsInToolOutput` | Not observable at selection time |
| `latency` | Too transient for registry metadata |
| `failureRate` | Too transient for registry metadata |
| `destructiveTools` in registry | Heuristic, gameable by omission, Trustcard evidence |
| Any field requiring Trustcard | Trustcard is a reference verifier, not a prerequisite |
| Any field conflating DECLARED/OBSERVED | Destroys the trust model |

---

## 16. Revised Proposal Text

### 16.1 Title

**Proposal: machine-readable connection requirements for MCP registry entries**

### 16.2 Problem

Agents selecting MCP servers from the registry have no machine-readable way to
determine what they need to connect. Three independent measurement streams
confirm the scale of this problem:

- **stdio/installability:** 68% of 100 sampled servers cannot be started by a
  naive client without configuration (trustcard, 2026-07-27).
- **repository existence:** 15.0% of 13,698 declared GitHub repositories return
  NOT_FOUND (Circadian-agent, 2026-07-27, 40/40 control-verified).
- **remote endpoint reachability:** 12.3% of 9,403 measured remote endpoints do
  not speak MCP at the advertised URL (siliroid, 2026-07-27, corrected from
  14.4% after two measurement bugs, 80/80 two-seed control-verified).

The common thread: agents waste time attempting connections that cannot succeed
because the requirements (auth, args, transport, protocol version) are not
declared in a machine-readable form.

### 16.3 Proposal

An optional `mcp.requirements` field under the registry's existing
`_meta["io.modelcontextprotocol.registry/publisher-provided"]` key:

```jsonc
{
  "_meta": {
    "io.modelcontextprotocol.registry/publisher-provided": {
      "mcp.requirements": {
        "schemaVersion": "0.1",
        "protocolVersions": ["2025-06-18"],
        "requiresAuth": {
          "type": "oauth" | "api-key" | "none" | "unknown",
          "description": "Human-readable description of required credentials"
        },
        "requiresArgs": ["--repo-path", "${env:GITHUB_TOKEN}"],
        "transport": ["stdio"]
      }
    }
  }
}
```

### 16.4 Design principles

1. **Publisher-declared, not verifier-computed.** Only the publisher knows what
   their server needs. The registry carries the declaration; verifiers can
   independently check it.

2. **All fields are selection-critical.** An agent can filter at selection time:
   "show me servers where I have the required auth and args and transport."

3. **All fields are verifiable.** A verifier can independently check each
   declaration and publish contradictions.

4. **No score.** No scalar that hides incompatible dimensions or creates false
   precision.

5. **No runtime observations.** Latency, failure rate, and behavioral health
   are too transient and too environment-dependent for registry metadata.

6. **Uses the approved `_meta` key.** Conforms to the registry's existing
   publisher-provided metadata rules.

7. **Independent of any specific verifier.** Trustcard can be a reference
   verifier, but the field format does not require Trustcard.

### 16.5 What this does NOT include

- No health score
- No latency or failure rate
- No destructive-tool declarations
- No runtime behavioral observations
- No verification results (these are a future extension)
- No dependency on Trustcard or any specific verifier

### 16.6 Future extension: verification summaries

Once verifier infrastructure exists, a future proposal could add:

```jsonc
{
  "mcp.verification": {
    "verifications": [
      {
        "verifier": "<verifier-identity>",
        "method": "<method-name>",
        "timestamp": "<ISO-8601>",
        "scope": ["handshake", "installability"],
        "result": "PASS" | "FAIL" | "INCONCLUSIVE",
        "failureClass": "<class-or-null>",
        "evidenceUrl": "<url-to-full-evidence>"
      }
    ]
  }
}
```

This is explicitly **not part of the initial proposal**. It requires:
- Verifier governance (who is allowed to be a verifier?)
- Evidence publication infrastructure
- Multi-verifier reconciliation rules
- Registry support for verifier-attested fields

### 16.7 Relationship to the signed-manifest proposal

This proposal is **orthogonal** to the signed-manifest proposal
(`io.github.davidnichols-ops/trustcard` `_meta` extension). The requirements
field answers "can I connect and what do I need?" The signed manifest answers
"is what I connected to the thing a known publisher signed?" Both compose.

---

## 17. Collaboration Opportunities

### 17.1 The three streams as collaborators

| Stream | What they measure | What we measure | Overlap | Independence |
|---|---|---|---|---|
| trustcard (us) | stdio installability + handshake | Same | — | — |
| Circadian | Repository existence (GitHub API) | We also measure this (Phase 2), but Circadian has population scale | Both measure repo resolution | Independent instruments (both use GitHub API, but different implementations) |
| siliroid | Remote endpoint reachability (HTTP/SSE probe) | We also measure this (Phase 2 HTTP client), but siliroid has population scale | Both measure endpoint response | Independent instruments (different HTTP clients, different concurrency) |

### 17.2 What can legitimately be combined

- **Convergent conclusion:** All three streams agree that a significant fraction
  of registry entries cannot be used as advertised. This is strong evidence for
  the problem.
- **Complementary coverage:** stdio (39% of ecosystem), remote (55% of
  ecosystem), repo existence (81.5% have repo URLs). Together they cover most
  of the registry.
- **Methodological cross-validation:** Circadian's control-stratum methodology
  and siliroid's correction process are both models we should adopt for our own
  scanner.

### 17.3 What cannot be combined

- **Population-level conclusions across streams.** Each stream measures a
  different layer on a different population with a different denominator. "X%
  of servers are unhealthy" is not a valid aggregation — the layers are
  orthogonal.
- **Merged datasets without methodological alignment.** The three streams use
  different instruments, different sampling, and different UNKNOWN handling.
  Merging raw data would produce meaningless aggregates.

### 17.4 Preserving corrected measurements

The siliroid correction (14.4% → 12.3%) should be preserved as **methodological
evidence**, not silently replaced. The correction process itself is evidence
that:
1. Single-instrument measurements can have systematic blind spots
2. Transparency about corrections strengthens credibility
3. The final number is more trustworthy because the correction was made

This maps directly to Trustcard's evidence model (`PHASE-2.5-EVIDENCE-DESIGN.md`
§3.3): corrections are new records with `supersedes` links, not deletions.

### 17.5 Concrete collaboration actions

1. **Adopt Circadian's control-stratum methodology** for our own scanner. Before
   publishing population-level claims, run 40/40 suspect + 40/40 control.
2. **Adopt siliroid's correction transparency.** If we find a measurement bug,
   publish the correction with the bug description, not just the new number.
3. **Share evidence records.** If Circadian and siliroid adopt a compatible
   evidence format (or we adopt theirs), evidence can be cross-referenced
   without merging raw data.
4. **Do not merge datasets.** Each stream maintains its own methodology and
   denominator. Cross-references are by subject identity (registry name, repo
   URL), not by row merge.

---

## 18. Remaining Uncertainties

| Uncertainty | Impact | Resolution path |
|---|---|---|
| Registry `_meta` key restriction | **Critical** — the official registry only preserves `io.modelcontextprotocol.registry/publisher-provided`. Our signed-manifest proposal uses `io.github.davidnichols-ops/trustcard`, which would be silently dropped. | Verify with registry maintainers. The requirements field uses the approved key; the manifest proposal needs a different approach (possibly under `publisher-provided`, or a schema change). |
| Whether publishers will honestly declare requirements | Medium — a malicious publisher can hide required credentials. | The DECLARED vs OBSERVED distinction makes this detectable, not preventable. Verifiers catch contradictions. |
| Whether verifiers will adopt the evidence format | Low for MVP (MVP is publisher-declared only). Higher for the deferred verification extension. | The MVP doesn't require verifiers. The extension can be proposed after the MVP is adopted. |
| Whether the registry will accept verifier-attested fields | Medium — this is a governance question, not a technical one. | Defer to registry maintainers. The MVP doesn't require this. |
| Whether our scanner has systematic blind spots | **High** — the siliroid correction proves this is a real risk. | Adopt control-stratum methodology. Run independent validation. Publish correction history. |
| Whether the pipeworx-io anomaly (1,270 servers) affects population statistics | Medium — 9.9% of the registry from one publisher could skew any population-level claim. | Investigate separately. Do not publish population-level claims without addressing this. |
| Whether "requirements" is the right name | Low — naming is bikesheddable. | Defer to registry maintainers. |

---

## 19. Implementation Stop/Go Decision

### 19.1 Stop conditions check

| Stop condition | Status |
|---|---|
| Proposed fields cannot be independently verified | **CLEAR** — all MVP fields (protocolVersions, requiresAuth, requiresArgs, transport) are verifiable by connecting to the server |
| "Health" conflates multiple incompatible concepts | **CLEAR** — we removed "health" as the abstraction and replaced it with "requirements" (publisher-declared) + "verification" (verifier-observed, deferred) |
| Score semantics remain undefined | **CLEAR** — score is removed from the proposal |
| UNKNOWN is conflated with failure | **CLEAR** — the claim ladder explicitly separates UNKNOWN from observed-false |
| Verification freshness is undefined | **CLEAR** — `lastVerified` timestamp + consumer-defined staleness threshold; the MVP is publisher-declared only, so this applies to the deferred extension |
| Verifier methodology cannot represent its own uncertainty | **CLEAR** — the provenance model includes method, environment, scope, confidence, and failure class; the full evidence record (PHASE-2.5) includes reproducibility command |
| The registry proposal requires Trustcard to function | **CLEAR** — the MVP is publisher-declared only; Trustcard is a reference verifier, not a prerequisite |
| Evidence cannot distinguish publisher claims from empirical observations | **CLEAR** — the DECLARED/OBSERVED/VERIFIED/STALE/CONTRADICTED/UNKNOWN claim ladder makes this distinction explicit |

### 19.2 Decision

**GO.** All stop conditions are clear. Proceed to revise the registry proposal
along the lines described in §16.

### 19.3 What to do next

1. **Revise `registry-issue.md`** to replace the `mcp.health` proposal with the
   `mcp.requirements` proposal (§16). Do NOT file until reviewed.
2. **Address the `_meta` key restriction.** The signed-manifest proposal uses
   `io.github.davidnichols-ops/trustcard`, which the registry will silently drop.
   Either move it under `io.modelcontextprotocol.registry/publisher-provided`
   or propose a schema change. This is a **blocking issue** for the manifest
   proposal, not for the requirements proposal.
3. **Adopt control-stratum methodology** for our own scanner before publishing
   any further population-level claims. The siliroid correction proves this is
   necessary.
4. **Do NOT implement the deferred verification extension** until the MVP is
   adopted and verifier governance is established.
5. **Do NOT remove the score from the scanner.** The score is useful internally
   as a convenience. It should not be in the registry proposal, but it can
   remain in the CLI output.

### 19.4 What NOT to do

- Do not add new Trustcard features
- Do not implement the evidence store (`lib/evidence.js`) yet — the design in
  PHASE-2.5 is sound, but implementation should wait until the revised proposal
  is reviewed
- Do not file the revised proposal until the `_meta` key issue is resolved
- Do not merge datasets with Circadian or siliroid
- Do not publish population-level claims without control-stratum validation
- Do not use the VisionConform name in the MCP proposal — this is architecture
  transfer, not branding

---

## Appendix: Field Classification Summary

| Original field | Classification | Section |
|---|---|---|
| `schemaVersion` | KEEP | §6.1 |
| `protocolVersions` | KEEP (DECLARED + OBSERVED) | §6.2 |
| `requiresAuth` | KEEP (DECLARED + OBSERVED) | §6.3 |
| `requiresArgs` | KEEP (DECLARED + OBSERVED) | §6.4 |
| `transport` | KEEP (already in registry) | §6.5 |
| `destructiveTools` | MOVE OUT OF REGISTRY | §6.6 |
| `secretsInToolOutput` | REMOVE | §6.7 |
| `latency` | REMOVE | §6.8 |
| `failureRate` | REMOVE | §6.9 |
| `lastVerified` | MODIFY → provenance | §6.10 |
| `verifiedBy` | MODIFY → provenance | §6.11 |
| `score` | REMOVE | §6.12, §9 |

| Proposed concept | Classification | Section |
|---|---|---|
| `mcp.health` (single object) | REPLACE with `mcp.requirements` | §7, §16 |
| `mcp.requirements` (publisher-declared) | **MVP — propose now** | §12.1, §16 |
| `mcp.verification` (verifier-attested) | **DEFER — future extension** | §12.2, §16.6 |
| Score in registry | **REJECT** | §9, §15 |
| Health as single concept | **REJECT** | §7, §15 |
