# Known Limitations

> Evidence substrate limitations discovered during first real emission.

---

## 1. Non-GitHub repository URLs produce null-value evidence

**Discovered:** 2026-07-27, during first sample100 evidence emission.

**Symptom:** When a server's `repoUrl` is not a GitHub URL (e.g., GitLab,
Bitbucket, or a generic URL), the existence probe cannot verify the
repository. The evidence adapter emits a `repository-resolves` record with
`value: null` and `confidence: 0.0`.

**Root cause:** `lib/existence.js` only implements GitHub repository
verification via the GitHub API. Non-GitHub URLs are not parsed or probed.

**Impact on sample100:** 59 records with `confidence: 0.0` out of 211 total
(28%). These records are technically correct — the probe could not verify
the repository — but they add noise to the store.

**Affected subjects:** Servers with `repoUrl` pointing to non-GitHub hosts
or with `repoUrl: null` but a non-null `repoSource`.

**Workaround:** Filter on `confidence > 0` when querying for definitive
observations. Null-confidence records are still valid evidence of "we tried
and could not determine."

**Fix (not in scope this phase):** Add GitLab/Bitbucket probes to
`existence.js`, or record a `repository-probe-unsupported` predicate
instead of `repository-resolves` with null value.

---

## 2. Servers without npmSpec emit no package evidence

**Discovered:** 2026-07-27, during first sample100 evidence emission.

**Symptom:** 63 of 100 sampled servers have `npmSpec: null`. These servers
emit `identifier-observed` and possibly `repository-resolves` records, but
no `package-resolves` or `package-not-found` records.

**Root cause:** The existence probe only checks npm registry for packages.
Servers distributed via GitHub releases, direct download, or other
registries produce no package evidence.

**Impact:** The evidence store under-represents package existence for
non-npm servers. This is not a bug — it's a known gap in the probe layer.

**Fix (not in scope this phase):** Add PyPI, GitHub releases, and direct
download probes to `existence.js`.

---

## 3. Rate limiting affects GitHub API probes

**Discovered:** 2026-07-27, during sample100 emission.

**Symptom:** The scan script includes a 150ms delay between GitHub API
calls. At 100 servers, this adds ~15 seconds. At 18,760 servers, this
would add ~47 minutes of delay alone.

**Impact:** Full ecosystem scan with evidence emission will be slow. The
GitHub API rate limit (60 requests/hour unauthenticated, 5000/hour
authenticated) may require batching across multiple hours.

**Workaround:** Use `GITHUB_TOKEN` env var for authenticated API access
(5000 req/hour). The existence probe already uses this when available.

**Fix (not in scope this phase):** Implement batched verification with
token bucket rate limiting and resume-from-checkpoint for interrupted scans.
