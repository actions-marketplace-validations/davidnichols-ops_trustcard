# Trustcard External Evidence Response Protocol

**Date:** 2026-07-28
**Status:** Active operating principle
**Purpose:** Define how Trustcard responds when external researchers
challenge, correct, or extend the evidence base. Prevent defensive reactions.
Formalize correction handling. Preserve the credibility advantage gained from
transparent self-correction during the MCP Registry investigation.

---

## Principle

External measurements are treated as independent evidence, not competition.

A correction, disagreement, or failed hypothesis is a research output, not a
failure. The most valuable artifacts this project produced were the ones where
evidence contradicted an initial assumption — the siliroid correction (14.4% →
12.3% after two measurement bugs) and the `protocolVersions` kill-test (0/100
incompatibility failures). Those outcomes are more credible than any
uncontested proposal.

**The system that rejects its own ideas under adversarial testing is more
trustworthy than the system that defends them.**

---

## Response categories

### 1. Confirmed extension

**When:** External work measures a distinct layer that Trustcard does not
cover.

**Example:**
- Trustcard measures stdio installability (68% can't start without config)
- Circadian-agent measures repository existence (15% NOT_FOUND)
- siliroid measures remote endpoint reachability (12.3% don't speak MCP)

**Response:**
- Acknowledge the scope difference explicitly
- Integrate as complementary evidence — different layers, different failure
  modes, different trust properties
- Do NOT merge metrics into a single score (see `mcp.health` rejection)
- Cite the external work with attribution and methodology summary
- Do not claim ownership of the measurement

**What not to do:**
- Do not reframe the external measurement as a Trustcard result
- Do not collapse distinct layers into a unified "health" metric
- Do not ignore the external work because it came from outside

### 2. Measurement correction

**When:** An external researcher identifies a methodological flaw in
Trustcard's measurements, or Trustcard discovers its own flaw.

**Required response:**

1. **Acknowledge the correction publicly.** State what was wrong, who
   identified it, and what the corrected result is. Do not minimize.
2. **Identify whether Trustcard has the same vulnerability.** If the
   correction came from a different instrument, check whether Trustcard's
   instrument has the same blind spot.
3. **Update methodology if applicable.** Fix the measurement process. Record
   the fix in the methodology documentation.
4. **Preserve the previous result as a historical record.** Do not silently
   overwrite. The correction history is itself evidence of credibility.
5. **Re-run the measurement if feasible.** Report the corrected number with
   the correction history visible.

**Example from this project:**
- siliroid's initial result was 14.4% of remote endpoints not speaking MCP
- Two measurement bugs were found: response truncation and
  concurrency-induced rate limiting
- Corrected result: 12.3%
- The correction was documented with the bug details, not hidden
- The 80/80 two-seed control was added to validate the correction

**What not to do:**
- Do not silently update the number without explaining what changed
- Do not dismiss the correction as a tooling artifact without verifying
- Do not hide the previous result — the correction history is the credibility

### 3. Proposal-killing evidence

**When:** Evidence invalidates a proposed feature, field, or design.

**Required response:**
- Close the proposal explicitly — status KILLED, not "deferred" or "pending"
- Document why the evidence killed it, with quantitative detail
- Preserve the complete reasoning chain (hypothesis → investigation →
  proposal → kill-test → disposition)
- Do NOT search for replacement fields without evidence of a genuine gap
- Record what would reopen the question, so future researchers know the
  conditions rather than re-deriving the same dead end

**Example from this project:**
- `protocolVersions` was proposed as the one non-redundant schema gap
- Kill-test found 0/100 protocol-version incompatibility failures
- MCP handshake negotiation resolves version compatibility by design
- Proposal was killed and documented as a disposition record
- The reasoning chain is preserved in
  `mcp_requirements_registry_proposal.md` and
  `trustcard_mcp_registry_research_conclusion.md`

**What not to do:**
- Do not keep the proposal alive with a "deferred" status
- Do not immediately propose a replacement field without evidence
- Do not delete the reasoning chain — it prevents others from reopening
  the same question

---

## MCP Registry discussion response

### Current position

> The investigation does not support a registry schema change at this time.

### Evidence basis

- Existing schema fields (`environmentVariables`, `packageArguments`,
  `runtimeArguments`, `headers`, `transport`, `repository`) represent the
  demonstrated selection-critical requirements
- MCP protocol negotiation handles version compatibility (0/100
  incompatibility failures in 100-server sample)
- Observed failures (68% config, 15% dead repos, 12.3% dead endpoints) are
  primarily configuration declaration and verification issues, not schema
  expressiveness issues

### If future discussion identifies a candidate schema primitive

Evaluate it using these five questions before proposing it:

1. **Is the information unavailable today?** Check the existing schema
   (`server.schema.json`) for an equivalent field. Many requirements are
   already expressible.
2. **Is it selection-critical before connection?** Does a client need this
   information to decide whether to attempt a connection, or can it be
   discovered at handshake/runtime?
3. **Does it materially improve client decisions?** "Nice to have" is not
   sufficient. The field must enable a materially better selection decision
   than what the protocol and existing metadata already provide.
4. **Is the maintenance burden justified?** Every added field creates a
   publisher maintenance obligation. Is the value demonstrated enough to
   justify that burden at ecosystem scale?
5. **Can the claim be verified independently?** If the field is a
   declaration, can a verifier check whether it's accurate? Fields that
   cannot be verified become trust theater.

If any answer is "no" or "not demonstrated," do not propose the field.

### What not to do in registry discussions

- Do not propose fields that duplicate existing schema functionality
- Do not propose fields that duplicate protocol negotiation behavior
- Do not propose scalar scores or "health" objects (wrong abstraction)
- Do not propose putting verification results in the registry (Trustcard's
  job, not the registry's)
- Do not file an issue without having run the five-question evaluation
- Do not file a PR without maintainer discussion first

---

## General operating principles

### 1. Self-correction is a research output

The most credible thing Trustcard did during the MCP Registry investigation
was kill its own proposal. That should be an explicit operating principle,
not a one-time event.

### 2. Do not defend assumptions against evidence

When evidence contradicts an assumption, the assumption loses. Always. The
`protocolVersions` proposal assumed protocol version was selection-critical.
The data showed it wasn't. The proposal was killed. This is the correct
response.

### 3. Preserve correction history

Silent corrections destroy credibility. Visible corrections build it. The
siliroid correction (14.4% → 12.3%) and the `protocolVersions` kill-test
are preserved in full detail because the correction history is the evidence
that the methodology is trustworthy.

### 4. Distinguish layers

Different measurement streams (installability, repo existence, endpoint
reachability, protocol compatibility) are different layers with different
trust properties, staleness rates, and owners. Do not collapse them into a
single metric. Do not claim a result in one layer implies a result in
another.

### 5. Do not become a second registry

Trustcard verifies declarations. It does not redefine them. It does not
write to the registry. It does not become the source of truth. The registry
is the distribution point for publisher claims; Trustcard is an independent
measurer of whether those claims hold.

---

## Historical examples from this project

| Event | Type | Response | Outcome |
|---|---|---|---|
| siliroid found 14.4% → 12.3% correction | Measurement correction | Documented bugs, corrected result, added control strata, preserved history | Credibility increased |
| `mcp.health` found to be wrong abstraction | Proposal-killing evidence | Rejected in `trustcard_mcp_health_external_reassessment.md` | Moved to narrower proposal |
| `mcp.requirements` found redundant with existing fields | Proposal-killing evidence | Rejected via schema inspection | Moved to `protocolVersions` only |
| `protocolVersions` found not selection-critical | Proposal-killing evidence | Killed via empirical kill-test, documented as disposition | No registry change filed |
| Circadian measured repo existence separately | Confirmed extension | Acknowledged as complementary layer, not merged into Trustcard's metric | Three-stream evidence base |

Each of these was handled by this protocol's principles, even before the
protocol was written. The protocol formalizes what the project already did
correctly.
