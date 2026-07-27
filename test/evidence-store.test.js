// Evidence store — append-only JSONL storage with multi-key indexing.
//
// Tests verify:
//   1. Append and retrieve records
//   2. Append-only (no update/delete API)
//   3. Duplicate rejection
//   4. Query by subject (string and { key, value })
//   5. Query by predicate
//   6. Query by layer
//   7. Query by observer and method
//   8. Query by time range
//   9. latest() — latest record per predicate
//  10. stats() — summary statistics
//  11. Index rebuild from JSONL files
//  12. Index persistence (flush + load)
//  13. Corruption handling (skip bad lines)
//  14. verify() — integrity check
//  15. Identity constellation — findByIdentifier
//  16. Contradiction detection
//  17. Batch append
//  18. Export
//  19. Deterministic file paths

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildEvidenceRecord, verifyEvidenceRecord } from "../lib/evidence.js";
import { EvidenceStore, evidenceFilePath, indexPath } from "../lib/evidence-store.js";

// ─── Test helpers ─────────────────────────────────────────────────

function makeTempStore() {
  const dir = mkdtempSync(join(tmpdir(), "evidence-test-"));
  return new EvidenceStore(dir);
}

function cleanup(store) {
  if (existsSync(store.root)) rmSync(store.root, { recursive: true, force: true });
}

function makeRecord(overrides = {}) {
  return buildEvidenceRecord({
    observer: {
      agent: "trustcard",
      version: "3.0.0",
      method: "github-repo-verify",
      ...overrides.observer,
    },
    subject: {
      kind: "capability-provider",
      identifiers: {
        registryName: "io.github.test/server",
        repoUrl: "https://github.com/test/server",
        ...overrides.subjectIdentifiers,
      },
    },
    claim: {
      predicate: "repository-resolves",
      value: true,
      layer: 1,
      confidence: 1.0,
      ...overrides.claim,
    },
    timestamp: overrides.timestamp ?? "2026-07-27T14:32:00.000Z",
    ...overrides.extra,
  });
}

// ─── 1. Append and retrieve ──────────────────────────────────────

test("evidence-store: append writes a record and getById retrieves it", () => {
  const store = makeTempStore();
  try {
    const record = makeRecord();
    const id = store.append(record);
    assert.equal(id, record.id);

    const retrieved = store.getById(id);
    assert.ok(retrieved);
    assert.equal(retrieved.id, record.id);
    assert.deepEqual(retrieved, record);
  } finally {
    cleanup(store);
  }
});

test("evidence-store: getById returns null for non-existent ID", () => {
  const store = makeTempStore();
  try {
    assert.equal(store.getById("ev_sha256:nonexistent"), null);
  } finally {
    cleanup(store);
  }
});

test("evidence-store: appended record exists in JSONL file", () => {
  const store = makeTempStore();
  try {
    const record = makeRecord();
    store.append(record);

    const filePath = evidenceFilePath(store.root, record.timestamp);
    assert.ok(existsSync(filePath), "JSONL file should exist");

    const content = readFileSync(filePath, "utf8");
    assert.ok(content.includes(record.id), "file should contain the record ID");
  } finally {
    cleanup(store);
  }
});

// ─── 2. Append-only ──────────────────────────────────────────────

test("evidence-store: no update method exists", () => {
  const store = makeTempStore();
  try {
    assert.equal(typeof store.update, "undefined");
    assert.equal(typeof store.delete, "undefined");
    assert.equal(typeof store.remove, "undefined");
  } finally {
    cleanup(store);
  }
});

// ─── 3. Duplicate rejection ──────────────────────────────────────

test("evidence-store: rejects duplicate append (same record ID)", () => {
  const store = makeTempStore();
  try {
    const record = makeRecord();
    store.append(record);
    assert.throws(() => store.append(record), /already exists/);
  } finally {
    cleanup(store);
  }
});

// ─── 4. Query by subject ─────────────────────────────────────────

test("evidence-store: query by subject (string identifier value)", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.a/server" } }));
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.b/server" } }));
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.a/server" }, timestamp: "2026-07-28T10:00:00.000Z" }));

    const results = store.query({ subject: "io.github.a/server" });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.subject.identifiers.registryName === "io.github.a/server"));
  } finally {
    cleanup(store);
  }
});

test("evidence-store: query by subject with { key, value }", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.a/server", repoUrl: "https://github.com/a/server" } }));
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.b/server", repoUrl: "https://github.com/b/server" } }));

    const results = store.query({ subject: { key: "repoUrl", value: "https://github.com/a/server" } });
    assert.equal(results.length, 1);
    assert.equal(results[0].subject.identifiers.registryName, "io.github.a/server");
  } finally {
    cleanup(store);
  }
});

test("evidence-store: query by subject identifier finds records across different key names", () => {
  // The identity constellation: a record with repoUrl and another with repoId
  // that share the same value should both be found by that value
  const store = makeTempStore();
  try {
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.a/server", repoId: 12345 } }));
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.b/server", repoId: 12345 } }));

    // Both records share repoId 12345 — findByIdentifier should find both
    const results = store.findByIdentifier("12345");
    assert.equal(results.length, 2);
  } finally {
    cleanup(store);
  }
});

// ─── 5. Query by predicate ───────────────────────────────────────

test("evidence-store: query by predicate", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 } }));
    store.append(makeRecord({ claim: { predicate: "handshake-succeeds", value: true, layer: 1, confidence: 0.95 } }));
    store.append(makeRecord({ claim: { predicate: "repository-resolves", value: false, layer: 1, confidence: 0.95, payload: { httpStatus: 404 } } }));

    const results = store.query({ predicate: "repository-resolves" });
    assert.equal(results.length, 2);
    assert.ok(results.every((r) => r.claim.predicate === "repository-resolves"));
  } finally {
    cleanup(store);
  }
});

// ─── 6. Query by layer ───────────────────────────────────────────

test("evidence-store: query by layer", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 } }));
    store.append(makeRecord({ claim: { predicate: "tools-exposed", value: { count: 5 }, layer: 3, confidence: 0.95 } }));
    store.append(makeRecord({ claim: { predicate: "handshake-succeeds", value: true, layer: 1, confidence: 0.95 } }));

    const layer1 = store.query({ layer: 1 });
    assert.equal(layer1.length, 2);

    const layer3 = store.query({ layer: 3 });
    assert.equal(layer3.length, 1);
  } finally {
    cleanup(store);
  }
});

// ─── 7. Query by observer and method ─────────────────────────────

test("evidence-store: query by observer.agent", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ observer: { agent: "trustcard", version: "3.0.0", method: "github-repo-verify" } }));
    store.append(makeRecord({ observer: { agent: "external-researcher", version: "1.0.0", method: "manual-audit" } }));

    const trustcard = store.query({ observer: "trustcard" });
    assert.equal(trustcard.length, 1);

    const external = store.query({ observer: "external-researcher" });
    assert.equal(external.length, 1);
  } finally {
    cleanup(store);
  }
});

test("evidence-store: query by observer.method", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ observer: { agent: "trustcard", version: "3.0.0", method: "github-repo-verify" } }));
    store.append(makeRecord({ observer: { agent: "trustcard", version: "3.0.0", method: "mcp-handshake" } }));

    const results = store.query({ method: "github-repo-verify" });
    assert.equal(results.length, 1);
  } finally {
    cleanup(store);
  }
});

// ─── 8. Query by time range ──────────────────────────────────────

test("evidence-store: query by time range (since/until)", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ timestamp: "2026-07-25T10:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-26T10:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-27T10:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-28T10:00:00.000Z" }));

    const since26 = store.query({ since: "2026-07-26T00:00:00.000Z" });
    assert.equal(since26.length, 3);

    const until27 = store.query({ until: "2026-07-27T00:00:00.000Z" });
    assert.equal(until27.length, 2);

    const range = store.query({ since: "2026-07-26T00:00:00.000Z", until: "2026-07-28T00:00:00.000Z" });
    assert.equal(range.length, 2);
  } finally {
    cleanup(store);
  }
});

test("evidence-store: query results are sorted by timestamp ascending", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ timestamp: "2026-07-28T10:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-25T10:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-27T10:00:00.000Z" }));

    const results = store.query({});
    assert.equal(results[0].timestamp, "2026-07-25T10:00:00.000Z");
    assert.equal(results[1].timestamp, "2026-07-27T10:00:00.000Z");
    assert.equal(results[2].timestamp, "2026-07-28T10:00:00.000Z");
  } finally {
    cleanup(store);
  }
});

test("evidence-store: query respects limit", () => {
  const store = makeTempStore();
  try {
    for (let i = 0; i < 10; i++) {
      store.append(makeRecord({ timestamp: `2026-07-${20 + i}T10:00:00.000Z` }));
    }
    const results = store.query({ limit: 3 });
    assert.equal(results.length, 3);
  } finally {
    cleanup(store);
  }
});

// ─── 9. latest() ─────────────────────────────────────────────────

test("evidence-store: latest returns most recent record per predicate", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ timestamp: "2026-07-25T10:00:00.000Z", claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 } }));
    store.append(makeRecord({ timestamp: "2026-07-27T10:00:00.000Z", claim: { predicate: "repository-resolves", value: false, layer: 1, confidence: 0.95, payload: { httpStatus: 404 } } }));
    store.append(makeRecord({ timestamp: "2026-07-26T10:00:00.000Z", claim: { predicate: "handshake-succeeds", value: true, layer: 1, confidence: 0.95 } }));

    const latest = store.latest("io.github.test/server");
    assert.equal(latest["repository-resolves"].timestamp, "2026-07-27T10:00:00.000Z");
    assert.equal(latest["repository-resolves"].claim.value, false);
    assert.equal(latest["handshake-succeeds"].timestamp, "2026-07-26T10:00:00.000Z");
  } finally {
    cleanup(store);
  }
});

// ─── 10. stats() ─────────────────────────────────────────────────

test("evidence-store: stats returns summary statistics", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 } }));
    store.append(makeRecord({ claim: { predicate: "handshake-succeeds", value: true, layer: 1, confidence: 0.95 } }));
    store.append(makeRecord({ claim: { predicate: "tools-exposed", value: { count: 5 }, layer: 3, confidence: 0.95 } }));

    const stats = store.stats();
    assert.equal(stats.totalRecords, 3);
    assert.equal(stats.byLayer[1], 2);
    assert.equal(stats.byLayer[3], 1);
    assert.equal(stats.byPredicate["repository-resolves"], 1);
    assert.equal(stats.byObserver["trustcard"], 3);
  } finally {
    cleanup(store);
  }
});

// ─── 11. Index rebuild ───────────────────────────────────────────

test("evidence-store: rebuildIndex reconstructs from JSONL files", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-rebuild-"));
  try {
    // Write records directly
    const store1 = new EvidenceStore(dir);
    const r1 = makeRecord({ timestamp: "2026-07-25T10:00:00.000Z" });
    const r2 = makeRecord({ timestamp: "2026-07-26T10:00:00.000Z", subjectIdentifiers: { registryName: "io.github.other/server" } });
    store1.append(r1);
    store1.append(r2);

    // Create a new store instance — should rebuild from files
    const store2 = new EvidenceStore(dir);
    assert.equal(store2.stats().totalRecords, 2);
    assert.ok(store2.getById(r1.id));
    assert.ok(store2.getById(r2.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evidence-store: rebuildIndex handles empty store", () => {
  const store = makeTempStore();
  try {
    const stats = store.rebuildIndex();
    assert.equal(stats.records, 0);
    assert.equal(stats.files, 0);
  } finally {
    cleanup(store);
  }
});

// ─── 12. Index persistence ───────────────────────────────────────

test("evidence-store: flushIndex persists and reload restores", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-flush-"));
  try {
    const store1 = new EvidenceStore(dir);
    const record = makeRecord();
    store1.append(record);
    store1.flushIndex();

    // Index file should exist
    assert.ok(existsSync(indexPath(dir)));

    // New store should load the persisted index
    const store2 = new EvidenceStore(dir);
    assert.ok(store2.getById(record.id));
    assert.equal(store2.stats().totalRecords, 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("evidence-store: corrupt index triggers rebuild from JSONL", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-corrupt-idx-"));
  try {
    const store1 = new EvidenceStore(dir);
    const record = makeRecord();
    store1.append(record);
    store1.flushIndex();

    // Corrupt the index file
    const idxPath = indexPath(dir);
    writeFileSync(idxPath, "{ corrupt json !!!");

    // New store should detect corrupt index and rebuild
    const store2 = new EvidenceStore(dir);
    assert.ok(store2.getById(record.id), "should recover record from JSONL");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 13. Corruption handling ─────────────────────────────────────

test("evidence-store: rebuildIndex skips unparseable lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-corrupt-line-"));
  try {
    const store = new EvidenceStore(dir);
    const record = makeRecord();
    store.append(record);

    // Append a corrupt line to the JSONL file
    const filePath = evidenceFilePath(dir, record.timestamp);
    appendFileSync(filePath, "this is not valid json\n");

    // Rebuild — should skip the bad line but keep the good one
    const stats = store.rebuildIndex();
    assert.equal(stats.records, 1);
    assert.equal(stats.skipped, 1);
    assert.equal(stats.errors.length, 1);
    assert.ok(store.getById(record.id));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 14. verify() ────────────────────────────────────────────────

test("evidence-store: verify returns true for clean store", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord());
    store.append(makeRecord({ timestamp: "2026-07-28T10:00:00.000Z" }));
    const result = store.verify();
    assert.ok(result.verified);
    assert.equal(result.totalRecords, 2);
    assert.equal(result.errors.length, 0);
  } finally {
    cleanup(store);
  }
});

test("evidence-store: verify detects tampered records", () => {
  const dir = mkdtempSync(join(tmpdir(), "evidence-verify-tamper-"));
  try {
    const store = new EvidenceStore(dir);
    const record = makeRecord();
    store.append(record);

    // Tamper with the JSONL file
    const filePath = evidenceFilePath(dir, record.timestamp);
    const content = readFileSync(filePath, "utf8");
    const tampered = content.replace('"stars"', '"tampered_stars"');
    // Actually, let's just append a line with a bad digest
    const badRecord = JSON.parse(content.trim());
    badRecord.claim.value = false;
    badRecord.digest = "sha256:tampered";
    writeFileSync(filePath, JSON.stringify(badRecord) + "\n");

    const result = store.verify();
    assert.ok(!result.verified);
    assert.ok(result.errors.length > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ─── 15. Identity constellation ──────────────────────────────────

test("evidence-store: findByIdentifier finds records by any identifier value", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.a/server", repoUrl: "https://github.com/a/server", repoId: 12345 } }));
    store.append(makeRecord({ subjectIdentifiers: { registryName: "io.github.b/server", repoUrl: "https://github.com/b/server" } }));

    // Find by repoUrl
    const byUrl = store.findByIdentifier("https://github.com/a/server");
    assert.equal(byUrl.length, 1);

    // Find by repoId
    const byId = store.findByIdentifier("12345");
    assert.equal(byId.length, 1);

    // Find by registryName
    const byName = store.findByIdentifier("io.github.a/server");
    assert.equal(byName.length, 1);
  } finally {
    cleanup(store);
  }
});

// ─── 16. Contradiction detection ─────────────────────────────────

test("evidence-store: contradictions finds conflicting observations", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ timestamp: "2026-07-25T10:00:00.000Z", claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 } }));
    store.append(makeRecord({ timestamp: "2026-07-27T10:00:00.000Z", claim: { predicate: "repository-resolves", value: false, layer: 1, confidence: 0.95 } }));

    const contradictions = store.contradictions("io.github.test/server");
    assert.ok(contradictions["repository-resolves"]);
    assert.equal(contradictions["repository-resolves"].length, 2);
  } finally {
    cleanup(store);
  }
});

test("evidence-store: contradictions returns empty when no conflicts", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 } }));
    const contradictions = store.contradictions("io.github.test/server");
    assert.equal(Object.keys(contradictions).length, 0);
  } finally {
    cleanup(store);
  }
});

// ─── 17. Batch append ────────────────────────────────────────────

test("evidence-store: appendBatch writes multiple records", () => {
  const store = makeTempStore();
  try {
    const records = [
      makeRecord({ timestamp: "2026-07-25T10:00:00.000Z" }),
      makeRecord({ timestamp: "2026-07-26T10:00:00.000Z", subjectIdentifiers: { registryName: "io.github.b/server" } }),
      makeRecord({ timestamp: "2026-07-25T10:00:00.000Z", subjectIdentifiers: { registryName: "io.github.c/server" } }),
    ];

    const ids = store.appendBatch(records);
    assert.equal(ids.length, 3);
    assert.equal(store.stats().totalRecords, 3);

    for (const id of ids) {
      assert.ok(store.getById(id));
    }
  } finally {
    cleanup(store);
  }
});

// ─── 18. Export ──────────────────────────────────────────────────

test("evidence-store: export returns all records with no filter", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ timestamp: "2026-07-25T10:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-26T10:00:00.000Z", subjectIdentifiers: { registryName: "io.github.b/server" } }));

    const all = store.export();
    assert.equal(all.length, 2);
  } finally {
    cleanup(store);
  }
});

test("evidence-store: export with filter returns matching records", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 } }));
    store.append(makeRecord({ claim: { predicate: "handshake-succeeds", value: true, layer: 1, confidence: 0.95 } }));

    const exported = store.export({ predicate: "repository-resolves" });
    assert.equal(exported.length, 1);
  } finally {
    cleanup(store);
  }
});

// ─── 19. Deterministic file paths ────────────────────────────────

test("evidence-store: evidenceFilePath produces YYYY/MM/YYYY-MM-DD.jsonl", () => {
  const path = evidenceFilePath("/data/evidence", "2026-07-27T14:32:00.000Z");
  assert.ok(path.includes("2026"));
  assert.ok(path.includes("07"));
  assert.ok(path.endsWith("2026-07-27.jsonl"));
});

test("evidence-store: records on different days go to different files", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ timestamp: "2026-07-25T10:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-26T10:00:00.000Z" }));

    const file1 = evidenceFilePath(store.root, "2026-07-25T10:00:00.000Z");
    const file2 = evidenceFilePath(store.root, "2026-07-26T10:00:00.000Z");
    assert.notEqual(file1, file2);
    assert.ok(existsSync(file1));
    assert.ok(existsSync(file2));
  } finally {
    cleanup(store);
  }
});

test("evidence-store: records on same day go to same file", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({ timestamp: "2026-07-25T01:00:00.000Z" }));
    store.append(makeRecord({ timestamp: "2026-07-25T23:00:00.000Z", subjectIdentifiers: { registryName: "io.github.b/server" } }));

    const file = evidenceFilePath(store.root, "2026-07-25T12:00:00.000Z");
    const content = readFileSync(file, "utf8");
    const lines = content.trim().split("\n");
    assert.equal(lines.length, 2);
  } finally {
    cleanup(store);
  }
});

// ─── 20. Combined query filters ──────────────────────────────────

test("evidence-store: multiple filters combine with AND logic", () => {
  const store = makeTempStore();
  try {
    store.append(makeRecord({
      observer: { agent: "trustcard", version: "3.0.0", method: "github-repo-verify" },
      claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 },
      timestamp: "2026-07-25T10:00:00.000Z",
    }));
    store.append(makeRecord({
      observer: { agent: "trustcard", version: "3.0.0", method: "mcp-handshake" },
      claim: { predicate: "handshake-succeeds", value: true, layer: 1, confidence: 0.95 },
      timestamp: "2026-07-26T10:00:00.000Z",
    }));
    store.append(makeRecord({
      observer: { agent: "external", version: "1.0.0", method: "github-repo-verify" },
      claim: { predicate: "repository-resolves", value: true, layer: 1, confidence: 1.0 },
      timestamp: "2026-07-27T10:00:00.000Z",
    }));

    // Filter: predicate AND observer
    const results = store.query({ predicate: "repository-resolves", observer: "trustcard" });
    assert.equal(results.length, 1);

    // Filter: predicate AND method AND since
    const results2 = store.query({ predicate: "repository-resolves", method: "github-repo-verify", since: "2026-07-26T00:00:00.000Z" });
    assert.equal(results2.length, 1);
    assert.equal(results2[0].observer.agent, "external");
  } finally {
    cleanup(store);
  }
});
