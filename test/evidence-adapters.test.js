// Evidence adapters — convert existing probe outputs to evidence records.
//
// Tests verify that each adapter correctly transforms probe output into
// valid, well-formed evidence records with the right predicates, layers,
// and confidence values.

import { test } from "node:test";
import assert from "node:assert/strict";
import { verifyEvidenceRecord } from "../lib/evidence.js";
import {
  buildSubject,
  existenceToEvidence,
  healthcheckToEvidence,
  observationToEvidence,
  registryEntryToEvidence,
} from "../lib/evidence-adapters.js";

// ─── Helpers ──────────────────────────────────────────────────────

function verifyAll(records) {
  for (const r of records) {
    verifyEvidenceRecord(r);
  }
}

const REGISTRY_ENTRY = {
  name: "io.github.test/server",
  version: "1.0.0",
  repoUrl: "https://github.com/test/server",
  npmSpec: "@test/server",
  remoteUrl: null,
  transport: "stdio",
  crawledAt: "2026-07-27T14:32:00.000Z",
};

// ─── buildSubject ─────────────────────────────────────────────────

test("evidence-adapters: buildSubject constructs subject from identifiers", () => {
  const subject = buildSubject({
    registryName: "io.github.test/server",
    repoUrl: "https://github.com/test/server",
    version: "1.0.0",
  });
  assert.equal(subject.kind, "capability-provider");
  assert.equal(subject.identifiers.registryName, "io.github.test/server");
  assert.equal(subject.identifiers.repoUrl, "https://github.com/test/server");
  assert.equal(subject.identifiers.version, "1.0.0");
});

test("evidence-adapters: buildSubject with custom kind", () => {
  const subject = buildSubject({ subjectKind: "repository", repoUrl: "https://github.com/test/server" });
  assert.equal(subject.kind, "repository");
});

// ─── existenceToEvidence ──────────────────────────────────────────

test("evidence-adapters: existenceToEvidence — repo exists", () => {
  const existenceResult = {
    serverName: "io.github.test/server",
    version: "1.0.0",
    identity: { repository_verified: true, package_verified: true, publisher_verified: true },
    repository: {
      verified: true,
      exists: true,
      details: { repoId: 12345, owner: "test", stars: 42, language: "TypeScript" },
      error: null,
    },
    package: {
      verified: true,
      exists: true,
      details: { name: "@test/server", latestVersion: "1.0.0", versionCount: 5 },
      error: null,
    },
    publisher: { verified: true, publisher: "test", source: "github-repo-match", error: null },
    errors: [],
    verifiedAt: "2026-07-27T14:32:00.000Z",
  };

  const records = existenceToEvidence(existenceResult, REGISTRY_ENTRY);
  verifyAll(records);

  // Should produce: repository-resolves, package-resolves, identifier-observed
  const predicates = records.map((r) => r.claim.predicate);
  assert.ok(predicates.includes("repository-resolves"));
  assert.ok(predicates.includes("package-resolves"));
  assert.ok(predicates.includes("identifier-observed"));

  // Verify repository-resolves record
  const repoRecord = records.find((r) => r.claim.predicate === "repository-resolves");
  assert.equal(repoRecord.claim.value, true);
  assert.equal(repoRecord.claim.confidence, 1.0);
  assert.equal(repoRecord.claim.layer, 1);
  assert.equal(repoRecord.claim.payload.repoId, 12345);
});

test("evidence-adapters: existenceToEvidence — repo dead (404)", () => {
  const existenceResult = {
    serverName: "io.github.test/server",
    version: "1.0.0",
    identity: { repository_verified: false, package_verified: false, publisher_verified: false },
    repository: { verified: true, exists: false, details: {}, error: null },
    package: null,
    publisher: { verified: false, publisher: "test", source: "unknown-namespace", error: null },
    errors: [],
    verifiedAt: "2026-07-27T14:32:00.000Z",
  };

  const records = existenceToEvidence(existenceResult, REGISTRY_ENTRY);
  verifyAll(records);

  const repoRecord = records.find((r) => r.claim.predicate === "repository-not-found");
  assert.ok(repoRecord);
  assert.equal(repoRecord.claim.value, true);
  assert.equal(repoRecord.claim.confidence, 0.95);
});

test("evidence-adapters: existenceToEvidence — rate limited (observation failed)", () => {
  const existenceResult = {
    serverName: "io.github.test/server",
    version: "1.0.0",
    identity: { repository_verified: false, package_verified: false, publisher_verified: false },
    repository: { verified: false, exists: false, details: {}, error: "rate limited" },
    package: null,
    publisher: null,
    errors: ["repo: rate limited"],
    verifiedAt: "2026-07-27T14:32:00.000Z",
  };

  const records = existenceToEvidence(existenceResult, REGISTRY_ENTRY);
  verifyAll(records);

  // Should produce an observation-failed record (value: null, confidence: 0.0)
  const repoRecord = records.find((r) => r.claim.predicate === "repository-resolves");
  assert.ok(repoRecord);
  assert.equal(repoRecord.claim.value, null);
  assert.equal(repoRecord.claim.confidence, 0.0);
  assert.equal(repoRecord.claim.payload.error, "rate limited");
});

// ─── healthcheckToEvidence ────────────────────────────────────────

test("evidence-adapters: healthcheckToEvidence — successful scan", () => {
  const report = {
    spec: "@modelcontextprotocol/server-filesystem",
    checks: {
      installability: { status: "PASS", detail: "found", score: 15, max: 15 },
      handshake: { status: "PASS", detail: "server-filesystem 1.0.0 · 850ms", score: 25, max: 25 },
      schema: { status: "PASS", detail: "14 tools, all schemas valid", score: 15, max: 15 },
      destructive: { status: "PASS", detail: "no dangerous tools", score: 10, max: 10 },
    },
    score: 87,
    max: 100,
    tools: [
      { name: "read_file", description: "Read a file" },
      { name: "write_file", description: "Write a file" },
    ],
    serverInfo: { name: "server-filesystem", version: "1.0.0" },
    protocolVersion: "2025-06-18",
    latencyMs: 850,
    runAt: "2026-07-27T14:32:00.000Z",
  };

  const records = healthcheckToEvidence(report, { registryName: "io.github.test/server", packageName: "@modelcontextprotocol/server-filesystem" });
  verifyAll(records);

  const predicates = records.map((r) => r.claim.predicate);
  assert.ok(predicates.includes("handshake-succeeds"));
  assert.ok(predicates.includes("tools-exposed"));
  assert.ok(predicates.includes("schema-valid"));
  assert.ok(predicates.includes("protocol-version-current"));
});

test("evidence-adapters: healthcheckToEvidence — handshake failure", () => {
  const report = {
    spec: "@some/broken-server",
    checks: {
      handshake: { status: "FAIL", detail: "process exited with code 1", score: 0, max: 25 },
    },
    score: 0,
    max: 100,
    tools: [],
    stderr: "Error: API_KEY is required",
    runAt: "2026-07-27T14:32:00.000Z",
  };

  const records = healthcheckToEvidence(report, { registryName: "io.github.some/broken-server" });
  verifyAll(records);

  const hsRecord = records.find((r) => r.claim.predicate === "handshake-fails");
  assert.ok(hsRecord);
  assert.equal(hsRecord.claim.value, true);
  assert.equal(hsRecord.claim.confidence, 0.80);
});

test("evidence-adapters: healthcheckToEvidence — config required (absence of evidence)", () => {
  const report = {
    spec: "@some/auth-server",
    checks: {
      handshake: { status: "CONFIG_REQUIRED", detail: "needs API key", score: 15, max: 25 },
    },
    score: 15,
    max: 100,
    tools: [],
    configRequired: true,
    runAt: "2026-07-27T14:32:00.000Z",
  };

  const records = healthcheckToEvidence(report, { registryName: "io.github.some/auth-server" });
  verifyAll(records);

  // Should produce an observation-failed record (value: null, confidence: 0.0)
  const hsRecord = records.find((r) => r.claim.predicate === "handshake-succeeds");
  assert.ok(hsRecord);
  assert.equal(hsRecord.claim.value, null);
  assert.equal(hsRecord.claim.confidence, 0.0);
  assert.equal(hsRecord.claim.payload.error, "config_required");
});

test("evidence-adapters: healthcheckToEvidence — destructive capability detected", () => {
  const report = {
    spec: "@shell/server",
    checks: {
      handshake: { status: "PASS", detail: "shell-server 1.0.0", score: 25, max: 25 },
      destructive: { status: "WARN", detail: "1 dangerous tool", score: 5, max: 10 },
    },
    score: 60,
    max: 100,
    tools: [{ name: "execute_command", description: "Execute a shell command" }],
    serverInfo: { name: "shell-server", version: "1.0.0" },
    protocolVersion: "2025-06-18",
    latencyMs: 500,
    dangerAnalysis: {
      tools: [
        {
          name: "execute_command",
          dangerous: true,
          score: 0.92,
          confidence: "high",
          analysis: {
            heuristic: { score: 0.90, reasons: ["destructive verb: execute"] },
            semantic: { score: 0.88, topMatch: "execute shell command" },
            injection: { score: 0.15, markers: [] },
          },
        },
      ],
    },
    runAt: "2026-07-27T14:32:00.000Z",
  };

  const records = healthcheckToEvidence(report, { registryName: "io.github.shell/server" });
  verifyAll(records);

  const dangerRecord = records.find((r) => r.claim.predicate === "destructive-capability-detected");
  assert.ok(dangerRecord);
  assert.equal(dangerRecord.claim.value, true);
  assert.equal(dangerRecord.claim.confidence, 0.85); // high confidence
  assert.equal(dangerRecord.claim.payload.tool, "execute_command");
  assert.equal(dangerRecord.subject.kind, "capability");
});

test("evidence-adapters: healthcheckToEvidence — stale protocol version", () => {
  const report = {
    spec: "@old/server",
    checks: {
      handshake: { status: "PASS", detail: "old-server", score: 25, max: 25 },
    },
    score: 70,
    max: 100,
    tools: [{ name: "search", description: "Search" }],
    serverInfo: { name: "old-server", version: "0.1.0" },
    protocolVersion: "2024-11-05", // old version
    latencyMs: 300,
    runAt: "2026-07-27T14:32:00.000Z",
  };

  const records = healthcheckToEvidence(report, { registryName: "io.github.old/server" });
  verifyAll(records);

  const staleRecord = records.find((r) => r.claim.predicate === "protocol-version-stale");
  assert.ok(staleRecord);
  assert.equal(staleRecord.claim.payload.version, "2024-11-05");
});

// ─── observationToEvidence ────────────────────────────────────────

test("evidence-adapters: observationToEvidence — successful observation", () => {
  const observation = {
    cmd: "npx @test/server",
    serverInfo: { name: "test-server", version: "1.0.0" },
    protocolVersion: "2025-06-18",
    tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }],
    toolsetDigest: "sha256:abc123",
    toolDigests: { search: "sha256:def456" },
    serverDigest: "sha256:ghi789",
    capabilities: { tools: { listChanged: true } },
    handshakeBinding: null,
    observedAt: "2026-07-27T14:32:00.000Z",
    error: null,
  };

  const records = observationToEvidence(observation, { registryName: "io.github.test/server" });
  verifyAll(records);

  const predicates = records.map((r) => r.claim.predicate);
  assert.ok(predicates.includes("handshake-succeeds"));
  assert.ok(predicates.includes("tools-exposed"));
  assert.ok(predicates.includes("identifier-observed"));

  // The identifier-observed record should carry the serverDigest
  const idRecord = records.find((r) => r.claim.predicate === "identifier-observed");
  assert.equal(idRecord.claim.payload.identifierType, "serverDigest");
  assert.equal(idRecord.claim.payload.value, "sha256:ghi789");
});

test("evidence-adapters: observationToEvidence — failed observation", () => {
  const observation = {
    cmd: "npx @broken/server",
    serverInfo: null,
    protocolVersion: null,
    tools: [],
    error: "handshake failed: connection refused",
    stderr: "Error: ECONNREFUSED",
    observedAt: "2026-07-27T14:32:00.000Z",
  };

  const records = observationToEvidence(observation, { registryName: "io.github.broken/server" });
  verifyAll(records);

  assert.equal(records.length, 1);
  assert.equal(records[0].claim.predicate, "handshake-fails");
  assert.equal(records[0].claim.value, true);
});

// ─── registryEntryToEvidence ──────────────────────────────────────

test("evidence-adapters: registryEntryToEvidence — produces identity record", () => {
  const records = registryEntryToEvidence(REGISTRY_ENTRY);
  verifyAll(records);

  assert.equal(records.length, 1);
  assert.equal(records[0].claim.predicate, "identifier-observed");
  assert.equal(records[0].claim.layer, 0);
  assert.equal(records[0].claim.payload.registryName, "io.github.test/server");
  assert.equal(records[0].claim.payload.transport, "stdio");
});

test("evidence-adapters: registryEntryToEvidence — remote server entry", () => {
  const entry = {
    name: "com.example/remote-server",
    version: "2.0.0",
    repoUrl: null,
    npmSpec: null,
    remoteUrl: "https://api.example.com/mcp",
    transport: "remote",
    crawledAt: "2026-07-27T14:32:00.000Z",
  };

  const records = registryEntryToEvidence(entry);
  verifyAll(records);

  assert.equal(records[0].claim.payload.remoteUrl, "https://api.example.com/mcp");
  assert.equal(records[0].subject.identifiers.endpointUrl, "https://api.example.com/mcp");
});

// ─── No forbidden fields in adapter output ────────────────────────

test("evidence-adapters: no adapter produces records with forbidden fields", () => {
  const existenceResult = {
    serverName: "io.github.test/server",
    version: "1.0.0",
    identity: {},
    repository: { verified: true, exists: true, details: { repoId: 1 }, error: null },
    package: { verified: true, exists: true, details: {}, error: null },
    publisher: { verified: true, publisher: "test", source: "match", error: null },
    errors: [],
    verifiedAt: "2026-07-27T14:32:00.000Z",
  };

  const allRecords = [
    ...existenceToEvidence(existenceResult, REGISTRY_ENTRY),
    ...healthcheckToEvidence(
      {
        spec: "@test/server",
        checks: { handshake: { status: "PASS", detail: "ok", score: 25, max: 25 } },
        score: 87,
        max: 100,
        tools: [{ name: "search", description: "Search" }],
        serverInfo: { name: "test", version: "1.0" },
        protocolVersion: "2025-06-18",
        latencyMs: 100,
        runAt: "2026-07-27T14:32:00.000Z",
      },
      { registryName: "io.github.test/server" }
    ),
    ...observationToEvidence(
      {
        serverInfo: { name: "test", version: "1.0" },
        protocolVersion: "2025-06-18",
        tools: [],
        toolsetDigest: "sha256:x",
        toolDigests: {},
        serverDigest: "sha256:y",
        observedAt: "2026-07-27T14:32:00.000Z",
        error: null,
      },
      { registryName: "io.github.test/server" }
    ),
    ...registryEntryToEvidence(REGISTRY_ENTRY),
  ];

  for (const record of allRecords) {
    verifyEvidenceRecord(record); // throws if forbidden fields present
    assert.equal(record.$schema, "trustcard.dev/evidence@1");
    // No score, no trustState, no recommendation
    assert.equal(record.score, undefined);
    assert.equal(record.trustState, undefined);
    assert.equal(record.recommendation, undefined);
  }
});
