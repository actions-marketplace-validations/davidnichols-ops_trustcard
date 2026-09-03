# Roadmap: trustcard as the premier trust infrastructure for AI infrastructure

The repository already contains a protocol-neutral capability descriptor and the cryptographic substrate to bind interface, implementation, and provenance. The path to becoming the premier trust layer for AI infrastructure is to make that substrate usable for *any* AI infra component (MCP servers today, OpenAPI/REST/gRPC model endpoints next) and to expose it as a runtime service that agents can query before they call anything.

## Milestones

### M1 — Capability descriptor CLI (`mcp-trustcard descriptor`)
Make the protocol-neutral descriptor a first-class citizen of the command-line toolkit.
- `descriptor build`  — build a descriptor from a tool JSON or a live manifest.
- `descriptor sign`   — sign a descriptor with an Ed25519 publisher key.
- `descriptor verify` — verify signature, digest, and embedded interface consistency.
- `descriptor diff`   — compare two descriptors with the multi-axis change vector.
- `descriptor pin`    — TOFU-pin a descriptor by content address.

This milestone lets an operator turn a single AI tool or model endpoint into a signed, content-addressed trust object without changing the rest of the stack.

### M2 — Multi-protocol identity adapters
Extend the descriptor to other AI infrastructure surfaces:
- OpenAPI operation → capability descriptor (path/method as namespace, request/response schema as interface).
- gRPC method → descriptor.
- Plain function signature → descriptor.
- A common `adapter` CLI so `mcp-trustcard descriptor build --from openapi --spec api.json` works.

M2 is what turns trustcard from an MCP tool into a general trust substrate for AI infra.

### M3 — trustcard as an MCP server (`mcp-trustcard serve`)
Expose the trust primitives as an MCP server that an AI agent can call at runtime:
- `verify_descriptor`
- `diff_descriptor`
- `query_pins`
- `sign_evidence`
- `issue_auth_token`

This makes trust decisions part of the agent's own tool surface, not just a pre-flight CLI step.

### M4 — Continuous observatory and evidence network
Build the substrate for a public trust card network:
- Periodic re-probe, re-diff, and evidence recording.
- Content-addressed evidence exchange between observers.
- Reputation graph over publishers and descriptors.
- Optional registry API for publishing signed descriptors and evidence bundles.

## Status

M1 is in progress. The existing test suite (`npm test`) must remain green after every milestone.
