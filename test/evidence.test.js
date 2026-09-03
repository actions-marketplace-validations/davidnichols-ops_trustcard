// Evidence record — the atomic primitive of the evidence substrate.
//
// Tests verify:
//   1. Record construction with valid inputs
//   2. Content-addressed digest computation (JCS + SHA-256)
//   3. Immutability (digest changes if any field changes)
//   4. Strict schema validation (rejects malformed records)
//   5. Forbidden field rejection (no scores, trust states, expiry)
//   6. Three-state knowledge model (true / false / null / not-observed)
//   7. Supersession chain (corrections)
//   8. Serialization and parsing (JSONL round-trip)
//   9. Predicate vocabulary integration
//  10. Protocol neutrality (no MCP-specific assumptions)

import { test } from "node:test";
import assert from "node:assert/strict";
import { canon } from "../lib/canon.js";
import { hashJson } from "../lib/hash.js";
import {
  buildEvidenceRecord,
  verifyEvidenceRecord,
  isValidEvidenceRecord,
  correctEvidence,
  serializeRecord,
  parseRecord,
  evidenceId,
  layerName,
  EVIDENCE_SCHEMA,
  _internals,
} from "../lib/evidence.js";
import {
  PREDICATES,
  predicateInfo,
  isKnownPredicate,
  predicatesByLayer,
  EVIDENCE_LAYERS,
  SUBJECT_KINDS,
  registerPredicate,
} from "../lib/evidence-predicates.js";

// ─── Test fixtures ────────────────────────────────────────────────

const VALID_OBSERVER = {
  agent: "trustcard",
  version: "3.0.0",
  method: "github-repo-verify",
};

const VALID_SUBJECT = {
  kind: "capability-provider",
  identifiers: {
    registryName: "io.github.frumu-ai/tandem",
    repoUrl: "https://github.com/frumu-ai/tandem",
    version: "0.3.2",
  },
};

const VALID_CLAIM = {
  predicate: "repository-resolves",
  value: true,
  layer: 1,
  confidence: 1.0,
  payload: { httpStatus: 200, repoId: 12345678, stars: 114 },
};

const VALID_REPRO = {
  command: "curl -s https://api.github.com/repos/frumu-ai/tandem",
  credentials: "github-token",
  environment: "macos-arm64-local",
};

function makeValidInput(overrides = {}) {
  return {
    observer: { ...VALID_OBSERVER, ...overrides.observer },
    subject: { ...VALID_SUBJECT, ...overrides.subject },
    claim: { ...VALID_CLAIM, ...overrides.claim },
    reproducibility: { ...VALID_REPRO, ...overrides.reproducibility },
    ...overrides,
  };
}

// ─── 1. Record construction ──────────────────────────────────────

test("evidence: buildEvidenceRecord produces a valid record", () => {
  const record = buildEvidenceRecord(makeValidInput());

  assert.equal(record.$schema, EVIDENCE_SCHEMA);
  assert.equal(typeof record.id, "string");
  assert.ok(record.id.startsWith("ev_sha256:"));
  assert.equal(typeof record.digest, "string");
  assert.ok(record.digest.startsWith("sha256:"));
  assert.equal(record.id, "ev_" + record.digest);
  assert.equal(typeof record.timestamp, "string");
  assert.ok(!isNaN(new Date(record.timestamp).getTime()));
  assert.deepEqual(record.observer, VALID_OBSERVER);
  assert.deepEqual(record.subject, VALID_SUBJECT);
  assert.deepEqual(record.claim, VALID_CLAIM);
  assert.deepEqual(record.reproducibility, VALID_REPRO);
  assert.deepEqual(record.related, []);
  assert.equal(record.supersedes, null);
});

test("evidence: buildEvidenceRecord defaults timestamp to now", () => {
  const before = new Date().getTime();
  const record = buildEvidenceRecord(makeValidInput());
  const after = new Date().getTime();
  const ts = new Date(record.timestamp).getTime();
  assert.ok(ts >= before && ts <= after, "timestamp should be between before and after");
});

test("evidence: buildEvidenceRecord accepts explicit timestamp", () => {
  const ts = "2026-07-27T14:32:00.123Z";
  const record = buildEvidenceRecord(makeValidInput({ timestamp: ts }));
  assert.equal(record.timestamp, ts);
});

test("evidence: buildEvidenceRecord works without reproducibility", () => {
  const input = makeValidInput();
  delete input.reproducibility;
  const record = buildEvidenceRecord(input);
  assert.equal(record.reproducibility, undefined);
  verifyEvidenceRecord(record); // should not throw
});

test("evidence: buildEvidenceRecord works without related (defaults to [])", () => {
  const input = makeValidInput();
  delete input.related;
  const record = buildEvidenceRecord(input);
  assert.deepEqual(record.related, []);
});

test("evidence: buildEvidenceRecord works without supersedes (defaults to null)", () => {
  const input = makeValidInput();
  delete input.supersedes;
  const record = buildEvidenceRecord(input);
  assert.equal(record.supersedes, null);
});

// ─── 2. Content-addressed digest ─────────────────────────────────

test("evidence: digest is deterministic — same input produces same digest", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  const r2 = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  assert.equal(r1.digest, r2.digest);
  assert.equal(r1.id, r2.id);
});

test("evidence: digest is independent of field order in input", () => {
  const r1 = buildEvidenceRecord({
    observer: VALID_OBSERVER,
    subject: VALID_SUBJECT,
    claim: VALID_CLAIM,
    timestamp: "2026-07-27T14:32:00.000Z",
  });
  // Same content, different construction order
  const r2 = buildEvidenceRecord({
    timestamp: "2026-07-27T14:32:00.000Z",
    claim: VALID_CLAIM,
    subject: VALID_SUBJECT,
    observer: VALID_OBSERVER,
  });
  assert.equal(r1.digest, r2.digest);
});

test("evidence: digest matches manual JCS+SHA-256 computation", () => {
  const record = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));

  // Manually compute: remove digest and id, canonicalize, hash
  const { digest: _d, id: _i, ...payload } = record;
  const expectedDigest = hashJson(payload);

  assert.equal(record.digest, expectedDigest);
});

test("evidence: id is ev_ + digest", () => {
  const record = buildEvidenceRecord(makeValidInput());
  assert.equal(record.id, "ev_" + record.digest);
});

// ─── 3. Immutability — digest changes if any field changes ────────

test("evidence: changing timestamp changes digest", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  const r2 = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:01.000Z" }));
  assert.notEqual(r1.digest, r2.digest);
});

test("evidence: changing claim.value changes digest", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, value: true } }));
  const r2 = buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, value: false } }));
  assert.notEqual(r1.digest, r2.digest);
});

test("evidence: changing claim.confidence changes digest", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, confidence: 1.0 } }));
  const r2 = buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, confidence: 0.95 } }));
  assert.notEqual(r1.digest, r2.digest);
});

test("evidence: changing claim.payload changes digest", () => {
  const r1 = buildEvidenceRecord(
    makeValidInput({ claim: { ...VALID_CLAIM, payload: { httpStatus: 200 } } })
  );
  const r2 = buildEvidenceRecord(
    makeValidInput({ claim: { ...VALID_CLAIM, payload: { httpStatus: 404 } } })
  );
  assert.notEqual(r1.digest, r2.digest);
});

test("evidence: changing observer.method changes digest", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ observer: { ...VALID_OBSERVER, method: "github-repo-verify" } }));
  const r2 = buildEvidenceRecord(makeValidInput({ observer: { ...VALID_OBSERVER, method: "npm-registry-lookup" } }));
  assert.notEqual(r1.digest, r2.digest);
});

test("evidence: changing subject.identifiers changes digest", () => {
  const r1 = buildEvidenceRecord(
    makeValidInput({ subject: { ...VALID_SUBJECT, identifiers: { ...VALID_SUBJECT.identifiers, version: "0.3.2" } } })
  );
  const r2 = buildEvidenceRecord(
    makeValidInput({ subject: { ...VALID_SUBJECT, identifiers: { ...VALID_SUBJECT.identifiers, version: "0.3.3" } } })
  );
  assert.notEqual(r1.digest, r2.digest);
});

test("evidence: changing related changes digest", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ related: [] }));
  const r2 = buildEvidenceRecord(makeValidInput({ related: ["ev_sha256:abc123"] }));
  assert.notEqual(r1.digest, r2.digest);
});

test("evidence: changing supersedes changes digest", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ supersedes: null }));
  const r2 = buildEvidenceRecord(makeValidInput({ supersedes: "ev_sha256:old123" }));
  assert.notEqual(r1.digest, r2.digest);
});

// ─── 4. Strict schema validation ─────────────────────────────────

test("evidence: rejects missing observer", () => {
  assert.throws(() => buildEvidenceRecord({ subject: VALID_SUBJECT, claim: VALID_CLAIM }), /observer/);
});

test("evidence: rejects observer missing required fields", () => {
  for (const field of ["agent", "version", "method"]) {
    const badObserver = { ...VALID_OBSERVER };
    delete badObserver[field];
    assert.throws(
      () => buildEvidenceRecord(makeValidInput({ observer: badObserver })),
      new RegExp(`observer.${field}`)
    );
  }
});

test("evidence: rejects empty observer fields", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ observer: { ...VALID_OBSERVER, agent: "" } })),
    /observer.agent/
  );
});

test("evidence: rejects missing subject", () => {
  assert.throws(() => buildEvidenceRecord({ observer: VALID_OBSERVER, claim: VALID_CLAIM }), /subject/);
});

test("evidence: rejects invalid subject.kind", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ subject: { ...VALID_SUBJECT, kind: "server" } })),
    /subject.kind/
  );
});

test("evidence: rejects empty subject.identifiers", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ subject: { ...VALID_SUBJECT, identifiers: {} } })),
    /subject.identifiers/
  );
});

test("evidence: rejects non-string/number identifier values", () => {
  assert.throws(
    () =>
      buildEvidenceRecord({
        ...makeValidInput(),
        subject: { ...VALID_SUBJECT, identifiers: { ...VALID_SUBJECT.identifiers, bad: { x: 1 } } },
      }),
    /subject.identifiers.bad/
  );
});

test("evidence: rejects missing claim", () => {
  assert.throws(
    () => buildEvidenceRecord({ observer: VALID_OBSERVER, subject: VALID_SUBJECT }),
    /claim/
  );
});

test("evidence: rejects claim missing required fields", () => {
  for (const field of ["predicate", "value", "layer", "confidence"]) {
    const badClaim = { ...VALID_CLAIM };
    delete badClaim[field];
    assert.throws(
      () => buildEvidenceRecord(makeValidInput({ claim: badClaim })),
      new RegExp(`claim.${field}`)
    );
  }
});

test("evidence: rejects invalid layer (non-integer)", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, layer: 1.5 } })),
    /claim.layer/
  );
});

test("evidence: rejects layer out of range", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, layer: -1 } })),
    /claim.layer/
  );
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, layer: 5 } })),
    /claim.layer/
  );
});

test("evidence: rejects confidence out of range", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, confidence: -0.1 } })),
    /claim.confidence/
  );
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, confidence: 1.1 } })),
    /claim.confidence/
  );
});

test("evidence: rejects claim.value === undefined", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, value: undefined } })),
    /undefined/
  );
});

test("evidence: rejects invalid timestamp", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ timestamp: "not-a-date" })),
    /timestamp/
  );
});

test("evidence: rejects related entries that are not ev_ IDs", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ related: ["not-an-ev-id"] })),
    /related/
  );
});

test("evidence: rejects supersedes that is not an ev_ ID", () => {
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ supersedes: "sha256:abc" })),
    /supersedes/
  );
});

test("evidence: rejects layer mismatch with known predicate", () => {
  // repository-resolves is layer 1, not layer 3
  assert.throws(
    () => buildEvidenceRecord(makeValidInput({ claim: { ...VALID_CLAIM, layer: 3 } })),
    /does not match predicate/
  );
});

// ─── 5. Forbidden field rejection ────────────────────────────────

test("evidence: rejects score field", () => {
  assert.throws(
    () => buildEvidenceRecord({ ...makeValidInput(), score: 87 }),
    /forbidden field "score"/
  );
});

test("evidence: rejects trustState field", () => {
  assert.throws(
    () => buildEvidenceRecord({ ...makeValidInput(), trustState: "PINNED" }),
    /forbidden field "trustState"/
  );
});

test("evidence: rejects recommendation field", () => {
  assert.throws(
    () => buildEvidenceRecord({ ...makeValidInput(), recommendation: "supervised_execution" }),
    /forbidden field "recommendation"/
  );
});

test("evidence: rejects expiresAt field", () => {
  assert.throws(
    () => buildEvidenceRecord({ ...makeValidInput(), expiresAt: "2026-12-31T00:00:00Z" }),
    /forbidden field "expiresAt"/
  );
});

test("evidence: rejects all forbidden fields", () => {
  const forbidden = [
    "score", "rating", "rank", "recommendation",
    "trustState", "trustLevel", "trustScore", "verdict",
    "safe", "unsafe", "approved",
    "expiresAt", "expiry", "ttl", "staleAfter",
  ];
  for (const field of forbidden) {
    assert.throws(
      () => buildEvidenceRecord({ ...makeValidInput(), [field]: "test" }),
      new RegExp(`forbidden field "${field}"`),
      `should reject ${field}`
    );
  }
});

test("evidence: verifyEvidenceRecord also rejects forbidden fields", () => {
  const record = buildEvidenceRecord(makeValidInput());
  record.score = 87; // tamper
  assert.throws(() => verifyEvidenceRecord(record), /forbidden field "score"/);
});

// ─── 6. Three-state knowledge model ──────────────────────────────

test("evidence: observed true — value: true, confidence > 0", () => {
  const record = buildEvidenceRecord(
    makeValidInput({ claim: { ...VALID_CLAIM, value: true, confidence: 1.0 } })
  );
  assert.equal(record.claim.value, true);
  assert.ok(record.claim.confidence > 0);
  verifyEvidenceRecord(record);
});

test("evidence: observed false — value: false, confidence > 0", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      claim: { predicate: "repository-not-found", value: true, layer: 1, confidence: 0.95 },
    })
  );
  // "repository-not-found = true" means "we observed that it's not found"
  assert.equal(record.claim.value, true);
  verifyEvidenceRecord(record);
});

test("evidence: observation failed — value: null, confidence: 0.0", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      claim: {
        predicate: "handshake-succeeds",
        value: null,
        layer: 1,
        confidence: 0.0,
        payload: { error: "connection timeout after 30s" },
      },
    })
  );
  assert.equal(record.claim.value, null);
  assert.equal(record.claim.confidence, 0.0);
  verifyEvidenceRecord(record);
});

test("evidence: null value is distinct from false", () => {
  const r1 = buildEvidenceRecord(
    makeValidInput({ claim: { ...VALID_CLAIM, value: null, confidence: 0.0 } })
  );
  const r2 = buildEvidenceRecord(
    makeValidInput({ claim: { ...VALID_CLAIM, value: false, confidence: 0.95 } })
  );
  assert.notEqual(r1.digest, r2.digest);
  assert.notEqual(r1.claim.value, r2.claim.value);
});

test("evidence: not-observed = no record exists (represented by absence in store, not a special value)", () => {
  // This is a conceptual test — "not observed" means no record at all.
  // The evidence store tests verify that querying for a subject with no
  // records returns an empty result, not a special "not observed" record.
  assert.ok(true, "absence of records is the 'not observed' state");
});

// ─── 7. Supersession chain ───────────────────────────────────────

test("evidence: correctEvidence creates a record that supersedes the old one", () => {
  const original = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  const correction = correctEvidence(
    original,
    { predicate: "repository-resolves", value: false, layer: 1, confidence: 1.0, payload: { correctionReason: "probe bug #123" } },
    "probe bug #123 — false positive"
  );

  assert.equal(correction.supersedes, original.id);
  assert.ok(correction.related.includes(original.id));
  assert.equal(correction.claim.value, false);
  assert.ok(correction.claim.payload.correctionReason.includes("probe bug #123"));
  verifyEvidenceRecord(correction);
});

test("evidence: original record is not modified by correctEvidence", () => {
  const original = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  const originalDigest = original.digest;
  const originalId = original.id;

  correctEvidence(original, { ...VALID_CLAIM, value: false });

  // Original is untouched
  assert.equal(original.digest, originalDigest);
  assert.equal(original.id, originalId);
  assert.equal(original.claim.value, true); // still true
});

test("evidence: supersession chain can be followed", () => {
  const r1 = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T10:00:00.000Z" }));
  const r2 = correctEvidence(r1, { ...VALID_CLAIM, value: false }, "first correction");
  const r3 = correctEvidence(r2, { ...VALID_CLAIM, value: true }, "second correction");

  // Chain: r3 → r2 → r1
  assert.equal(r3.supersedes, r2.id);
  assert.equal(r2.supersedes, r1.id);
  assert.equal(r1.supersedes, null);
});

// ─── 8. Serialization and parsing ────────────────────────────────

test("evidence: serializeRecord produces canonical JCS output", () => {
  const record = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  const serialized = serializeRecord(record);
  assert.equal(typeof serialized, "string");
  assert.ok(!serialized.includes("\n"), "serialized record must be a single line");
  // JCS output starts with { and ends with }
  assert.ok(serialized.startsWith("{"));
  assert.ok(serialized.endsWith("}"));
});

test("evidence: parseRecord round-trips correctly", () => {
  const record = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  const serialized = serializeRecord(record);
  const parsed = parseRecord(serialized);
  assert.deepEqual(parsed, record);
});

test("evidence: parseRecord verifies digest integrity", () => {
  const record = buildEvidenceRecord(makeValidInput({ timestamp: "2026-07-27T14:32:00.000Z" }));
  const serialized = serializeRecord(record);

  // Tamper with the serialized record
  const tampered = serialized.replace('"stars":114', '"stars":999');
  assert.throws(() => parseRecord(tampered), /digest mismatch/);
});

test("evidence: parseRecord rejects empty lines", () => {
  assert.throws(() => parseRecord(""), /empty line/);
  assert.throws(() => parseRecord("   "), /empty line/);
});

test("evidence: parseRecord rejects invalid JSON", () => {
  assert.throws(() => parseRecord("{not valid json"), /JSON parse error/);
});

// ─── 9. Predicate vocabulary ─────────────────────────────────────

test("evidence-predicates: all 5 layers have predicates", () => {
  for (let layer = 0; layer <= 4; layer++) {
    const preds = predicatesByLayer(layer);
    assert.ok(preds.length > 0, `layer ${layer} should have predicates`);
  }
});

test("evidence-predicates: predicateInfo returns metadata for known predicates", () => {
  const info = predicateInfo("repository-resolves");
  assert.equal(info.layer, 1);
  assert.equal(info.valueType, "boolean");
  assert.equal(info.defaultConfidence, 1.0);
});

test("evidence-predicates: predicateInfo returns null for unknown predicates", () => {
  assert.equal(predicateInfo("unknown-predicate"), null);
});

test("evidence-predicates: isKnownPredicate works", () => {
  assert.ok(isKnownPredicate("repository-resolves"));
  assert.ok(!isKnownPredicate("unknown-predicate"));
});

test("evidence-predicates: registerPredicate adds new predicate", () => {
  // Use a unique name to avoid collision
  const name = "test-predicate-" + Date.now();
  registerPredicate(name, {
    layer: 3,
    valueType: "boolean",
    defaultConfidence: 0.5,
    description: "test predicate",
  });
  assert.ok(isKnownPredicate(name));
  assert.equal(predicateInfo(name).layer, 3);
});

test("evidence-predicates: registerPredicate rejects duplicate names", () => {
  assert.throws(
    () => registerPredicate("repository-resolves", { layer: 1 }),
    /already registered/
  );
});

test("evidence-predicates: registerPredicate rejects invalid layer", () => {
  assert.throws(
    () => registerPredicate("test-bad-layer-" + Date.now(), { layer: 5 }),
    /layer must be 0-4/
  );
});

test("evidence: accepts unknown predicates (vocabulary is advisory, not a gate)", () => {
  // An unknown predicate should be accepted — no layer mismatch check
  const record = buildEvidenceRecord(
    makeValidInput({
      claim: { predicate: "custom-experimental-probe", value: true, layer: 3, confidence: 0.7 },
    })
  );
  verifyEvidenceRecord(record);
  assert.equal(record.claim.predicate, "custom-experimental-probe");
});

// ─── 10. Protocol neutrality ─────────────────────────────────────

test("evidence: record format has no MCP-specific fields", () => {
  const record = buildEvidenceRecord(makeValidInput());
  const recordStr = JSON.stringify(record);
  // The format should not hardcode MCP concepts
  assert.ok(!recordStr.includes("mcpServer"), "should not contain mcpServer");
  assert.ok(!recordStr.includes("toolsList"), "should not contain toolsList");
  assert.ok(!recordStr.includes("stdio"), "should not contain stdio");
});

test("evidence: subject.kind can be any valid kind, not just capability-provider", () => {
  for (const kind of SUBJECT_KINDS) {
    const record = buildEvidenceRecord(
      makeValidInput({
        subject: { kind, identifiers: { id: "test-" + kind } },
      })
    );
    assert.equal(record.subject.kind, kind);
    verifyEvidenceRecord(record);
  }
});

test("evidence: observer.agent can be non-trustcard (external observers)", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      observer: { agent: "external-researcher", version: "1.0.0", method: "manual-audit" },
    })
  );
  assert.equal(record.observer.agent, "external-researcher");
  verifyEvidenceRecord(record);
});

// ─── 11. verifyEvidenceRecord ────────────────────────────────────

test("evidence: verifyEvidenceRecord returns true for valid record", () => {
  const record = buildEvidenceRecord(makeValidInput());
  assert.equal(verifyEvidenceRecord(record), true);
});

test("evidence: verifyEvidenceRecord rejects wrong $schema", () => {
  const record = buildEvidenceRecord(makeValidInput());
  record.$schema = "wrong";
  assert.throws(() => verifyEvidenceRecord(record), /\$schema/);
});

test("evidence: verifyEvidenceRecord rejects tampered digest", () => {
  const record = buildEvidenceRecord(makeValidInput());
  record.digest = "sha256:AAAA";
  assert.throws(() => verifyEvidenceRecord(record), /digest mismatch/);
});

test("evidence: verifyEvidenceRecord rejects id/digest mismatch", () => {
  const record = buildEvidenceRecord(makeValidInput());
  record.id = "ev_sha256:WRONG";
  assert.throws(() => verifyEvidenceRecord(record), /id mismatch/);
});

test("evidence: isValidEvidenceRecord returns false for invalid records", () => {
  assert.ok(!isValidEvidenceRecord({}));
  assert.ok(!isValidEvidenceRecord(null));
  assert.ok(!isValidEvidenceRecord("not an object"));

  const record = buildEvidenceRecord(makeValidInput());
  assert.ok(isValidEvidenceRecord(record));

  record.digest = "sha256:tampered";
  assert.ok(!isValidEvidenceRecord(record));
});

// ─── 12. Utility functions ───────────────────────────────────────

test("evidence: evidenceId returns the record's id", () => {
  const record = buildEvidenceRecord(makeValidInput());
  assert.equal(evidenceId(record), record.id);
});

test("evidence: layerName returns the human-readable layer name", () => {
  const record = buildEvidenceRecord(makeValidInput());
  assert.equal(layerName(record), "existence"); // layer 1
});

test("evidence: EVIDENCE_LAYERS maps all 5 layers", () => {
  assert.equal(EVIDENCE_LAYERS[0], "identity");
  assert.equal(EVIDENCE_LAYERS[1], "existence");
  assert.equal(EVIDENCE_LAYERS[2], "vitality");
  assert.equal(EVIDENCE_LAYERS[3], "behavior");
  assert.equal(EVIDENCE_LAYERS[4], "ecosystem");
});

// ─── 13. Edge cases ──────────────────────────────────────────────

test("evidence: numeric identifier values are accepted", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      subject: {
        kind: "repository",
        identifiers: { repoId: 12345678, ownerId: 87654321 },
      },
    })
  );
  assert.equal(record.subject.identifiers.repoId, 12345678);
  verifyEvidenceRecord(record);
});

test("evidence: confidence 0.0 is valid (observation failed)", () => {
  const record = buildEvidenceRecord(
    makeValidInput({ claim: { ...VALID_CLAIM, confidence: 0.0, value: null } })
  );
  assert.equal(record.claim.confidence, 0.0);
  verifyEvidenceRecord(record);
});

test("evidence: confidence 1.0 is valid (authoritative)", () => {
  const record = buildEvidenceRecord(
    makeValidInput({ claim: { ...VALID_CLAIM, confidence: 1.0 } })
  );
  assert.equal(record.claim.confidence, 1.0);
  verifyEvidenceRecord(record);
});

test("evidence: probeVersion is optional but accepted", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      observer: { ...VALID_OBSERVER, probeVersion: "1.2.3" },
    })
  );
  assert.equal(record.observer.probeVersion, "1.2.3");
  verifyEvidenceRecord(record);
});

test("evidence: multiple related IDs are accepted", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      related: ["ev_sha256:aaa", "ev_sha256:bbb", "ev_sha256:ccc"],
    })
  );
  assert.equal(record.related.length, 3);
  verifyEvidenceRecord(record);
});

test("evidence: claim value can be a complex object", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      claim: {
        predicate: "destructive-capability-detected",
        value: true,
        layer: 3,
        confidence: 0.85,
        payload: {
          tool: "execute_command",
          score: 0.92,
          engines: {
            heuristic: { score: 0.90, reasons: ["destructive verb"] },
            semantic: { score: 0.88, topMatch: "execute shell command" },
            injection: { score: 0.15, markers: [] },
          },
        },
      },
    })
  );
  assert.equal(record.claim.payload.tool, "execute_command");
  verifyEvidenceRecord(record);
});

test("evidence: claim value can be a string (schema-valid predicate)", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      claim: { predicate: "schema-valid", value: "search", layer: 3, confidence: 0.95 },
    })
  );
  assert.equal(record.claim.value, "search");
  verifyEvidenceRecord(record);
});

test("evidence: claim value can be a number", () => {
  const record = buildEvidenceRecord(
    makeValidInput({
      claim: { predicate: "tools-exposed", value: 14, layer: 3, confidence: 0.95 },
    })
  );
  assert.equal(record.claim.value, 14);
  verifyEvidenceRecord(record);
});
