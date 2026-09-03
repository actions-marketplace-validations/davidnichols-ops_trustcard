# NORTH STAR: MCP ECOSYSTEM OBSERVATORY

## Mission

Build the world's first continuously operating autonomous agent ecosystem observatory.

The system will discover, deploy, test, measure, and understand the emerging ecosystem of AI tools and protocols.

Its purpose is to answer:

> "Can autonomous agents safely discover, evaluate, and operate within a world of rapidly expanding external capabilities?"

The system should not assume the answers. It should produce the evidence required to design the infrastructure.

## Strategic Conclusions (Phase 1 Research, 2026-07-27)

### The primary bottleneck is ecosystem visibility

The MCP ecosystem is already larger than current trustcard coverage. **18,754 distinct servers** exist in the registry. **55% are HTTP/SSE remote servers** — trustcard could only scan stdio (39%). We were blind to more than half the ecosystem. HTTP/SSE support is not a feature — it is a prerequisite for relevance.

### trustcard evolves from security middleware to trust infrastructure

trustcard is not an MCP scanner or a registry feature. It is the **trust substrate for the agent ecosystem**. The evolution:

- v1: health probe CLI (scan a server, get a score)
- v2: cryptographic trust protocol (signed manifests, TOFU, enforcement)
- v3: **ecosystem observatory** (continuous discovery, verification, and trust reasoning at population scale)

The five layers of trust infrastructure:
1. Existence verification — does it exist?
2. Health signals — is it alive?
3. Capability verification — does it do what it claims?
4. Behavioral evidence — is it safe to invoke?
5. Trust reasoning — should an autonomous agent use this?

### Analogous infrastructure

This is not novel. It is the same pattern that every ecosystem at scale has required:

| Ecosystem | Trust Infrastructure | What We're Building |
|---|---|---|
| Web PKI | Certificate Transparency logs | Existence + identity verification |
| npm | npm audit + advisory database | Package + dependency verification |
| Docker | Container security scanning | Runtime + capability verification |
| Agent tools | **Nothing yet** | trustcard |

The agent ecosystem is growing faster than any of these did, and it has no trust substrate. That is the gap.

### Scope boundary: MCP is the first protocol, not the only one

MCP is the first standardized protocol for agent-tool interaction, but the trust problem is broader. If research indicates MCP is only a narrow implementation of a larger agent capability trust problem, the architecture expands accordingly. The observatory measures the ecosystem that exists, not the one we assume.

## Core Philosophy

**Measure before standardizing.**

Do not create a trust framework because it sounds useful.
Create a trust framework because:

- millions of tools exist
- agents cannot manually inspect them
- metadata becomes stale
- capabilities become unclear
- security boundaries become ambiguous

The observatory exists to discover:

- what fails
- why it fails
- what signals predict reliability
- what infrastructure is required

### Operating principles

Prefer:
- datasets over dashboards
- measurements over assumptions
- reproducible experiments over opinions
- standards based on evidence

Do not optimize for a feature checklist. Optimize for discovering and solving the fundamental trust problem.

## The Four-Layer Model

The system should understand the ecosystem at four levels.

### Layer 1 — Existence

> "Does this thing actually exist?"

Questions:

- Does the repository exist?
- Does the package exist?
- Does the server install?
- Does the version resolve?
- Does the claimed owner exist?

Outputs:

```yaml
identity:
  repository_verified: true
  package_verified: true
  publisher_verified: false
```

### Layer 2 — Health

> "Is this thing alive?"

Questions:

- Is it maintained?
- Does it receive updates?
- Are dependencies current?
- Are issues ignored?
- Is documentation accurate?

Outputs:

```yaml
health:
  last_commit_days: 12
  release_frequency: weekly
  maintenance_status: active
```

### Layer 3 — Behavior

> "Does it do what it claims?"

This is the missing layer most ecosystems lack.

A server declaring:

> "I provide filesystem search"

should be tested.

Questions:

- Does the capability exist?
- Does the response match expectations?
- Are outputs consistent?
- Does it hallucinate capabilities?

Outputs:

```yaml
behavior:
  declared_capabilities:
    filesystem.search

  observed_capabilities:
    filesystem.search

  match:
    true
```

### Layer 4 — Trust

> "Should an autonomous agent use this?"

Combine all evidence.

Not a simplistic score.
A reasoning model.

Example:

```yaml
trust:

  identity:
    confidence: 0.97

  maintenance:
    confidence: 0.82

  runtime:
    confidence: 0.91

  security:
    confidence: 0.73

  recommendation:
    supervised_execution
```

## Critical Principle

**Trust is not a label.**
**Trust is evidence.**

The observatory should never say:

> "Safe."

It should say:

> "We observed these properties, under these conditions, producing this confidence."

## Autonomous Research Loop

The system should continuously improve itself.

```
Observe ecosystem
        ↓
Find anomalies
        ↓
Generate hypotheses
        ↓
Design experiments
        ↓
Collect evidence
        ↓
Update trust model
        ↓
Publish findings
        ↓
Improve infrastructure
        ↓
   (back to observe)
```

This turns it into a scientific instrument.

## The Agent Role

The autonomous agent should act as:

**Researcher**
Not just coder.

Responsibilities:

- investigate unknowns
- form hypotheses
- run experiments
- challenge assumptions
- write reports
- propose architecture changes

> **Strategic note:** Do not immediately code the final architecture.
> Spend the first phase as a researcher: map the ecosystem, identify
> unknowns, run experiments, and then decide what should be built.
> That is where a strong reasoning model with internet + compute access
> has the highest leverage.

## Required Outputs

The system should continuously generate:

### 1. Ecosystem Dataset

Example:

```
mcp_servers_2026_08.json

server
repository
publisher
version
capabilities
health
runtime_results
security_results
trust_metadata
```

### 2. Public Research Reports

Examples:

- State of MCP Ecosystem Report
- MCP Reliability Index
- MCP Security Landscape
- Agent Tool Trust Study

### 3. Infrastructure

Possible outputs:

- Trustcard improvements
- MCP health schema
- verification protocols
- agent safety mechanisms

## Experimental Infrastructure

The observatory needs its own lab environment.

### Sandbox Layer

Every server execution should happen inside isolated environments.

Requirements:

- containers
- resource limits
- network controls
- filesystem isolation
- logging

The observatory itself should demonstrate the safety problem it studies.

### Hardware Strategy

The goal is not maximum compute.
The goal is ecosystem simulation.

Use:

| Platform | Role |
|---|---|
| **M4 Mac** | local inference, coordinator, lightweight agents, MLX experiments |
| **T4 Colab** | batch analysis, embeddings, classification, large-scale experiments |
| **External nodes later** | distributed ecosystem testing |

## Hidden Opportunity: MCP Genome Project

Every MCP server has a "genome."

```yaml
server_genome:

  identity:
    origin
    owner
    repository

  capabilities:
    tools
    resources
    prompts

  dependencies:
    packages
    versions

  behavior:
    observed_actions

  security:
    permissions

  history:
    evolution
```

Over time you build the first evolutionary map of agent infrastructure.

Questions:

- Which designs survive?
- Which architectures fail?
- Which security patterns correlate with adoption?
- What makes an MCP server successful?

## Hidden Opportunity: Agent Benchmarking

The observatory can become the benchmark suite.

Not:

> "Can this model answer questions?"

Instead:

> "Can this agent safely operate in the real tool ecosystem?"

Benchmark:

- tool discovery
- tool selection
- permission reasoning
- failure recovery
- malicious tool detection
- capability verification

This is a major unsolved problem.

## Hidden Opportunity: Red Team Mode

Create adversarial experiments.

Examples:

- misleading descriptions
- fake capabilities
- outdated manifests
- malicious dependencies
- privilege escalation attempts

Goal:

> Find ecosystem weaknesses before attackers do.

## Governance Principle

The observatory must remain neutral.

It should not become:

> "David's approved MCP list."

It should become:

> "Here is the evidence."

Avoid:

- censorship
- subjective rankings
- popularity bias

Prefer:

- transparent measurements
- reproducible experiments
- open datasets

## Success Metrics

### 30 days — Ecosystem Visibility

- Universal discovery: registry crawler + stdio + HTTP/SSE support
- Layer 1 verification: repository existence, package existence, publisher identity
- First reproducible ecosystem dataset (all 18,000+ servers)
- Initial ecosystem report with population-scale measurements

### 90 days — Trust Signals

- Layer 2 health scoring: maintenance signals, staleness detection
- Capability fingerprinting: declared vs observed tool schemas
- Continuous monitoring: periodic re-verification, drift detection
- Published research: State of MCP Ecosystem Report

### 1 year — Trust Substrate

The observatory becomes:

- a reference dataset
- a benchmark
- a trust layer
- a research platform
- infrastructure used by agent developers

## Open Research Questions

- Why do some publishers generate thousands of servers? (pipeworx-io: 1,270 zero-star servers)
- What ecosystem patterns correlate with trust?
- Which metadata signals actually predict reliability?
- What does an autonomous agent need to know before invoking an external capability?
- Is MCP the right scope, or is it a narrow instance of a broader agent capability trust problem?

## Implementation Priority

1. **Universal MCP discovery** — registry crawler, stdio support, HTTP/SSE support
2. **Layer 1 verification** — repository existence, package existence, publisher identity, stale metadata detection
3. **First reproducible ecosystem dataset** — the data spine everything else builds on
4. **Only after ecosystem visibility exists:** health scoring, capability fingerprinting, behavioral testing, trust reasoning

## Final North Star Statement

Build the measurement, verification, and trust infrastructure required for autonomous agents to safely operate in an open ecosystem of tools.

Do not guess what the future agent economy requires.

**Observe it, measure it, and build the missing primitives.**
