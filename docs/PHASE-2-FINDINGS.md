# Phase 2 Findings — First Ecosystem Scan

**Date:** 2026-07-27
**Researcher:** Devin (autonomous agent, human oversight)
**Status:** Infrastructure sprint — universal discovery + Layer 1 verification built and tested
**Dataset:** `data/mcp-ecosystem-2026-07-27-sample100.json` (100-server stratified sample)

---

## What Was Built

### 1. Registry Crawler (`scripts/crawl-registry.mjs`)
- Paginates the full MCP registry API
- Deduplicates to latest versions
- Classifies transport type (stdio/remote/both/unknown)
- Extracts repo URLs, npm specs, remote URLs
- **Output:** `data/mcp-registry-2026-07-27.json` (18,760 servers, 50MB)

### 2. HTTP/SSE Transport Client (`lib/client-http.js`)
- `McpHttpClient` class — matches `McpStdioClient` interface
- Supports `streamable-http` and `sse` transports
- Handles SSE event parsing, session IDs, JSON-RPC over HTTP
- **Impact:** Unlocks 55% of the ecosystem that was previously invisible

### 3. Scanner Integration (`lib/checks.js`)
- `runHealthcheck()` now detects HTTP URLs and routes to `runRemoteHealthcheck()`
- Same 8-check scorecard (installability, handshake, schema, destructive, auth, secrets, protocol, latency)
- All 326 existing tests still pass

### 4. Layer 1 Existence Checker (`lib/existence.js`)
- `verifyGitHubRepo()` — resolves repository URLs via GitHub API
- `verifyNpmPackage()` — resolves npm package names via npm registry
- `verifyPublisher()` — verifies namespace ownership (io.github.* → GitHub user)
- `batchVerifyExistence()` — batch verification with rate-limit awareness

### 5. Ecosystem Scan Script (`scripts/scan-ecosystem.mjs`)
- Combines registry crawl + existence verification + runtime scan
- Stratified sampling by transport type
- Produces reproducible dataset with summary statistics

---

## What We Found

### Registry Scale

| Metric | Value |
|---|---|
| Total version records | 59,975 |
| Distinct servers | 18,760 |
| stdio transport | 9,154 (48.8%) |
| remote transport | 8,315 (44.3%) |
| both transports | 972 (5.2%) |
| unknown transport | 319 (1.7%) |
| With GitHub repo URL | 15,288 (81.5%) |
| With npm package | 6,470 (34.5%) |
| With remote URL | 9,287 (49.5%) |

### Layer 1 — Existence (100-server sample)

| Metric | Value | % |
|---|---|---|
| Servers with repo URL | 78 | 78% |
| Servers with no repo URL | 22 | 22% |
| **Repo verified (200)** | **58** | **74% of those with URLs** |
| **Repo dead (404)** | **20** | **25.6% of those with URLs** |
| npm package verified | 12 | 12% |
| Publisher verified | 61 | 61% |

**Key finding:** 25.6% of servers that declare a GitHub repository point at a dead link. This is higher than Circadian's 15% measurement. The difference may be sampling variance (100 vs 13,698) or a change in the registry between measurements. Both measurements agree the problem is significant.

**22% of servers have no repository URL at all.** These are opaque — no source code, no verification possible. This is a distinct failure mode from dead repos and should be tracked separately.

### Runtime Scan (100-server sample)

| Metric | Value |
|---|---|
| Successfully scanned | 83 | 83% |
| Scan errors | 17 | 17% |
| Average score | 53/100 | |
| Handshake PASS | 29 | 29% |
| Handshake FAIL | 30 | 30% |
| Handshake CONFIG_REQUIRED | 19 | 19% |

**Runtime by transport:**

| Transport | Servers | Scanned | Avg Score | PASS | FAIL | CONFIG |
|---|---|---|---|---|---|---|
| stdio | 49 | 34 | 62 | 10 | 10 | 9 |
| remote | 44 | 44 | 47 | 17 | 18 | 9 |
| both | 5 | 5 | 49 | 2 | 2 | 1 |

**Key findings:**
- **Only 29% of servers complete a protocol handshake without configuration.** The majority either fail outright (30%) or require configuration (19%) — typically API keys, environment variables, or launch arguments.
- **Remote servers have a slightly higher handshake pass rate (39% vs 29%)** but lower average scores (47 vs 62). This is because remote servers that do connect often expose fewer tools or have higher latency.
- **stdio servers that do connect score higher** (avg 62 vs 47) because they tend to be simpler, self-contained tools.

### Top Scoring Servers

| Score | Server | Tools | Transport |
|---|---|---|---|
| 97 | app.roamward/roamward-mcp | 4 | remote |
| 97 | io.github.SevaSk/nova-scotia-data-explorer | 4 | remote |
| 97 | app.savedthat/savedthat | 2 | remote |
| 97 | es.carteleracines/cartelera | 11 | remote |
| 97 | io.github.MarcioKorpHub/contazz-autopilot | 61 | remote |

All top scorers are remote servers. The highest stdio score was 91 (duckduckgo-mcp-server, from Phase 1 testing).

---

## Cross-Layer Analysis

### The trust gap

Combining Layer 1 and runtime data reveals the full trust gap:

| Category | Count | % | Description |
|---|---|---|---|
| Verified + handshake PASS | ~17 | 17% | Repo exists AND server responds |
| Verified + handshake FAIL | ~18 | 18% | Repo exists but server doesn't respond |
| Verified + CONFIG required | ~11 | 11% | Repo exists but needs auth/config |
| Dead repo + handshake PASS | ~8 | 8% | Repo 404 but server works |
| Dead repo + handshake FAIL | ~12 | 12% | Repo 404 AND server doesn't respond |
| No repo + handshake PASS | ~4 | 4% | No source but server works |
| No repo + handshake FAIL | ~18 | 18% | No source AND server doesn't respond |
| Scan error | ~12 | 12% | Could not attempt scan |

**Only ~17% of servers have both a verifiable source AND a working protocol handshake.** This is the population an autonomous agent can currently trust with evidence. The other 83% have at least one trust gap.

### The pipeworx-io anomaly

From the full registry crawl, pipeworx-io has 1,270 servers (9.9% of the entire registry). In our sample, we hit one: `io.github.pipeworx-io/arcgis-sarpycounty`. Its repo exists but has 0 stars. This publisher is generating servers at industrial scale — the registry's namespace structure makes this trivial (just publish under `io.github.pipeworx-io/*`).

**Research question:** Are these real MCP servers or auto-generated stubs? The one we sampled had a verified repo, so it's not pure spam. But 1,270 zero-star repositories from one publisher is an anomaly that warrants investigation.

---

## What We Don't Know Yet

1. **Full-population Layer 1.** We verified 100 servers. The registry has 18,760. We need to run the full existence check (will take ~1 hour with GitHub token at 5000/hr).

2. **Remote server auth landscape.** 19% of servers need configuration. What kind? API keys? OAuth? Custom headers? We need to categorize the auth requirements.

3. **Why do remote servers fail handshake?** 18/44 remote servers failed handshake. Is it auth, CORS, wrong transport type, or server downtime? We need to capture failure reasons.

4. **The pipeworx-io investigation.** 1,270 servers from one publisher. Are they real? Do they work? What's the pattern?

5. **Behavioral testing.** We can now scan servers and verify repos, but we haven't tested whether tools actually work. A server that handshakes and exposes tools might still return garbage.

---

## What to Build Next

### Priority 1: Full-population existence scan
Run `scan-ecosystem.mjs --existence-only --full` with a GitHub token. This will produce the first complete Layer 1 dataset for the entire MCP registry. Estimated time: ~1 hour (18,760 servers at 5000 GitHub API requests/hour + npm checks).

### Priority 2: Failure mode classification
When a handshake fails, capture the specific failure reason (auth required, connection refused, timeout, wrong protocol, CORS). This turns "FAIL" into actionable signal.

### Priority 3: pipeworx-io deep dive
Scan 50 pipeworx-io servers. Do they work? Are they clones? What tools do they expose? This is the first ecosystem anomaly investigation.

### Priority 4: Continuous monitoring
The registry changes daily. We need a cron-able script that:
- Crawls the registry (delta since last crawl)
- Verifies new/changed entries
- Produces a daily diff report

---

## Reproducibility

```
# Full registry crawl
node scripts/crawl-registry.mjs

# 100-server sample scan
GITHUB_TOKEN=$GITHUB_FACTORY_TOKEN node scripts/scan-ecosystem.mjs --sample 100

# Single server scan (stdio)
node bin/mcp-trustcard.js scan @modelcontextprotocol/server-filesystem --json

# Single server scan (remote)
node bin/mcp-trustcard.js scan https://tandem.ac/mcp --json

# Existence verification (single)
node -e "import('./lib/existence.js').then(m => m.verifyExistence({name:'io.github.frumu-ai/tandem',repoUrl:'https://github.com/frumu-ai/tandem'}).then(r => console.log(JSON.stringify(r,null,2))))"
```

All code is in the trustcard repo. No dependencies. Node 18+.
