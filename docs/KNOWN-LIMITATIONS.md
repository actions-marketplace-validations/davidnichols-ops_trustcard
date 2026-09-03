# Known Limitations

This document lists the residual gaps and honest non-goals of trustcard v3.0.3.
These are not bugs to be silently fixed; they are boundary conditions that
shape what trustcard can and cannot promise.

## 1. Behavioral verification is probe-bounded

`lib/behavior.js` runs a deterministic, seeded set of probes. It can prove that
a server diverges from a reference on those probes; it cannot prove that a
server will behave correctly on every possible input.

- A server can pass every probe and still misbehave on a real user input.
- Probes are generated from schema and heuristics; they do not exhaust the
  input space of arbitrary JSON schemas.
- Reference observations are snapshots, not contracts. A malicious reference
  makes the comparison meaningless.

See `docs/BEHAVIOR.md` for the full trust model.

## 2. The default sandbox is a harness, not an OS jail

`SandboxRuntime` launches the server as a stdio child process with a fresh `cwd`,
minimal environment, and stdout/stderr capture. It does **not** block network
egress, filesystem access, or subprocess spawning at the OS level.

- Capability labels on reports are truthful: `network: "not-observed"` means the
  harness only sees URLs in output/stderr, not that egress is impossible.
- `filesystem: "cwd-isolated"` means the server starts in a temp directory, not
  that it is confined there.
- `subprocesses: "stderr-only"` means child process events are inferred from
  stderr text, not from syscall interception.

A future OS-level sandbox backend (roadmap Y2-H1) will be optional and
truthfully labeled.

## 3. Pattern-based injection detection

`lib/danger-detector.js` matches known prompt-injection markers and suspicious
phrases. Novel injection techniques that avoid those markers will pass through.
The detector is not semantic — it does not understand intent, only patterns.

## 4. Danger-detector static analysis cannot catch hidden behavior

A tool can declare a benign description and schema, then perform a malicious
action when called. Static analysis of the declaration does not observe runtime
behavior. Use behavioral verification (`mcp-trustcard behavior`) and least-privilege
runtime environments for defense in depth.

## 5. Evidence store is local by default

`lib/evidence-store.js` persists records to a local directory. There is no built-in
replication, gossip, or central registry. The evidence exchange protocol is on
the roadmap (Y2-H5). Until then, sharing evidence is a manual file/HTTP transfer.

## 6. Non-GitHub repository URLs produce null-value evidence

`lib/existence.js` verifies npm packages and GitHub repositories. Non-GitHub
repository URLs (GitLab, Bitbucket, generic URLs) are not parsed or probed, so
the evidence adapter emits `repository-resolves` with `value: null` and
`confidence: 0.0`. These records are technically correct ("we tried and could
not determine") but add noise when querying for definitive observations.

## 7. Non-npm servers emit limited package evidence

Servers distributed via GitHub releases, direct download, PyPI, or other
registries produce no `package-resolves` or `package-not-found` records because
`lib/existence.js` only queries the npm registry. This is a probe gap, not a
false negative.

## 8. GitHub API rate limiting

The existence probe calls the GitHub API without authenticated rate-limit
reservations beyond a 150 ms delay. Unauthenticated access is limited to 60
requests/hour; authenticated (`GITHUB_TOKEN`) access is 5000/hour. Large
ecosystem scans are slow and may require batching and resume-from-checkpoint.

## 9. TOCTOU is only fully closed for cooperating servers

A server that does not bind a `toolsetDigest` in its `initialize` response and
does not emit `notifications/tools/list_changed` can mutate tools between
discovery and call. trustcard bounds this residual window with strict argument
validation and receipts, but does not eliminate it.

## 10. Auth scope enforcement is proxy-layer only

`lib/auth.js` validates bearer tokens at the `mcp-proxy`/`mcp-http-proxy` layer
and strips auth metadata before forwarding. If the proxy is bypassed, the server
receives unauthenticated requests. The server must still implement its own
authorization for direct connections.

## 11. Signed receipts require a key

`lib/receipts.js` signs and chains receipts only when the guard is configured
with a `receiptKey`. Without it, the guard emits the v1 unsigned receipt
byte-for-byte. Receipt verification (`verifyReceipt`) is structural; cryptographic
verification requires `verifyReceiptSignature(receipt, publicKey)`.

## 12. Capability descriptors are additive and not yet widely adopted

`lib/descriptor.js` defines a protocol-neutral descriptor, but the ecosystem
still mostly uses v1 manifests. Descriptor conversion (`manifestToDescriptors`,
`descriptorsToManifestTools`) is lossless and preserves `toolDigest` bytes, so
the transition is safe but not automatic.

## What these limitations mean in practice

trustcard is a trust-and-evidence layer, not a sandbox or an AI safety system.
Deploy it alongside:

- OS-level containment (containers, seccomp, network namespaces) for runtime
  isolation.
- Least-privilege credentials and secret management.
- Code auditing and supply-chain scanning.
- Human review of description diffs, policy overrides, and behavioral findings.
