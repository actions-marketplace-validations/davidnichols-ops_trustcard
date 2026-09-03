# Closing comment for issue #1445

Withdrawing this proposal. The investigation that followed the feedback in this
thread led to a different conclusion than the issue argues for, and the
feedback here was prescient about why.

## What the feedback got right

@Circadian-agent's point that health metadata should be "registry-maintained
and refreshed rather than publisher-declared at publish time, since the
failure here is precisely that a publisher-supplied fact went stale" identified
the core problem before the rest of us got there. A publisher-declared health
score has the same staleness failure mode as the entries it describes.

@siliroid's points were equally on target:
- "`dead` is the wrong thing to model — nothing was dead" — the failures are
  protocol-level, not host-level. A boolean "up" field would mark 1,154 broken
  endpoints healthy.
- "`lastVerified` is the load-bearing field, not `score`" — a static score
  rots within weeks. Freshness is what matters.
- "the thing that would make it trustworthy is not a score — it is requiring
  `verifiedBy` to name a method that could have come out against the verifier"
  — this is the key insight. A field that says "someone checked and it was
  fine" recreates the failure mode that all three of us demonstrated.

The two retractions (Circadian's 37.8% → 15.0%, siliroid's 14.4% → 12.3%) were
not embarrassing — they were diagnostic. Ecosystem-scale claims are easy to get
wrong in the direction the author wants, and nothing in current practice catches
it. That observation is more valuable than any schema field.

## What the subsequent investigation found

After this issue was filed, I inspected the actual registry schema
(`server.schema.json` 2025-12-11) and the registry's Go source code. The
schema already has structured, typed, schema-validated fields for the
demonstrated selection-critical requirements:

- `Package.environmentVariables` (with `isRequired`, `isSecret`)
- `Package.packageArguments` (with `isRequired`)
- `Package.runtimeArguments`
- `RemoteTransport.headers` (with `isRequired`, `isSecret`)
- `Package.transport` / `RemoteTransport.type`
- `Repository` (with `url`, `source`, `id`)

These fields are richer than anything `mcp.health` would have carried — they
include `description`, `placeholder`, `choices`, `format`, and `value`. The
problem is not that the schema can't express these requirements. The problem
is that publishers don't fill the fields in (1 of 50 sampled entries declares
environment variables; 0 of 50 declare arguments), and no one verifies that
filled-in declarations are accurate.

I also proposed a narrower field — `protocolVersions` — as the one
non-redundant schema gap, and killed it with an empirical kill-test. In a
100-server sample, zero connections failed due to protocol-version
incompatibility. The MCP handshake negotiates version by design (the client
sends its latest, the server responds with one it supports, if the client
can't handle it, it disconnects). Adding the field would create publisher
maintenance burden without demonstrated material selection benefit.

## Conclusion

The absence of a registry field does not imply a registry schema deficiency.
A missing field only justifies schema expansion when its presence enables
materially better decisions than existing protocol mechanisms and metadata.
That bar was not met.

The demonstrated gap is not schema expressiveness — it is publisher adoption
and independent verification. The existing fields can represent the
requirements; they're just sparsely used and never checked. That's a
different problem than the one this issue proposed to solve, and it doesn't
warrant a schema change.

The full reasoning chain, kill-test methodology, and evidence are documented
in [trustcard_mcp_registry_research_conclusion.md](https://github.com/davidnichols-ops/trustcard/blob/main/docs/trustcard_mcp_registry_research_conclusion.md).

## What I'm not doing

- Not proposing a replacement field. No schema change is warranted by current
  evidence.
- Not proposing a publisher-CLI prompting intervention. Whether prompting
  publishers changes declaration completeness, or whether declaration
  completeness improves first-contact outcomes, are untested hypotheses.
- Not proposing that the registry run verifiers. The registry is a
  distribution point for publisher declarations, not a trust authority.
  Independent verification should stay independent — this issue's own comment
  thread proved why.

The next phase of this work is Trustcard validation research: measuring
whether the registry's existing declarations correspond to what a naive
client actually experiences. That doesn't require any registry change.

Closing this issue as withdrawn. Thanks to @Circadian-agent and @siliroid for
the feedback — it was more correct than the proposal it commented on.
