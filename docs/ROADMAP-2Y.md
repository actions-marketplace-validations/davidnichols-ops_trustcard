# trustcard 2-year plan (2026-08 → 2028-08)

A dependency-gate plan, not a calendar plan. Each gate has a concrete acceptance test; a gate only "opens" when the previous gate is green. The goal is to make trustcard the **premium trust infrastructure for executable capabilities** — starting with MCP servers, but architecturally protocol-neutral.

This plan is grounded in the current state of the repo (v3.0.3) and in the values already baked into the code: content-addressed identity, fail-closed verification, signed provenance, TOFU continuity, two-gate enforcement, evidence-before-scores, and zero supply-chain dependencies.

## How I value trustcard

These values shape the priorities below.

1. **Identity is the scarce resource.** Any two parties can agree on *what a tool is* without trusting a registry, a namespace, or a UI. `toolDigest`, `toolsetDigest`, and `serverDigest` are that agreement. The plan protects and extends this, never dilutes it.
2. **Fail closed is a feature, not a bug.** Corrupt pins, expired manifests, missing signatures, and unverifiable claims all produce `deny` with a reason. Convenience never widens the trust boundary.
3. **Evidence beats scores.** The evidence store, receipts, and regression corpus are the source of truth. Scorecards and human labels are derived views.
4. **Additivity is compatibility.** v1 identity bytes are sacred. New layers (behavior, evidence, policy, attestation) are built beside the substrate, not through it.
5. **Honest containment.** The current sandbox is a *process harness*, not an OS jail. The plan pursues real containment only as an optional, truthfully-labeled backend. We do not market harness-level isolation as a security boundary.
6. **Protocol neutrality.** The descriptor/taxonomy/gate/receipt model is bigger than MCP. MCP remains the reference implementation and the richest test surface.
7. **No premature standards, no runtime lock-in, no registry monopoly.** We build a standard *after* the model has multi-domain adoption, not before.

## Current state (v3.0.3)

| Layer | Status | Files |
|---|---|---|
| Content-addressed identity + change taxonomy | mature | `lib/identity.js`, `lib/diff.js`, `lib/change.js` |
| Signed manifests + provenance + TOFU pins | mature | `lib/provenance.js`, `lib/pin.js` |
| Descriptor (protocol-neutral capability object) | mature | `lib/descriptor.js` |
| Two-gate enforcement (Gate 1 trust state, Gate 2 policy) | mature | `lib/guard.js`, `lib/policy.js`, `lib/trust.js` |
| Per-agent OAuth 2.1 auth scopes | mature | `lib/auth.js`, `bin/mcp-proxy.js` |
| Signed, chained receipts | mature | `lib/receipts.js` |
| Key rotation + revocation | mature | `lib/rotation.js` |
| Evidence substrate / observatory core | mature | `lib/evidence.js`, `lib/evidence-store.js`, `lib/evidence-adapters.js`, `bin/mcp-trustcard.js evidence` |
| Behavioral verification | newly landed | `lib/behavior.js`, `bin/mcp-trustcard.js behavior`, `test/fixtures/behavior-mem-server.js` |
| Registry integration pattern | defined | `docs/REGISTRY-INTEGRATION.md` |

The biggest remaining gap is **closing the loop**: behavior findings, policy decisions, and receipts should flow into the evidence store automatically, and the evidence store should drive an observable trust picture for operators and ecosystems.

## Year 1 (2026-08 → 2027-08): hardening and ecosystem integration

### Gate Y1-H1: Behavior → evidence bridge

*Acceptance test:* Running `mcp-trustcard behavior <manifest>` with `--evidence-dir` appends one or more evidence records per finding, and `mcp-trustcard evidence query --subject <server>` returns those findings with the same `id`/`digest` stability as other evidence.

- Add `behaviorToEvidence(report)` adapter in `lib/evidence-adapters.js`.
- Map divergence classes to evidence predicates (e.g. `behavior.prompt-injection-detected`, `behavior.canary-leaked`, `behavior.unexpected-network-attempt`).
- Preserve the regression corpus as a reproducibility payload inside the evidence record.
- Wire `BehaviorEngine` to optionally emit to an `EvidenceStore`.

### Gate Y1-H2: Observatory scheduler

*Acceptance test:* `mcp-trustcard observatory schedule --manifest <file> --every 1h --evidence-dir data/evidence` runs the behavior suite on a cron-like schedule and only appends new or contradictory evidence (idempotent re-runs produce no duplicate records).

- A lightweight scheduler in `bin/mcp-trustcard.js observatory` (or a separate `mcp-trustcard-observatory` CLI) that re-uses `BehaviorEngine` and `EvidenceStore`.
- Deduplication by evidence digest; contradictions are surfaced as new `supersedes` links.
- Human commands: `observatory status`, `observatory run-now`, `observatory contradictions`.

### Gate Y1-H3: HTTP/SSE transport parity

*Acceptance test:* `mcp-trustcard behavior` works against an MCP server over HTTP+SSE with the same divergence detection as stdio, and the policy/gate layer can proxy HTTP MCP calls with trust-state checks.

- Complete `lib/client-http.js` to cover initialize, tools/list, tools/call, and notifications.
- Add `transport` option to `SandboxRuntime` and `BehaviorEngine`.
- Ensure `mcp-proxy` can run in HTTP mode with auth scope enforcement.

### Gate Y1-H4: Real-world reference corpus

*Acceptance test:* A `corpus/official/` directory contains baseline `ReferenceObservation` JSON for `@modelcontextprotocol/server-memory`, `server-filesystem`, `server-github`, and at least two non-Anthropic community servers, all passing the benign behavioral run.

- Use `BehaviorEngine.captureReference()` to build the corpus.
- Version the corpus with the server's `toolsetDigest`.
- Provide `mcp-trustcard behavior diff corpus/official/<server>.json <target>` for A/B regression testing of package updates.

### Gate Y1-H5: Scoped trust graph (web-of-trust for relying parties)

*Acceptance test:* Three different "relying parties" (e.g. `prod-agent`, `dev-agent`, `ci-runner`) can pin different `toolsetDigest` values for the same capability and their decisions do not collide; a query can show per-party trust state.

- Extend `PinStore` keying from `serverDigest` → `(relyingPartyId, serverDigest/capabilityDigest)`.
- Keep backward-compatible default party (`_default`).
- Surface in `mcp-trustcard trust status --party <id>`.

## Year 1 H2 (2027-02 → 2027-08): scale and cross-domain proof

### Gate Y1-H6: Transparency-log profile

*Acceptance test:* A published `transparency-log.schema.json` and a `mcp-trustcard tl checkpoint` command produce a signed, hash-chained checkpoint over a set of evidence records. No log *service* is built; the profile is a spec + local tool.

- Re-use `lib/receipts.js` chain primitives.
- Define a minimal transparency-log entry format: `treeHash`, `epoch`, `evidenceDigests[]`, `signature`.
- Keep it optional; trustcard must work without it.

### Gate Y1-H7: Non-MCP adapter

*Acceptance test:* A local CLI tool (e.g. a shell script) is wrapped by `mcp-trustcard exec-gate --descriptor script.json -- ./run.sh`. The gate verifies the script's digest against the descriptor before executing, emits a receipt, and denies if the binary changed.

- Prove protocol-neutrality by adding an `execve` adapter with `H(binary)` as implementation identity.
- This is the second domain after MCP; it validates the substrate abstraction.

### Gate Y1-H8: Predicate registry + danger-detector v2

*Acceptance test:* External probe authors can `EVIDENCE_LAYERS.register(predicate, layer, schema)` at runtime; the built-in danger-detector recognizes 2× as many prompt-injection and exfiltration patterns without increasing false positives on the reference corpus.

- Move predicate vocabulary from a closed enum to a runtime registry with built-ins.
- Add adversarial test suite seeded from public prompt-injection datasets.
- Keep TF-IDF engine but make corpus loadable/overridable.

### Gate Y1-H9: Operator-facing status CLI

*Acceptance test:* `mcp-trustcard status --server <name>` prints: trust state, last observation timestamp, active findings, pending approvals, and a one-line recommended action.

- Aggregate evidence, behavior reports, receipts, and pin state into a single command.
- No web UI in core; the CLI is the source of truth.

## Year 2 (2027-08 → 2028-08): deep trust and standards

### Gate Y2-H1: Optional OS-level sandbox backend

*Acceptance test:* `mcp-trustcard behavior --sandbox chroot` (or similar flag) runs the MCP server in a minimal Linux namespace with no network, a read-only root, and a writable `/tmp`; the report's `capabilities` field truthfully reports `filesystem: "namespace-isolated"`, `network: "blocked-by-netns"`.

- Keep the Node stdio harness as the default (portable, no root).
- Add a `LinuxSandboxBackend` using `unshare`/`nsenter` or `bwrap` if installed.
- Do not claim the default sandbox is a security boundary.

### Gate Y2-H2: TEE / confidential-computing evidence

*Acceptance test:* When running on an attested confidential VM, `mcp-trustcard behavior` can include an `attestation` evidence record with a verifiable quote from the TEE provider; the record is *additive* and does not replace the behavioral findings.

- Support AMD SEV / Intel TDX / AWS Nitro Enclaves via their attestation documents.
- Treat TEE evidence as one more `layer` in the evidence store, not as a shortcut to trust.

### Gate Y2-H3: Syscall-level behavioral proof

*Acceptance test:* `mcp-trustcard behavior --trace` records a deterministic sequence of network/file/process syscalls for a probe run and flags divergence when a target server issues syscalls not present in the reference trace.

- Use `strace`/`ptrace` or eBPF for Linux; macOS/Windows fallback to coarser process events.
- Fuse with `OutputComparator` so the same `BehaviorFinding` can cite both output and syscall evidence.

### Gate Y2-H4: Delegation receipts

*Acceptance test:* Agent A can issue a scoped, time-bound, attenuable receipt that authorizes Agent B to call `read:*` tools on its behalf; the receipt is signed, chained, and `scopeSatisfies` validates attenuation.

- Explore Biscuit/macaroon-style caveats or a minimal home-grown attenuation syntax.
- Keep it optional and backward compatible with existing receipts.

### Gate Y2-H5: Evidence exchange protocol

*Acceptance test:* Two `EvidenceStore` instances can exchange a signed bundle of records and independently verify the digests and observer signatures; contradictions are surfaced with `supersedes` links.

- Define a minimal signed-bundle format.
- No central service; exchange is peer-to-peer (file, HTTP, or gossip).

### Gate Y2-H6: Standards-track preparation

*Acceptance test:* The descriptor, receipt, and evidence formats are documented in an IETF-style draft (Internet-Draft or W3C Note) and have at least one external implementation that can reproduce the same digests for a sample capability.

- Only pursue this after the non-MCP adapter (Y1-H7) proves protocol-neutrality.
- The goal is a *stable, implementable spec*, not ratification on a fixed date.

### Gate Y2-H7: Enterprise integrations

*Acceptance test:* trustcard can load policy bundles from HashiCorp Vault, AWS KMS, or a plain HSM-backed PKCS#11 module for publisher-key operations; no secrets appear in config files.

- `provenance.js` gains a pluggable key-store backend.
- `lib/auth.js` gains enterprise IdP connectors (SAML/OIDC) in addition to OAuth 2.1 introspection.

### Gate Y2-H8: Ecosystem sample100 → sample10,000

*Acceptance test:* A public, reproducible observatory run over 10,000 registry entries produces evidence records, with rate-limited GitHub/npm probing, resume-from-checkpoint, and a published contradiction report.

- Scale `existence.js` and `evidence-store.js` to large batches.
- Use transparency-log checkpoints to publish the resulting dataset.

## What this plan deliberately does not build

- **A trustcard-operated registry.** The registry is transport; trust lives in the client's pins and signatures.
- **An agent runtime or framework.** trustcard sits between the agent and the server; it does not own the agent.
- **A universal PKI.** TOFU + break-glass rotation is the right default for a decentralized ecosystem.
- **A social reputation score.** Scores are derived from evidence, not evidence from scores.
- **Behavioral proof as absolute safety.** Even Y2-H3 syscall tracing only observes what the probe triggered. The model stays "detect divergence, not absence of malice."

## Metrics of success at year 2

- **Adoption:** the descriptor/receipt format is used by at least one non-MCP domain.
- **Evidence volume:** the public observatory has emitted >1M verifiable evidence records.
- **Behavioral coverage:** >80% of top MCP registry servers have a baseline `ReferenceObservation` in the official corpus.
- **Compatibility:** all v1 identity bytes and receipts still verify unchanged.
- **Supply chain:** still zero runtime dependencies in `mcp-trustcard` core.

## Risks

1. **TEE / syscall work is OS-specific and fragile.** Mitigate by making every containment layer optional and truthfully labeled.
2. **Standardization stalls or forks.** Mitigate by shipping a working reference implementation before seeking standards bodies.
3. **Adoption requires ecosystem coordination.** Mitigate by keeping every feature optional and registry-agnostic; no breaking changes to existing manifests.
4. **Behavioral verification produces false positives.** Mitigate by keeping reference corpus open, versioned, and community-auditable; confidence levels are explicit.

## Summary

Year 1 closes the loop between runtime behavior and the evidence store, proves protocol-neutrality with a non-MCP adapter, and ships operator-friendly tooling. Year 2 goes deeper: OS containment, TEE evidence, syscall-level behavioral proof, delegation, and standards preparation. The through-line is the same one already in the code: **identity, evidence, fail-closed, additive**.
