// Evidence predicate vocabulary.
//
// The taxonomy is extensible, not exhaustive. The initial vocabulary covers
// predicates that existing probes can produce. New predicates are added as
// new probes are built. Unknown predicates are accepted by the store — the
// vocabulary is advisory metadata, not a gate.
//
// Each predicate has:
//   - layer (0-4): which evidence layer it belongs to
//   - valueType: the expected type of claim.value
//   - defaultConfidence: baseline confidence for the canonical observation method
//   - description: human-readable explanation
//
// Layers:
//   0 — Identity:     what is this thing, stably?
//   1 — Existence:    does it exist right now?
//   2 — Vitality:     is it maintained and responsive?
//   3 — Behavior:     does it do what it claims?
//   4 — Ecosystem:    what is its context in the network?

export const EVIDENCE_LAYERS = {
  0: "identity",
  1: "existence",
  2: "vitality",
  3: "behavior",
  4: "ecosystem",
};

export const LAYER_NAMES = Object.values(EVIDENCE_LAYERS);

// Subject kinds — what the observation is about.
export const SUBJECT_KINDS = [
  "capability-provider",
  "capability",
  "repository",
  "package",
  "publisher",
  "endpoint",
];

// Identifier strength classification.
// Used by the evidence store for subject matching precedence.
export const IDENTIFIER_STRENGTH = {
  // Cryptographic — cannot be forged without the private key
  keyId: "cryptographic",
  interfaceDigest: "cryptographic",
  serverDigest: "cryptographic",
  descriptorDigest: "cryptographic",
  npmIntegrity: "cryptographic",
  // Strong — immutable even through rename, but platform-specific
  repoId: "strong",
  ownerId: "strong",
  // Medium — can change ownership
  packageName: "medium",
  registryName: "medium",
  // Weak — breaks on rename/migration
  repoUrl: "weak",
  endpointUrl: "weak",
  ownerLogin: "weak",
};

export const STRENGTH_ORDER = { cryptographic: 3, strong: 2, medium: 1, weak: 0 };

// The predicate registry. Maps predicate names to their metadata.
// This is advisory — the evidence store accepts unknown predicates.
export const PREDICATES = {
  // ── Layer 0 — Identity ──────────────────────────────────────────
  "identifier-observed": {
    layer: 0,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "A new identifier was seen for this subject",
  },
  "identifier-changed": {
    layer: 0,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "An identifier changed (e.g. repo rename, key rotation)",
  },
  "publisher-key-rotated": {
    layer: 0,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "Publisher signing key changed",
  },
  "identity-merge-detected": {
    layer: 0,
    valueType: "object",
    defaultConfidence: 0.90,
    description: "Two subjects appear to be the same entity",
  },

  // ── Layer 1 — Existence ─────────────────────────────────────────
  "repository-resolves": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 1.0,
    description: "Repository URL returns HTTP 200",
  },
  "repository-not-found": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 0.95,
    description: "Repository URL returns HTTP 404",
  },
  "repository-redirected": {
    layer: 1,
    valueType: "object",
    defaultConfidence: 0.95,
    description: "Repository URL redirects to a different location",
  },
  "package-resolves": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 1.0,
    description: "Package exists in its registry (npm, PyPI, etc.)",
  },
  "package-not-found": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 0.95,
    description: "Package missing from its registry",
  },
  "package-yanked": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 1.0,
    description: "Package version exists but has been yanked/unpublished",
  },
  "endpoint-responds": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 0.95,
    description: "Server endpoint accepts connections",
  },
  "endpoint-unreachable": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 0.80,
    description: "Server endpoint refuses or times out",
  },
  "handshake-succeeds": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 0.95,
    description: "Protocol handshake completed successfully",
  },
  "handshake-fails": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 0.80,
    description: "Protocol handshake failed",
  },
  "version-resolves": {
    layer: 1,
    valueType: "boolean",
    defaultConfidence: 1.0,
    description: "Declared version exists in registry",
  },

  // ── Layer 2 — Vitality ──────────────────────────────────────────
  "last-push-observed": {
    layer: 2,
    valueType: "string",
    defaultConfidence: 1.0,
    description: "Repository had a push at the given time (ISO 8601)",
  },
  "release-published": {
    layer: 2,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "A new version was published",
  },
  "issue-opened": {
    layer: 2,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "An issue was opened in the repository",
  },
  "issue-closed": {
    layer: 2,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "An issue was closed in the repository",
  },
  "endpoint-uptime": {
    layer: 2,
    valueType: "object",
    defaultConfidence: 0.90,
    description: "Endpoint responded to N of M probes over a time window",
  },
  "protocol-version-current": {
    layer: 2,
    valueType: "boolean",
    defaultConfidence: 0.95,
    description: "Server uses the latest known protocol version",
  },
  "protocol-version-stale": {
    layer: 2,
    valueType: "object",
    defaultConfidence: 0.95,
    description: "Server uses an outdated protocol version",
  },
  "commit-activity": {
    layer: 2,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "Commit frequency over a time window",
  },

  // ── Layer 3 — Behavior ──────────────────────────────────────────
  "tools-exposed": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 0.95,
    description: "Server exposes N tools with schemas",
  },
  "schema-valid": {
    layer: 3,
    valueType: "string",
    defaultConfidence: 0.95,
    description: "Tool schema validates (value = tool name)",
  },
  "schema-invalid": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 0.95,
    description: "Tool schema fails validation",
  },
  "destructive-capability-detected": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 0.85,
    description: "Tool has destructive capability markers",
  },
  "injection-marker-detected": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 0.85,
    description: "Tool description contains prompt-injection patterns",
  },
  "capability-invoked": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 0.90,
    description: "Tool was called with test arguments",
  },
  "response-consistent": {
    layer: 3,
    valueType: "string",
    defaultConfidence: 0.85,
    description: "Repeated calls produce consistent response shape (value = tool name)",
  },
  "response-inconsistent": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 0.85,
    description: "Repeated calls produce inconsistent response shapes",
  },
  "toolset-changed": {
    layer: 3,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "Toolset differs from prior observation",
  },

  // ── Layer 4 — Ecosystem ─────────────────────────────────────────
  "publisher-concentration": {
    layer: 4,
    valueType: "object",
    defaultConfidence: 1.0,
    description: "Publisher has N servers (X% of registry)",
  },
  "dependency-observed": {
    layer: 4,
    valueType: "object",
    defaultConfidence: 0.90,
    description: "Server depends on a specific package",
  },
  "anomaly-detected": {
    layer: 4,
    valueType: "object",
    defaultConfidence: 0.75,
    description: "Publisher or server behavior deviates from baseline",
  },
  "schema-duplication": {
    layer: 4,
    valueType: "object",
    defaultConfidence: 0.90,
    description: "Multiple servers share identical tool schemas",
  },
};

// Look up predicate metadata. Returns null for unknown predicates
// (the vocabulary is advisory, not a gate).
export function predicateInfo(name) {
  return PREDICATES[name] ?? null;
}

// Check if a predicate is known to the vocabulary.
export function isKnownPredicate(name) {
  return name in PREDICATES;
}

// Get all predicates for a given layer.
export function predicatesByLayer(layer) {
  return Object.entries(PREDICATES)
    .filter(([, meta]) => meta.layer === layer)
    .map(([name]) => name);
}

// Register a new predicate at runtime (for external probes).
// Does not persist — the vocabulary file is the source of truth.
export function registerPredicate(name, meta) {
  if (!name || typeof name !== "string") throw new TypeError("predicate name must be a string");
  if (typeof meta !== "object" || meta === null) throw new TypeError("predicate metadata must be an object");
  if (typeof meta.layer !== "number" || meta.layer < 0 || meta.layer > 4)
    throw new RangeError("predicate layer must be 0-4");
  if (PREDICATES[name]) {
    // Don't silently overwrite — the vocabulary file is authoritative
    throw new Error(`predicate "${name}" is already registered`);
  }
  PREDICATES[name] = {
    layer: meta.layer,
    valueType: meta.valueType ?? "any",
    defaultConfidence: meta.defaultConfidence ?? 1.0,
    description: meta.description ?? "",
  };
}
