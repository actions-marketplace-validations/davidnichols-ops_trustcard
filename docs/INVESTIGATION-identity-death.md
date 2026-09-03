# Investigation: Identity Death — Package Zombies in the MCP Ecosystem

> One-page investigation note. Claims ≤ evidence. Evidence IDs cited.

---

## Question

What should an agent NOT assume when it discovers an MCP server in a
registry? Specifically: does a resolving npm package mean the source
repository still exists?

## Method

Sampled 100 servers from the 18,760-server MCP ecosystem registry
(`data/mcp-registry-2026-07-27.json`, 2026-07-27). Ran Layer 1 existence
verification (GitHub API + npm registry lookup) on each. Manually verified
5 anomalous cases with `curl` against the GitHub API and npm registry.

## Findings

### Package zombies: npm package exists, GitHub repo is 404

Three subjects in the sample have a live npm package but a deleted GitHub
repository:

| Subject | Repo (404) | npm package (live) | Latest version |
|---------|-----------|---------------------|----------------|
| `dev.dungbeetle/mcp` | `DungbeetleTech/cloud` | `dungbeetle-mcp` | 0.1.0 |
| `io.github.Fluke-Studio/uk-business-intelligence` | `Fluke-Studio/uk-business-intelligence-mcp` | `uk-business-intelligence-mcp` | 0.1.3 |
| `io.github.Rswcf/deepviews` | `Rswcf/v0-valuation-tool` | `deepviews-mcp` | 1.0.3 |

**Evidence IDs:** Stored in `data/evidence/2026/07/2026-07-27.jsonl` as
`repository-not-found` + `package-resolves` pairs for each subject.

### Full death: repo 404, package exists but registry metadata is stale

Two additional subjects have repo 404 with npm packages that still resolve:

| Subject | Repo (404) | npm package (live) |
|---------|-----------|---------------------|
| `io.github.kaleckh/authproof` | `kaleckh/AgentAuth` | `@authproof/mcp-server` |
| `eu.ansvar/namibian-law-mcp` | `Ansvar-Systems/namibian-law-mcp` | `@ansvar/namibian-law-mcp` |

These were initially classified as "neither exists" by the automated scan
(a probe bug with scoped npm packages), but manual verification confirmed
the packages DO resolve on npm.

## What an agent should NOT assume

1. **Do not assume `npm install` success means the project is maintained.**
   The package is a tarball snapshot. The source repository may have been
   deleted after publication. There is no source to audit, no issues to
   file, no maintainer to contact.

2. **Do not assume the repo URL in registry metadata is current.** The
   URL was set at publish time. If the repo is deleted, the registry
   still shows the old URL. An agent that follows the URL gets a 404
   with no explanation.

3. **Do not assume package version recency means active maintenance.**
   `deepviews-mcp` is at version 1.0.3 on npm, but the repo
   (`Rswcf/v0-valuation-tool`) is gone. The version number reflects
   past publishing activity, not current maintenance.

4. **Do not assume a resolving package is safe to install.** Without a
   source repository, there is no way to audit the code for supply chain
   attacks. The package could be a trojan uploaded before the repo was
   deleted, or the repo could have been deleted to hide evidence of
   malicious code.

## Prevalence estimate

From the 100-server sample: 5 subjects (5%) have a deleted GitHub repo
with a live npm package. If this rate holds for the full 18,760-server
ecosystem, approximately **938 MCP servers** may be package zombies.

This is a lower bound — the sample only checked GitHub repos. Servers
with GitLab/Bitbucket URLs or no repo URL at all were not tested.

## Evidence citations

All evidence records are in `data/evidence/2026/07/2026-07-27.jsonl`.
Query with:
```bash
node bin/mcp-trustcard.js evidence history --subject dev.dungbeetle/mcp --evidence-dir data/evidence
node bin/mcp-trustcard.js evidence history --subject io.github.Rswcf/deepviews --evidence-dir data/evidence
```

## Limitations

- Sample size: 100 servers (0.5% of ecosystem). Not statistically
  representative.
- Only GitHub repos checked. Non-GitHub repos not verified.
- Scoped npm packages (`@scope/name`) may have false negatives in the
  automated probe (confirmed for 2 subjects).
- No temporal data — this is a single snapshot. We do not know when
  the repos were deleted relative to package publication.
- The 5% prevalence estimate assumes the sample is representative,
  which it may not be (stratified by transport, not by registry health).

## Recommendation

An agent consuming MCP server metadata should verify repository
existence before trusting a package. The `trustcard evidence` CLI
provides this verification. A registry that lists a package without
a live source repository should be treated as a supply chain risk.
