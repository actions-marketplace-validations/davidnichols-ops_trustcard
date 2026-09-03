# Trustcard Requirements Verification Boundary

**Date:** 2026-07-28
**Status:** Boundary memo — defines what Trustcard verifies vs what the registry declares
**Companion document:** `mcp_requirements_registry_proposal.md`

---

## Purpose

This memo answers one question:

> What does Trustcard verify that the registry should merely declare?

The objective is to prevent Trustcard from becoming a second registry. The
registry is a distribution point for publisher declarations. Trustcard is an
independent verifier that empirically tests those declarations. The two are
separate systems with separate trust properties, separate owners, and separate
failure modes.

---

## The boundary

### Registry — publisher declarations

The registry carries **what the publisher says**. These are claims, not facts.
They are publisher-authored, registry-stored, and client-consumed.

| Registry field | What it declares | Who writes it | Verified by registry? |
|---|---|---|---|
| `name` | Server identity | Publisher | Format validation only |
| `description` | What the server does | Publisher | No |
| `version` | Server version | Publisher | Format validation only |
| `packages[].environmentVariables` | Required env vars | Publisher | Structure validation only |
| `packages[].packageArguments` | Required CLI args | Publisher | Structure validation only |
| `packages[].transport` | Transport type | Publisher | Enum validation only |
| `remotes[].headers` | Required HTTP headers | Publisher | Structure validation only |
| `remotes[].url` | Endpoint URL | Publisher | URI format validation only |
| `repository.url` | Source code URL | Publisher | URI format validation only |
| `_meta.publisher-provided` | Arbitrary publisher metadata | Publisher | Size limit (4KB) only |

**None of these are verified by the registry.** The registry validates format,
not truth. A publisher can declare `environmentVariables` with `isRequired: true`
without the server actually requiring them. The registry will accept it.

### Trustcard — empirical verification

Trustcard verifies **what the server actually does**. These are observations,
not declarations. They are verifier-produced, evidence-backed, and
time-stamped.

| Trustcard verifies | How | Against what declaration | Evidence type |
|---|---|---|---|
| Protocol handshake | Connect and negotiate | N/A (negotiated at handshake, not declared) | OBSERVED |
| Installability | Launch with no args/env | `packages[].environmentVariables`, `packages[].packageArguments` | OBSERVED |
| Transport correctness | Connect via declared transport | `packages[].transport`, `remotes[].type` | OBSERVED |
| Endpoint reachability | HTTP probe to `remotes[].url` | `remotes[].url` | OBSERVED |
| Repository existence | GitHub API check | `repository.url` | OBSERVED |
| Tool schema validity | JSON Schema validation of `tools/list` | N/A (no registry equivalent) | OBSERVED |
| Destructive capability | 3-engine fusion on tool definitions | N/A (no registry equivalent) | OBSERVED (heuristic) |
| Auth gate detection | Connect without credentials | `packages[].environmentVariables`, `remotes[].headers` | OBSERVED |
| Tool definition drift | Compare current `tools/list` to pinned manifest | N/A (manifest is Trustcard's own artifact) | OBSERVED |
| Publisher signature | Ed25519 verification | `_meta.publisher-provided.io.github.davidnichols-ops.trustcard` | VERIFIED (cryptographic) |

---

## What Trustcard does NOT put in the registry

| Trustcard observation | Why it stays in Trustcard |
|---|---|
| Health score (0-100) | False precision; hides incompatible dimensions; gameable |
| Latency measurements | Too transient; environment-dependent |
| Failure rate | Too transient; environment-dependent |
| Danger analysis results | Heuristic, not factual; gameable if in registry |
| Trust state (UNKNOWN/OBSERVED/PINNED/MISMATCH/REVOKED) | Per-agent consumption-layer state |
| Evidence records (full) | Too detailed for registry; fetchable on demand |
| Gate 2 invocation policy | Per-relying-party authorization |
| Signed receipts | Per-call evidence |
| Contradiction flags | Should be publishable by any verifier, not just Trustcard |
| Freshness assessments | Consumer-defined, not registry-defined |

---

## The verification flow

```
REGISTRY                          TRUSTCARD
────────                          ──────────
Publisher declares:
  environmentVariables: [{API_KEY, isRequired}]
  transport: {type: "stdio"}
  repository: {url: "github.com/..."}
                                  Trustcard verifies:
                                    → Connect and negotiate protocol version
                                      OBSERVED: handshake succeeds with 2025-06-18
                                      (protocol version is negotiated at handshake,
                                       not declared in the registry)
                                    
                                    → Launch without API_KEY
                                      OBSERVED: server requires API_KEY
                                      MATCHES declaration
                                    
                                    → Launch with API_KEY
                                      OBSERVED: handshake succeeds
                                      CONFIRMS installability
                                    
                                    → Check GitHub repo
                                      OBSERVED: repo exists (200)
                                      MATCHES declaration
                                    
                                    → Enumerate tools
                                      OBSERVED: 14 tools, schemas valid
                                      NEW DATA (no registry equivalent)
                                    
                                    → Danger analysis
                                      OBSERVED: 2 tools flagged destructive
                                      NEW DATA (no registry equivalent)
                                    
                                    → Publish evidence records
                                      Stored in Trustcard's evidence store
                                      NOT in the registry
```

---

## The claim ladder

Trustcard uses a six-state claim ladder to distinguish what it knows:

| State | Meaning | Registry implication |
|---|---|---|
| DECLARED | Publisher says X | Registry carries X as a declaration |
| OBSERVED | Trustcard observed X at time T | Trustcard evidence record; not in registry |
| VERIFIED | Independent verifier reproduced X | Trustcard evidence record; not in registry |
| STALE | Observation was VERIFIED but is now old | Trustcard evidence record with timestamp; not in registry |
| CONTRADICTED | Observation disagrees with declaration | Trustcard evidence record; client may flag to user |
| UNKNOWN | No observation was made | No Trustcard evidence record; client treats declaration as unverified |

**The registry only ever carries DECLARED.** All other states are Trustcard
observations that live in Trustcard's evidence store.

---

## Why Trustcard must not become a second registry

### 1. Single point of failure

If Trustcard becomes the verification layer that the registry depends on, a
compromise or outage of Trustcard compromises the registry's trustworthiness.
Multiple independent verifiers (Trustcard, Circadian, siliroid, others) are
the mitigation. The registry should not depend on any single verifier.

### 2. Single instrument risk

The siliroid correction (14.4% → 12.3% after two measurement bugs) proves
that a single verifier can have systematic blind spots. If Trustcard is the
only verifier, its blind spots become the registry's blind spots. Multiple
independent verifiers with different methods are the mitigation.

### 3. Governance burden

If the registry carries verification results, it must answer: who is allowed
to be a verifier? How are conflicting results reconciled? What happens when
a verifier has a bug? These are hard governance questions that should not
block registry schema work.

### 4. Staleness

Verification results become stale immediately. If the registry carries
"verified at time T," it needs a freshness mechanism, a re-verification
schedule, and a way to handle stale results. This is infrastructure the
registry should not have to build.

### 5. Scope creep

If the registry carries verification results for protocol versions, it will
be asked to carry them for env vars, args, transport, repo existence, and
eventually behavioral testing. The registry becomes a runtime observability
database, which is a fundamentally different system with different
requirements.

---

## What Trustcard CAN do without becoming a registry

### 1. Publish evidence records

Trustcard's evidence store (`data/evidence/YYYY/MM/YYYY-MM-DD.jsonl`) is
public, append-only, and content-addressed. Any third party can download and
verify it. This is the Certificate Transparency model — the log is public,
not centralized.

### 2. Provide a verification API

Trustcard can expose an API that returns evidence records for a given server.
Clients can query this API at selection time to supplement the registry's
declarations with empirical observations. This is optional — clients that
don't know about Trustcard still get the registry's declarations.

### 3. Publish contradiction reports

When Trustcard observes that a server's behavior contradicts its registry
declaration, it publishes a contradiction evidence record. This is not in the
registry — it's in Trustcard's evidence store. Clients that check Trustcard
see the contradiction; clients that don't see only the declaration.

### 4. Provide a reference verifier

Trustcard can be the reference implementation for how to verify registry
declarations. Other verifiers can use the same evidence format, the same
claim ladder, and the same contradiction detection. This standardizes
verification without centralizing it.

### 5. Provide a signed manifest

The signed-manifest proposal (trustcard v2) is orthogonal to registry schema
work. It uses `_meta.publisher-provided` (which survives ingestion) to
carry a manifest URL, digest, and publisher key ID. The manifest itself lives
outside the registry. This is a separate proposal, not part of any registry
schema addition.

---

## The separation principle

```
REGISTRY                          TRUSTCARD
────────                          ──────────
Publisher declarations            Empirical observations
Static metadata                   Time-stamped evidence
Format-validated                  Method-documented
Single source                     Multiple independent verifiers possible
No trust claims                   Claim ladder (DECLARED → OBSERVED → VERIFIED)
No scores                         No scores in registry (Trustcard has internal scorecard)
No runtime data                   Runtime data stays in evidence store
```

**The registry declares. Trustcard verifies. They do not merge.**

---

## Concrete boundary rules

1. **Trustcard does not write to the registry.** Trustcard reads registry
   declarations and produces evidence records. The evidence records live in
   Trustcard's store, not in the registry.

2. **The registry does not depend on Trustcard.** The existing registry
   fields (`environmentVariables`, `packageArguments`, `transport`, etc.)
   are useful without Trustcard. Clients that don't know about Trustcard
   still benefit from the declarations.

3. **Trustcard's evidence format is public and portable.** Other verifiers
   can produce evidence in the same format without using Trustcard's code.
   The format is defined in `PHASE-2.5-EVIDENCE-DESIGN.md`.

4. **Contradictions are published, not silently corrected.** If Trustcard
   observes that a server's behavior contradicts its registry declarations
   (e.g., declared env var not actually required, declared transport not
   actually supported), it publishes a `CONTRADICTED` evidence record. It
   does not modify the registry entry. The registry continues to carry the
   publisher's declaration.

5. **The signed manifest is optional and separate.** A publisher can
   declare existing registry fields without publishing a signed manifest.
   A publisher can publish a signed manifest without any particular
   registry declaration. The two are independent.

6. **Trustcard's internal score is not standardized.** The scanner's
   scorecard (0-100) is a convenience for CLI output. It is not proposed for
   the registry, not standardized, and not part of any upstream proposal.

---

## Summary

| Question | Answer |
|---|---|
| What does the registry declare? | Publisher-authored metadata: name, version, env vars, args, transport, headers, repo URL |
| What does Trustcard verify? | Empirical observations: handshake, installability, transport, endpoint, repo existence, tool schemas, danger, drift, signatures |
| Where do verification results live? | In Trustcard's evidence store, not in the registry |
| Can the registry depend on Trustcard? | No — Trustcard is a reference verifier, not a prerequisite |
| Can other verifiers exist? | Yes — the evidence format is public and portable |
| What happens when declaration and observation disagree? | Trustcard publishes a CONTRADICTED evidence record; the registry entry is unchanged |
| Does Trustcard put scores in the registry? | No — scores are internal convenience only |
| Does Trustcard put runtime data in the registry? | No — latency, failure rate, behavioral data stay in evidence store |
| Is the signed manifest part of the registry proposal? | No — it's a separate proposal using `publisher-provided` |
