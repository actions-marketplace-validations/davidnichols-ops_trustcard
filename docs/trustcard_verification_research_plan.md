# Trustcard Verification Research Plan

**Date:** 2026-07-29
**Status:** Research plan — not code, not a proposal
**Predecessor:** `trustcard_mcp_registry_research_conclusion.md`
**Boundary:** `trustcard_requirements_verification_boundary.md`
**Operating principle:** `trustcard_external_feedback_protocol.md`

---

## 1. Research question

> Can an independent verifier reliably measure whether the MCP Registry's
> existing declarations correspond to what a naive client actually
> experiences?

This is the question that emerged from the registry schema investigation.
The investigation proved the registry schema is already sufficient for
selection-critical requirements. The open question is whether declared
metadata matches runtime reality — and whether measuring that gap produces
useful evidence for the ecosystem.

This is a research question, not a product roadmap. The output is evidence
and methodology, not a schema change or a registry issue.

---

## 2. What is already built

Trustcard's scanner (`lib/observe.js`, `lib/client.js`) already performs
naive-client probing for stdio servers:

- Launches `npx -y <pkg>` with no args/env
- Attempts MCP handshake with protocol version negotiation
- Enumerates tools via `tools/list`
- Runs danger analysis on tool definitions
- Records protocol version, server info, tool count, handshake result

The 100-server scan (`data/mcp-ecosystem-2026-07-27-sample100.json`)
demonstrated this works. The evidence base also includes two complementary
external measurements:

| Layer | Measurer | Method | Scale |
|---|---|---|---|
| stdio installability | trustcard | `npx -y <pkg>`, no args/env | 100 servers |
| repository existence | Circadian-agent | GitHub GraphQL API | 13,698 repos |
| remote endpoint reachability | siliroid | HTTP `initialize` JSON-RPC | 9,403 endpoints |

These three layers are disjoint — they measure different things with
different methods. They are complementary, not competing.

---

## 3. Measurement layers

The verification research operates across five layers. Each layer has a
distinct question, method, and evidence type. Layers are measured
independently and never collapsed into a single score.

### Layer 1: Installation

**Question:** Can the package launch?

**Method:**
- For npm packages: `npx -y <pkg>` with no args, no env vars
- For other registries: equivalent naive invocation
- Record: exit code, stdout, stderr, time to first output
- Timeout: 45 seconds

**Evidence type:** OBSERVED (binary: launched / failed)

**What this measures:** Whether a naive client can start the server at all.
The 68% failure rate in the 100-server sample was primarily in this layer.

**What this does NOT measure:** Whether the server works correctly once
launched, whether declared requirements are accurate, whether the server is
safe.

**Registry declaration compared against:** `Package.registryType`,
`Package.identifier`, `Package.version`, `Package.transport`

### Layer 2: Configuration

**Question:** Are declared requirements accurate?

**Method:**
- Read `Package.environmentVariables` from the registry entry
- For each declared `isRequired: true` variable:
  - Launch WITHOUT the variable → does the server fail? (should fail)
  - Launch WITH a dummy value → does the server accept it? (should succeed)
- Read `Package.packageArguments` from the registry entry
- For each declared `isRequired: true` argument:
  - Launch WITHOUT the argument → does the server fail? (should fail)
  - Launch WITH a dummy value → does the server accept it? (should succeed)
- For remote servers: read `RemoteTransport.headers`
  - Connect WITHOUT required headers → does the server reject? (should reject)
  - Connect WITH dummy headers → does the server accept? (should accept)

**Evidence type:** OBSERVED (per-declaration: MATCHED / CONTRADICTED / UNKNOWN)

**What this measures:** Whether the registry's declared requirements
correspond to what the server actually enforces.

**What this does NOT measure:** Whether undeclared requirements exist (that's
Layer 1 — if the server fails without an undeclared requirement, Layer 1
catches it).

**Registry declaration compared against:** `Package.environmentVariables`,
`Package.packageArguments`, `Package.runtimeArguments`,
`RemoteTransport.headers`

**Known gap:** Most registry entries don't declare any requirements (1/50
sample had env vars, 0/50 had args). When declarations are absent, this
layer produces UNKNOWN, not CONTRADICTED. The gap is adoption, not accuracy.

### Layer 3: Protocol

**Question:** Does initialization succeed?

**Method:**
- Send `initialize` JSON-RPC request with client's latest protocol version
- Record server's response: `protocolVersion`, `capabilities`, `serverInfo`
- If server responds with a different version, record the negotiated version
- If server doesn't respond or errors, record failure mode

**Evidence type:** OBSERVED (PASS / FAIL with reason)

**What this measures:** Whether the MCP handshake completes successfully.

**What this does NOT measure:** Whether the server correctly implements the
negotiated protocol version (that would require protocol-level conformance
testing, which is out of scope).

**Registry declaration compared against:** None. Protocol version is
negotiated at handshake, not declared in the registry. (The `protocolVersions`
proposal was killed — the handshake handles this.)

### Layer 4: Capability

**Question:** Do advertised tools match reality?

**Method:**
- After successful handshake, call `tools/list`
- Record: tool count, tool names, tool schemas
- Compare against any prior observation (drift detection)
- Validate each tool schema against JSON Schema
- Run danger analysis on tool definitions

**Evidence type:** OBSERVED (tool inventory + per-tool schema validity +
per-tool danger assessment)

**What this measures:** What the server actually offers after connection.

**What this does NOT measure:** Whether the tools work correctly when called
(that would require calling each tool, which has side effects and is out of
scope for passive verification).

**Registry declaration compared against:** None. The registry doesn't
declare tools — tools are discovered at runtime via `tools/list`. This layer
produces new data, not declaration-vs-observation comparison.

**Trustcard-specific extension:** If a signed manifest exists (via
`_meta.publisher-provided`), compare observed tools against the signed
toolset. This is the Gate 1 trust-state check. Mismatches produce
MISMATCH/SUSPECT states per the trust-state machine.

### Layer 5: Security

**Question:** Are dangerous behaviors declared?

**Method:**
- Run the three-engine danger detector on each tool definition:
  - Heuristic: verb matching + parameter analysis + suspicious phrase detection
  - Semantic: TF-IDF cosine similarity against dangerous-action corpus
  - Injection: prompt-injection marker detection
- Record: per-tool danger assessment (NONE / DESTRUCTIVE / INJECTION / HIGH)
- Flag tools with destructive capabilities that don't declare
  `destructiveHint: true` in annotations

**Evidence type:** OBSERVED (heuristic, not factual — danger assessment is
a classifier output, not a proof)

**What this measures:** Whether the server's tool definitions contain
patterns associated with destructive or injection behavior.

**What this does NOT measure:** Whether the server is actually malicious.
The danger detector is a heuristic that produces false positives and false
negatives. It is a signal for human review, not an automated verdict.

**Registry declaration compared against:** `ToolAnnotations.destructiveHint`
(if declared). A tool with destructive behavior but `destructiveHint: false`
(or absent) is a declaration/observation mismatch.

---

## 4. Research questions

### RQ1: Declaration-observation correspondence

> How often do registry declarations match naive-client experience?

This is the primary question. It decomposes per layer:

- **Layer 2 (Configuration):** When `environmentVariables` with
  `isRequired: true` are declared, does the server actually require them?
  When declared args are `isRequired: true`, does the server actually
  require them?
- **Layer 3 (Protocol):** Does the handshake succeed? (No declaration to
  compare against — this is pure observation.)
- **Layer 4 (Capability):** What tools does the server actually expose?
  (No declaration to compare against — this is new data.)
- **Layer 5 (Security):** Do tools with destructive patterns declare
  `destructiveHint: true`?

**Output:** Per-layer correspondence rates with confidence intervals and
control strata (per Circadian's methodology).

### RQ2: Predictive value of existing registry fields

> Which existing registry fields have the highest predictive value for
> first-contact success?

If a registry entry declares `environmentVariables` with `isRequired: true`,
does that predict whether a naive client will succeed? If an entry has
`transport: { type: "stdio" }`, does that predict launch success?

**Output:** Per-field predictive value (true positive rate, false positive
rate) with sample size and confidence intervals.

**Caveat:** This is correlational, not causal. A field that predicts success
doesn't cause success — it may just be that publishers who fill in fields
also write better servers.

### RQ3: Verification reproducibility

> What verification methods produce reproducible evidence?

The siliroid correction (14.4% → 12.3% after two measurement bugs) proved
that a single instrument can have systematic blind spots. What methods
prevent this?

**Sub-questions:**
- Does a second verifier using different tooling reproduce Trustcard's
  observations?
- What control strata are needed? (Circadian used 40/40 seeded random
  samples with an independent method.)
- How stable are observations over time? (siliroid reported zero flaky
  endpoints — the broken set is stable, not flapping.)

**Output:** Methodology recommendations with evidence from cross-verifier
comparison.

### RQ4: Registry metadata vs external attestations

> What information belongs in registry metadata versus external
> attestations?

The registry investigation concluded that the registry should carry
publisher declarations, not verification results. But where exactly is the
line?

**Sub-questions:**
- Should the registry carry `lastVerified` timestamps? (siliroid argued
  this is "the load-bearing field, not score." But who verifies, and how
  is freshness maintained?)
- Should the registry carry `verifiedBy` method identifiers? (siliroid
  argued this is what makes verification trustworthy. But this requires
  governance — who decides which methods count?)
- Should Trustcard's signed manifest live in `publisher-provided` or
  outside the registry entirely?

**Output:** A boundary document (already started in
`trustcard_requirements_verification_boundary.md`) refined with evidence
from RQ1-RQ3.

---

## 5. No premature claims gate

Before publishing any result from this research, the claim must pass through
this gate:

```
Claim
  |
  v
Can we reproduce it?
  |  NO → do not publish
  |  YES
  v
Can an independent method disagree?
  |  NO (only one method exists) → label as "single-instrument observation"
  |  YES
  v
Did we test disagreement?
  |  NO → do not publish until tested
  |  YES
  v
Is this observation or recommendation?
  |  RECOMMENDATION → trace to supporting observations; if no observations, do not publish
  |  OBSERVATION
  v
Publish with: method, sample size, confidence interval, limitations, correction history
```

### Why this gate exists

The siliroid failure mode was:
1. Interesting measurement (14.4% of endpoints don't speak MCP)
2. Same-instrument confirmation (re-probed until it agreed with itself)
3. Wrong conclusion (two bugs inflated the number by ~17%)

Same-instrument confirmation is not verification. It catches flaky
endpoints but is blind to systematic instrument errors. The gate requires
either an independent method or an explicit "single-instrument observation"
label.

### What the gate prevents

- Publishing numbers that are inflated by instrument bugs
- Publishing recommendations without supporting observations
- Publishing observations without stating limitations
- Silently correcting numbers without preserving correction history

### What the gate does NOT prevent

- False negatives (the gate can't catch errors that both instruments share)
- Genuine uncertainty (the gate requires labeling, not eliminating it)
- Legitimate disagreement between verifiers (the gate requires publishing
  the disagreement, not resolving it silently)

---

## 6. Methodology requirements

### Control strata (per Circadian's methodology)

Every measurement that produces a population-level claim must include:

1. **Seeded random sample** from each stratum (suspect / control)
2. **Independent verification method** for the sample (different code,
   different tooling, sharing no measurement logic with the primary method)
3. **Control arm** — the half that does the work. A broken prober breaks
   everything, so suspects confirming tells you almost nothing on its own.
   The control arm is what validates the method.
4. **Published seed** so the sample is checkable, not merely claimable.
5. **Two independent seeds** for the control arm (Circadian used 40/40,
   siliroid verified with 80/80 across two seeds).

### UNKNOWN handling

PRESENT, ABSENT, and UNKNOWN must stay distinct. UNKNOWN may never be
counted as ABSENT. (Circadian's retracted 37.8% figure collapsed "the server
said no" with "we never got an answer" — UNKNOWN was counted as ABSENT,
inflating the result by ~43x.)

### Correction transparency

When a measurement bug is found:
1. Acknowledge the correction publicly
2. State what was wrong and who identified it
3. Publish the corrected number with the correction history visible
4. Do not silently overwrite the previous result
5. Re-run with the corrected method and verify with control strata

### Attribution discipline

- Observations are factual: "under configuration Y, behavior was Z"
- Attributions are hypotheses: "the likely cause is X" (labeled as such)
- Recommendations derive from observations, not from ideology
- No claim generalizes beyond the tested configuration without explicit
  justification

---

## 7. What this plan is NOT

- **Not a schema proposal.** No registry change is proposed or implied.
- **Not a product roadmap.** The output is evidence and methodology, not
  shipping features.
- **Not a Trustcard dependency creation.** The registry does not need
  Trustcard. Trustcard does not need the registry to change. The two are
  independent.
- **Not a verification monopoly.** Other verifiers can and should exist.
  The evidence format is public and portable. Trustcard is a reference
  verifier, not the verifier.
- **Not a score system.** No scalar trust score is proposed for the
  registry. Trustcard's internal scorecard (0-100) is CLI convenience, not
  a standard.
- **Not a race.** The research is not timed against other verifiers. The
  siliroid correction demonstrated that speed without control strata
  produces wrong numbers. Correctness over speed.

---

## 8. Phasing

### Phase 1: Methodology hardening (current)

- Lock the five-layer measurement model
- Implement control strata for all population-level claims
- Implement the no-premature-claims gate
- Verify the existing 100-server scan data against the methodology
- Document any corrections needed to the existing data

### Phase 2: Declaration-observation study

- Run RQ1 (declaration-observation correspondence) on a larger sample
- Use control strata per Circadian's methodology
- Publish results with method, sample size, confidence intervals, limitations
- Do NOT publish recommendations — only observations

### Phase 3: Cross-verifier comparison

- Invite or wait for an independent verifier to measure the same layers
- Compare results
- Publish agreement and disagreement
- This is what validates the methodology (per siliroid's lesson: same-
  instrument confirmation is not verification)

### Phase 4: Boundary refinement

- Use evidence from Phases 2-3 to refine the registry/Trustcard boundary
- Answer RQ4 (what belongs in registry vs external attestations)
- This may or may not produce a registry contribution — only if the evidence
  justifies it, and only after the five-question evaluation
  (see `trustcard_external_feedback_protocol.md`)

---

## 9. Decision authority

| Decision | Who |
|---|---|
| Run a measurement campaign | Human |
| Publish results | Human (after no-premature-claims gate passes) |
| File a registry issue | Human (only if evidence justifies, after five-question evaluation) |
| Release tooling | Human |
| Correct a published number | Agent (with correction transparency per §6) |
| Add a measurement layer | Human (requires methodology update) |
| Respond to external feedback | Agent (per `trustcard_external_feedback_protocol.md`) |

The agent can correct numbers, respond to feedback, and run measurements.
The agent cannot publish claims, file issues, or release tooling without
human approval.

---

## 10. Success criteria

This research succeeds if:

1. **It produces reproducible evidence** that declaration-observation
   correspondence can be measured reliably across the five layers.

2. **It survives cross-verifier comparison** — a second verifier using
   different tooling produces similar results, or the differences are
   explained and documented.

3. **It does not produce a premature schema proposal.** The registry
   investigation killed `protocolVersions` because the evidence didn't
   support it. This research should maintain the same standard.

4. **It does not become a second registry.** Trustcard measures; it does
   not declare. Evidence lives in Trustcard's store, not in the registry.

5. **It corrects its own errors publicly.** The siliroid correction and the
   `protocolVersions` kill-test are the model. Future errors should be
   handled the same way.

This research fails if:

- It publishes numbers without control strata
- It collapses layers into a single score
- It proposes a schema change without evidence
- It becomes a dependency the registry is expected to use
- It hides correction history
