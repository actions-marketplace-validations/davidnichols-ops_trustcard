# Phase 1 Research Findings — MCP Ecosystem Observatory

**Date:** 2026-07-27
**Researcher:** Devin (autonomous agent, human oversight)
**Status:** Research phase — no architecture decisions made yet

---

## What We Know

### The Registry

| Metric | Value | Source |
|---|---|---|
| Total version records | 59,923 | Direct crawl (this session) |
| Distinct server names | 18,754 | Direct crawl (this session) |
| Servers with GitHub repos | 15,184 | Circadian dataset |
| Servers declaring no repository | 3,240 | Circadian dataset |
| Servers with non-GitHub hosts | 220 | Circadian dataset |

The registry API is at `https://registry.modelcontextprotocol.io/v0/servers` with cursor-based pagination (`?limit=100&cursor=...`). Schema is `2025-12-11/server.schema.json`. API freeze v0.1 declared 2025-10-24.

### Transport Distribution (sample of 100)

| Transport | Count | % |
|---|---|---|
| Remote only (HTTP/SSE) | 55 | 55% |
| npm package only (stdio) | 39 | 39% |
| Both | 1 | 1% |
| Neither | 5 | 5% |

**This is the single most important finding for the observatory.** Over half the ecosystem is remote HTTP servers, and trustcard cannot scan them.

### Circadian's Layer 1 Results (Existence)

| Metric | Value |
|---|---|
| Distinct GitHub repos declared | 13,698 |
| Repos that resolve (present) | 11,649 (85%) |
| Repos NOT_FOUND (absent) | 2,049 (15%) |
| Registry entries behind dead repos | 2,294 |
| Distinct owners with absences | 1,601 |
| Owners with exactly one absence | 1,503 (93.9%) |

Verification: 40/40 suspect confirmed unreachable, 40/40 control confirmed reachable. Renames ruled out via anonymous HTTPS probe. Method is sound.

### Circadian's Layer 2 Signals (Health)

| Metric | Value |
|---|---|
| Median days since last push | 29 |
| Pushed within 30 days | 52.1% |
| Pushed within 90 days | 83.3% |
| Silent >180 days | 2.9% |
| Archived repos | 143 |
| Median stars | 0 |
| Repos with ≥1 star | 48.0% |
| Top 100 repos hold | 89.6% of 1.6M stars |

Key insight from Circadian: "The code is alive, the registry entries are stale, and 15% of the links are dead." This argues for registry-maintained health metadata, not just publisher-declared.

### Concentration

| Owner | Servers |
|---|---|
| pipeworx-io | 1,270 |
| CSOAI-ORG | 271 |
| codespar | 126 |
| cyanheads | 124 |
| Br0ski777 | 101 |

One publisher (pipeworx-io) accounts for 9.9% of all servers and 1,270 zero-star repositories. The top 10 owners hold 17.7% of all servers.

### Languages

| Language | Count |
|---|---|
| TypeScript | 4,963 |
| Python | 2,934 |
| JavaScript | 1,727 |
| Go | 276 |
| Rust | 254 |

### trustcard Today

- **Version:** v2.3.0, 326 tests passing, clean tree
- **What works:** stdio server scanning (npm packages via npx), protocol handshake, tool schema validation, destructive capability detection (3-engine fusion), auth posture, secret exposure, latency, protocol version negotiation, Ed25519 signed manifests, TOFU pinning, proxy enforcement, Gate 1/Gate 2
- **What doesn't work:** HTTP/SSE server scanning (55% of ecosystem), repository existence verification, maintenance signal collection, behavioral testing

### Probe Results (5 npm servers, this session)

| Server | Score | Tools | Handshake | Notes |
|---|---|---|---|---|
| server-filesystem | 87/100 | 14 | PASS | Clean |
| server-github | 76/100 | 26 | PASS | Lags protocol version |
| server-brave-search | 57/100 | 0 | CONFIG_REQUIRED | Needs API key |
| duckduckgo-mcp-server | 91/100 | 2 | PASS | Highest score |
| chrome-devtools-mcp | 85/100 | 29 | PASS | Clean |

---

## Gap Analysis: Four-Layer Model vs Current Capability

### Layer 1 — Existence

| Capability | Status | Gap |
|---|---|---|
| npm package resolution | **Built** (checkInstallability) | None |
| Protocol handshake | **Built** (McpStdioClient) | None for stdio; HTTP not supported |
| Repository URL resolution | **Not built** | Circadian has this — could integrate or replicate |
| Publisher/owner verification | **Not built** | Need GitHub API integration |
| Version resolution | **Partial** (npm view) | Registry version tracking not integrated |

**Gap size:** Medium. Circadian already measured this layer at population scale. The observatory needs to replicate it continuously, not just once.

### Layer 2 — Health

| Capability | Status | Gap |
|---|---|---|
| Maintenance signals (commits, releases) | **Not built** | Need GitHub API for repo metadata |
| Dependency staleness | **Not built** | Need package manifest analysis |
| Issue responsiveness | **Not built** | Need GitHub Issues API |
| Documentation accuracy | **Not built** | Hard — needs NLP or manual review |
| Registry freshness | **Not built** | Compare registry version vs latest published |

**Gap size:** Large. This is the thinnest layer in trustcard. Circadian collected some of this (push dates, stars, archived status) but only as a one-time snapshot. The observatory needs continuous monitoring.

### Layer 3 — Behavior

| Capability | Status | Gap |
|---|---|---|
| Tool schema validation | **Built** (checks.js) | None |
| Destructive capability detection | **Built** (danger-detector.js, 3-engine) | None |
| Capability invocation testing | **Not built** | The hard part — actually calling tools |
| Response consistency | **Not built** | Need repeated calls + comparison |
| Hallucination detection | **Not built** | Need declared vs observed comparison |

**Gap size:** Large but lower priority. This is the research frontier — no one in the ecosystem is doing this yet. trustcard's descriptor/diff system is the foundation, but actual capability testing requires sandboxed execution.

### Layer 4 — Trust

| Capability | Status | Gap |
|---|---|---|
| Trust state machine | **Built** (trust.js) | None |
| Signed manifests | **Built** (provenance.js) | None |
| TOFU pinning | **Built** (pin.js) | None |
| Gate 1 (trust-state continuity) | **Built** (guard.js) | None |
| Gate 2 (invocation authorization) | **Built** (policy.js) | None |
| Multi-evidence reasoning model | **Not built** | Currently a simple score, not the confidence-based reasoning model from the North Star |

**Gap size:** Small for the protocol layer. The reasoning model (confidence per layer, recommendation) is new work but builds on existing infrastructure.

---

## What We Don't Know (Unknowns to Investigate)

1. **How many remote servers actually respond?** 55% of the registry is HTTP-based. We don't know how many of those endpoints are live, what auth they require, or what tools they expose. This is the biggest blind spot.

2. **What's the failure mode distribution?** Circadian found 15% of repos are dead. But how many servers fail at handshake? How many need auth? How many have invalid schemas? We need population-scale data across all failure modes, not just repo existence.

3. **How fast does the registry change?** We don't know the rate of new server additions, version updates, or deletions. This determines the monitoring cadence.

4. **What does the pipeworx-io cluster look like?** One publisher with 1,270 zero-star servers is an anomaly. Are these real servers? Spam? A bulk generation pipeline? This affects how we interpret ecosystem health.

5. **Can remote servers be scanned without auth?** Many HTTP servers require bearer tokens. Can we get useful metadata (tools/list) without authenticating, or do we need a credential library?

6. **What's the behavioral testing frontier?** No one is testing whether servers actually do what they claim. What's the minimum viable behavioral test? Can we call a search tool with a known query and check the response shape?

---

## What to Build First

Based on the gap analysis, the highest-leverage first build is:

### 1. HTTP/SSE Transport Support (unblocks 55% of the ecosystem)

trustcard's scanner is stdio-only. Adding an `McpHttpClient` that can connect to `streamable-http` and `sse` endpoints would more than double the addressable ecosystem. This is a prerequisite for any population-scale scan.

**Estimated scope:** One new lib module (`lib/client-http.js`), modifications to `checks.js` to accept remote URLs as specs, new tests with mock HTTP servers.

### 2. Registry Crawler (data pipeline)

A script that paginates through the entire registry, deduplicates by server name, and produces a dataset file. This is the observatory's data spine. Circadian did this manually; we need it automated and repeatable.

**Estimated scope:** One new script (`scripts/crawl-registry.mjs`), outputs JSON dataset with server name, version, transport type, repository URL, remote URLs, package spec.

### 3. Layer 1 Existence Checker (repository verification)

Given a registry entry, verify that the declared repository exists. This is directly inspired by Circadian's measurement and is the cheapest signal to collect at scale.

**Estimated scope:** One new lib module (`lib/existence.js`), uses GitHub API to resolve repository URLs, outputs structured existence data.

### Build order: HTTP transport → Registry crawler → Existence checker → First ecosystem scan

This sequence lets us go from "can scan 39% of the ecosystem" to "can scan 95%+ and verify their repos exist" in a focused first sprint. Everything else (health signals, behavioral testing, trust reasoning) builds on top of having a complete dataset.

---

## What NOT to Build Yet

Per the North Star's strategic note: *"Do not immediately code the final architecture."*

- **No sandbox layer yet.** Behavioral testing needs sandboxes, but we're not at behavioral testing yet.
- **No dashboard yet.** We need data before we can visualize it.
- **No MCP Genome Project yet.** It's a natural output of the dataset, not a first build.
- **No agent benchmarking yet.** This is a 90-day goal, not a 30-day goal.
- **No red team mode yet.** We need to understand the baseline before we can break it.

---

## Reproducibility

- Registry crawl: `python3 -c "import urllib.request, json; ..."` (script in this report, ~60s runtime)
- Circadian dataset: `https://circadian-agent.com/data/mcp-github-2026-07-27.json` (CC BY 4.0)
- trustcard scans: `node bin/mcp-trustcard.js scan <spec> --json` (reproducible, no deps)
- Registry API: `https://registry.modelcontextprotocol.io/v0/servers?limit=100&cursor=...`
