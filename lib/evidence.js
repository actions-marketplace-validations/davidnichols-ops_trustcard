// Evidence record — the atomic primitive of the trustcard evidence substrate.
//
// An evidence record is an immutable, content-addressed observation: a fact
// that was true at a moment in time, measured by a specific method, about a
// specific subject, with a confidence value and reproduction instructions.
//
// The record answers:
//   What was observed?        → claim.predicate + claim.value + claim.payload
//   About what entity?        → subject.kind + subject.identifiers
//   By what method?           → observer.method + observer.version
//   At what time?             → timestamp
//   With what confidence?     → claim.confidence
//   How to verify?            → reproducibility + content address (digest)
//
// Design constraints (from PHASE-2.5-EVIDENCE-DESIGN.md):
//   1. Zero dependencies — reuse existing canon.js + hash.js
//   2. Content-addressed — JCS + SHA-256, same as all trustcard digests
//   3. Protocol-neutral — no MCP-specific assumptions in the format
//   4. Immutable — never modified after creation; corrections via supersedes
//   5. Reproducible — carries reproduction instructions
//   6. Compact — millions will exist; no redundant fields
//   7. Forward-compatible — unknown fields preserved, schema version explicit
//
// What is NOT in an evidence record (deliberately excluded):
//   - No score (derived by consumers, not stored in evidence)
//   - No trust state (consumption-layer decision, not observation)
//   - No recommendation (the system is neutral)
//   - No expiry (observations are facts at a timestamp; they don't expire)
//   - No encryption (evidence is public; redact sensitive data before recording)

import { canon } from "./canon.js";
import { hashJson } from "./hash.js";
import { EVIDENCE_LAYERS, SUBJECT_KINDS, predicateInfo } from "./evidence-predicates.js";

export const EVIDENCE_SCHEMA = "trustcard.dev/evidence@1";

// Fields that are part of the record schema. Any field not in this set is
// preserved (forward-compatibility) but must not be a forbidden field.
const SCHEMA_FIELDS = new Set([
  "$schema",
  "id",
  "timestamp",
  "observer",
  "subject",
  "claim",
  "reproducibility",
  "related",
  "supersedes",
  "digest",
]);

// Fields that must NEVER appear in an evidence record. Their presence
// indicates a misunderstanding of the evidence model and is rejected.
const FORBIDDEN_FIELDS = new Set([
  "score",
  "rating",
  "rank",
  "recommendation",
  "trustState",
  "trustLevel",
  "trustScore",
  "verdict",
  "safe",
  "unsafe",
  "approved",
  "expiresAt",
  "expiry",
  "ttl",
  "staleAfter",
]);

// Required observer subfields
const OBSERVER_REQUIRED = ["agent", "version", "method"];

// Required subject subfields
const SUBJECT_REQUIRED = ["kind", "identifiers"];

// Required claim subfields
const CLAIM_REQUIRED = ["predicate", "value", "layer", "confidence"];

// ─── Digest computation ───────────────────────────────────────────
//
// The digest is SHA-256 over the JCS canonicalization of the record with
// the `digest` and `id` fields removed. This mirrors the existing manifest
// digest pattern (hash.js#signingPayload excludes signature + manifestDigest).
//
// The `id` is "ev_" + digest — a namespaced content address that distinguishes
// evidence IDs from manifest digests, descriptor digests, and receipt digests
// in cross-references.

function computeDigest(record) {
  // Remove digest and id — they are derived from the content, not part of it
  const { digest: _d, id: _i, ...payload } = record;
  return hashJson(payload);
}

function computeId(digest) {
  return "ev_" + digest;
}

// ─── Validation ───────────────────────────────────────────────────

function validateObserver(observer) {
  if (typeof observer !== "object" || observer === null)
    throw new TypeError("evidence: observer must be an object");
  for (const field of OBSERVER_REQUIRED) {
    if (typeof observer[field] !== "string" || observer[field].length === 0)
      throw new TypeError(`evidence: observer.${field} must be a non-empty string`);
  }
  // probeVersion is optional but if present must be a string
  if (observer.probeVersion !== undefined && typeof observer.probeVersion !== "string")
    throw new TypeError("evidence: observer.probeVersion must be a string if present");
}

function validateSubject(subject) {
  if (typeof subject !== "object" || subject === null)
    throw new TypeError("evidence: subject must be an object");
  if (typeof subject.kind !== "string" || !SUBJECT_KINDS.includes(subject.kind))
    throw new TypeError(
      `evidence: subject.kind must be one of: ${SUBJECT_KINDS.join(", ")}`
    );
  if (typeof subject.identifiers !== "object" || subject.identifiers === null)
    throw new TypeError("evidence: subject.identifiers must be an object");
  if (Object.keys(subject.identifiers).length === 0)
    throw new TypeError("evidence: subject.identifiers must not be empty");
  // All identifier values must be strings or numbers (IDs can be numeric)
  for (const [key, val] of Object.entries(subject.identifiers)) {
    if (typeof val !== "string" && typeof val !== "number")
      throw new TypeError(
        `evidence: subject.identifiers.${key} must be a string or number, got ${typeof val}`
      );
  }
}

function validateClaim(claim) {
  if (typeof claim !== "object" || claim === null)
    throw new TypeError("evidence: claim must be an object");
  for (const field of CLAIM_REQUIRED) {
    if (!(field in claim))
      throw new TypeError(`evidence: claim.${field} is required`);
  }
  if (typeof claim.predicate !== "string" || claim.predicate.length === 0)
    throw new TypeError("evidence: claim.predicate must be a non-empty string");
  if (typeof claim.layer !== "number" || !Number.isInteger(claim.layer) || claim.layer < 0 || claim.layer > 4)
    throw new RangeError("evidence: claim.layer must be an integer 0-4");
  if (typeof claim.confidence !== "number" || claim.confidence < 0 || claim.confidence > 1)
    throw new RangeError("evidence: claim.confidence must be a number 0.0-1.0");

  // Cross-check: if the predicate is known, verify the layer matches
  const info = predicateInfo(claim.predicate);
  if (info && info.layer !== claim.layer) {
    throw new RangeError(
      `evidence: claim.layer (${claim.layer}) does not match predicate "${claim.predicate}" (expected layer ${info.layer})`
    );
  }

  // value can be: boolean, string, number, object, array, or null
  // (null = observation attempted but no result — "absence of evidence")
  // undefined is NOT allowed — it would be dropped by JSON serialization
  if (claim.value === undefined)
    throw new TypeError("evidence: claim.value must not be undefined (use null for absent results)");

  // payload is optional but if present must be an object
  if (claim.payload !== undefined && (typeof claim.payload !== "object" || claim.payload === null))
    throw new TypeError("evidence: claim.payload must be an object if present");
}

function validateReproducibility(repro) {
  if (repro === undefined || repro === null) return; // optional
  if (typeof repro !== "object")
    throw new TypeError("evidence: reproducibility must be an object if present");
  // All subfields are optional strings
  for (const field of ["command", "credentials", "environment"]) {
    if (repro[field] !== undefined && typeof repro[field] !== "string")
      throw new TypeError(`evidence: reproducibility.${field} must be a string if present`);
  }
}

function validateRelated(related) {
  if (related === undefined || related === null) return;
  if (!Array.isArray(related))
    throw new TypeError("evidence: related must be an array of evidence IDs");
  for (const id of related) {
    if (typeof id !== "string" || !id.startsWith("ev_"))
      throw new TypeError(`evidence: related entries must be evidence IDs (ev_...), got "${id}"`);
  }
}

function validateSupersedes(supersedes) {
  if (supersedes === undefined || supersedes === null) return;
  if (typeof supersedes !== "string" || !supersedes.startsWith("ev_"))
    throw new TypeError(`evidence: supersedes must be an evidence ID (ev_...) or null, got "${supersedes}"`);
}

function validateTimestamp(ts) {
  if (typeof ts !== "string")
    throw new TypeError("evidence: timestamp must be an ISO 8601 string");
  // Must parse as a valid date
  const parsed = new Date(ts);
  if (isNaN(parsed.getTime()))
    throw new TypeError(`evidence: timestamp "${ts}" is not a valid ISO 8601 date`);
}

function validateNoForbiddenFields(record) {
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_FIELDS.has(key)) {
      throw new Error(
        `evidence: forbidden field "${key}" — evidence records must not contain scores, ` +
        `recommendations, trust states, or expiry. See PHASE-2.5-EVIDENCE-DESIGN.md §1.6.`
      );
    }
  }
}

// ─── Public API ───────────────────────────────────────────────────

/**
 * Build an evidence record from observation data.
 *
 * Computes the digest and id automatically. The caller does not provide
 * `digest` or `id` — they are derived from the content.
 *
 * @param {object} input — the observation data
 * @param {object} input.observer — who/what made the observation
 * @param {object} input.subject — what the observation is about
 * @param {object} input.claim — what was observed
 * @param {string} [input.timestamp] — when (defaults to now, ISO 8601 UTC)
 * @param {object} [input.reproducibility] — how to reproduce
 * @param {string[]} [input.related] — related evidence IDs
 * @param {string|null} [input.supersedes] — evidence ID this corrects
 * @returns {object} a complete, validated, content-addressed evidence record
 * @throws {TypeError|RangeError|Error} on validation failure
 */
export function buildEvidenceRecord(input) {
  if (typeof input !== "object" || input === null)
    throw new TypeError("evidence: input must be an object");
  if (typeof input.observer !== "object" || input.observer === null)
    throw new TypeError("evidence: observer is required");

  // Check for forbidden fields in the input
  validateNoForbiddenFields(input);

  // Validate all components
  validateObserver(input.observer);
  validateSubject(input.subject);
  validateClaim(input.claim);
  validateReproducibility(input.reproducibility);
  validateRelated(input.related);
  validateSupersedes(input.supersedes);

  const timestamp = input.timestamp ?? new Date().toISOString();
  validateTimestamp(timestamp);

  // Assemble the record in canonical field order (JCS will sort keys anyway,
  // but we keep a logical order for human readability of pre-canonical JSON)
  const record = {
    $schema: EVIDENCE_SCHEMA,
    timestamp,
    observer: input.observer,
    subject: input.subject,
    claim: input.claim,
    reproducibility: input.reproducibility ?? undefined,
    related: input.related ?? [],
    supersedes: input.supersedes ?? null,
  };

  // Remove undefined fields (they shouldn't appear in the canonical form)
  if (record.reproducibility === undefined) delete record.reproducibility;
  if (record.related.length === 0) record.related = [];
  // Keep related as empty array — it's a valid value

  // Compute digest and id
  const digest = computeDigest(record);
  const id = computeId(digest);

  record.id = id;
  record.digest = digest;

  return record;
}

/**
 * Verify that an evidence record is well-formed and its digest is correct.
 *
 * This is the integrity check: recompute the digest from the content and
 * verify it matches. Also validates all schema constraints.
 *
 * @param {object} record — the evidence record to verify
 * @returns {boolean} true if the record is valid and its digest matches
 * @throws {Error} with a descriptive message if verification fails
 */
export function verifyEvidenceRecord(record) {
  if (typeof record !== "object" || record === null)
    throw new Error("evidence: record must be an object");

  if (record.$schema !== EVIDENCE_SCHEMA)
    throw new Error(`evidence: $schema must be "${EVIDENCE_SCHEMA}", got "${record.$schema}"`);

  // Check for forbidden fields
  validateNoForbiddenFields(record);

  // Validate all required fields are present
  if (typeof record.id !== "string" || !record.id.startsWith("ev_"))
    throw new Error("evidence: id must be a string starting with 'ev_'");
  if (typeof record.digest !== "string" || !record.digest.startsWith("sha256:"))
    throw new Error("evidence: digest must be a string starting with 'sha256:'");
  validateTimestamp(record.timestamp);
  validateObserver(record.observer);
  validateSubject(record.subject);
  validateClaim(record.claim);
  validateReproducibility(record.reproducibility);
  validateRelated(record.related);
  validateSupersedes(record.supersedes);

  // Recompute digest and verify
  const expectedDigest = computeDigest(record);
  if (record.digest !== expectedDigest)
    throw new Error(
      `evidence: digest mismatch — record claims "${record.digest}" but content hashes to "${expectedDigest}"`
    );

  // Verify id matches digest
  const expectedId = computeId(record.digest);
  if (record.id !== expectedId)
    throw new Error(
      `evidence: id mismatch — record has "${record.id}" but digest implies "${expectedId}"`
    );

  return true;
}

/**
 * Check if a record's digest is valid without throwing.
 * @param {object} record
 * @returns {boolean}
 */
export function isValidEvidenceRecord(record) {
  try {
    verifyEvidenceRecord(record);
    return true;
  } catch {
    return false;
  }
}

/**
 * Get the evidence ID from a record (without building it).
 * Useful for referencing records before they're stored.
 */
export function evidenceId(record) {
  return record.id;
}

/**
 * Get the layer name for a record's claim.layer.
 */
export function layerName(record) {
  return EVIDENCE_LAYERS[record.claim.layer] ?? "unknown";
}

/**
 * Serialize a record to a JSONL line (single line, no trailing newline).
 * Uses JCS canonicalization for deterministic output.
 */
export function serializeRecord(record) {
  return canon(record);
}

/**
 * Parse a JSONL line into an evidence record and verify it.
 * @param {string} line — a single JSONL line
 * @returns {object} the parsed and verified evidence record
 * @throws {Error} if parsing or verification fails
 */
export function parseRecord(line) {
  if (typeof line !== "string")
    throw new TypeError("evidence: parseRecord input must be a string");
  const trimmed = line.trim();
  if (trimmed.length === 0)
    throw new Error("evidence: parseRecord received an empty line");
  let parsed;
  try {
    parsed = JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`evidence: JSON parse error: ${e.message}`);
  }
  verifyEvidenceRecord(parsed);
  return parsed;
}

/**
 * Create a correction record that supersedes an existing record.
 * The new record references the old one via `supersedes`.
 * The caller provides the corrected claim; the old record's observer/subject
 * are carried forward unless overridden.
 *
 * @param {object} oldRecord — the record being corrected
 * @param {object} newClaim — the corrected claim
 * @param {string} [reason] — why the correction is being made (added to payload)
 * @param {object} [overrides] — optional overrides for observer, subject, etc.
 * @returns {object} a new evidence record that supersedes the old one
 */
export function correctEvidence(oldRecord, newClaim, reason, overrides = {}) {
  if (!isValidEvidenceRecord(oldRecord))
    throw new Error("evidence: cannot correct an invalid record");

  const claim = { ...newClaim };
  if (reason) {
    claim.payload = { ...(claim.payload ?? {}), correctionReason: reason };
  }

  return buildEvidenceRecord({
    observer: overrides.observer ?? oldRecord.observer,
    subject: overrides.subject ?? oldRecord.subject,
    claim,
    reproducibility: overrides.reproducibility ?? oldRecord.reproducibility,
    related: [...(overrides.related ?? oldRecord.related ?? []), oldRecord.id],
    supersedes: oldRecord.id,
  });
}

// Export internals for testing (not for production use)
export const _internals = {
  computeDigest,
  computeId,
  FORBIDDEN_FIELDS,
  SCHEMA_FIELDS,
  EVIDENCE_LAYERS,
};
