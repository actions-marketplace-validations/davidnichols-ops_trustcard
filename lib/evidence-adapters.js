// Evidence adapters — convert existing probe outputs to evidence records.
//
// This module is the bridge between the observation layer (existing trustcard
// probes: checks.js, existence.js, observe.js, danger-detector.js) and the
// evidence layer (evidence.js + evidence-store.js).
//
// Each adapter takes the output of an existing probe and produces one or more
// evidence records. The existing probe output remains unchanged — evidence
// emission is an ADDITIONAL output path, not a replacement.
//
// Design principle: the adapters are pure functions. They take probe output
// and return evidence records. They do not store anything. The caller decides
// whether to append the records to an evidence store.

import { buildEvidenceRecord } from "./evidence.js";
import { toolsetDigest, toolDigest } from "./identity.js";
import { PROTOCOL_VERSIONS } from "./client.js";

// ─── Observer templates ───────────────────────────────────────────

const TRUSTCARD_OBSERVER = {
  agent: "trustcard",
  version: "3.0.0",
};

function observer(method, probeVersion) {
  return { ...TRUSTCARD_OBSERVER, method, ...(probeVersion ? { probeVersion } : {}) };
}

// ─── Subject construction ─────────────────────────────────────────

/**
 * Build a subject object from a registry entry or scan spec.
 * @param {object} opts — { registryName, repoUrl, packageName, version, endpointUrl, serverDigest }
 * @returns {object} subject for evidence records
 */
export function buildSubject(opts) {
  const identifiers = {};
  if (opts.registryName) identifiers.registryName = opts.registryName;
  if (opts.repoUrl) identifiers.repoUrl = opts.repoUrl;
  if (opts.packageName) identifiers.packageName = opts.packageName;
  if (opts.version) identifiers.version = opts.version;
  if (opts.endpointUrl) identifiers.endpointUrl = opts.endpointUrl;
  if (opts.serverDigest) identifiers.serverDigest = opts.serverDigest;

  // Determine kind from available identifiers
  let kind = "capability-provider";
  if (opts.subjectKind) kind = opts.subjectKind;

  return { kind, identifiers };
}

// ─── Existence probe adapter ──────────────────────────────────────

/**
 * Convert existence.js verifyExistence() output to evidence records.
 *
 * Produces:
 *   - repository-resolves / repository-not-found (Layer 1)
 *   - package-resolves / package-not-found (Layer 1)
 *   - identifier-observed (Layer 0) for publisher identity
 *
 * @param {object} existenceResult — output of verifyExistence()
 * @param {object} entry — the original registry entry
 * @returns {object[]} evidence records
 */
export function existenceToEvidence(existenceResult, entry) {
  const records = [];
  const subject = buildSubject({
    registryName: entry.name,
    repoUrl: entry.repoUrl,
    packageName: entry.npmSpec,
    version: entry.version,
  });

  const ts = existenceResult.verifiedAt || new Date().toISOString();

  // Repository existence
  if (existenceResult.repository) {
    const repo = existenceResult.repository;
    if (repo.exists) {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("github-repo-verify"),
          subject,
          claim: {
            predicate: "repository-resolves",
            value: true,
            layer: 1,
            confidence: 1.0,
            payload: {
              httpStatus: 200,
              repoId: repo.details?.repoId,
              owner: repo.details?.owner,
              ownerId: repo.details?.ownerId,
              stars: repo.details?.stars,
              language: repo.details?.language,
              pushedAt: repo.details?.pushedAt,
              license: repo.details?.license,
              archived: repo.details?.archived,
            },
          },
          reproducibility: {
            command: `curl -s -H 'Accept: application/vnd.github+json' https://api.github.com/repos/${entry.repoUrl?.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? ""}`,
            credentials: "github-token",
            environment: process.platform === "darwin" ? "macos-arm64-local" : "linux-x64-ci",
          },
        })
      );
    } else if (repo.verified) {
      // Verified as not found (got a definitive 404)
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("github-repo-verify"),
          subject,
          claim: {
            predicate: "repository-not-found",
            value: true,
            layer: 1,
            confidence: 0.95,
            payload: { httpStatus: 404 },
          },
          reproducibility: {
            command: `curl -s -o /dev/null -w '%{http_code}' https://api.github.com/repos/${entry.repoUrl?.match(/github\.com\/([^/]+\/[^/]+)/)?.[1] ?? ""}`,
            credentials: "github-token",
            environment: process.platform === "darwin" ? "macos-arm64-local" : "linux-x64-ci",
          },
        })
      );
    } else {
      // Could not verify (rate limited, network error)
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("github-repo-verify"),
          subject,
          claim: {
            predicate: "repository-resolves",
            value: null,
            layer: 1,
            confidence: 0.0,
            payload: { error: repo.error },
          },
        })
      );
    }
  }

  // Package existence
  if (existenceResult.package) {
    const pkg = existenceResult.package;
    if (pkg.exists) {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("npm-registry-lookup"),
          subject,
          claim: {
            predicate: "package-resolves",
            value: true,
            layer: 1,
            confidence: 1.0,
            payload: {
              name: pkg.details?.name,
              latestVersion: pkg.details?.latestVersion,
              versionCount: pkg.details?.versionCount,
              license: pkg.details?.license,
              maintainerCount: pkg.details?.maintainerCount,
            },
          },
          reproducibility: {
            command: `curl -s https://registry.npmjs.org/${entry.npmSpec?.split("@")[0]}`,
            credentials: "none",
          },
        })
      );
    } else if (pkg.verified) {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("npm-registry-lookup"),
          subject,
          claim: {
            predicate: "package-not-found",
            value: true,
            layer: 1,
            confidence: 0.95,
            payload: {},
          },
        })
      );
    } else {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("npm-registry-lookup"),
          subject,
          claim: {
            predicate: "package-resolves",
            value: null,
            layer: 1,
            confidence: 0.0,
            payload: { error: pkg.error },
          },
        })
      );
    }
  }

  // Publisher identity (Layer 0)
  if (existenceResult.publisher) {
    const pub = existenceResult.publisher;
    records.push(
      buildEvidenceRecord({
        timestamp: ts,
        observer: observer("publisher-verify"),
        subject,
        claim: {
          predicate: "identifier-observed",
          value: true,
          layer: 0,
          confidence: pub.verified ? 1.0 : 0.0,
          payload: {
            identifierType: "publisher",
            publisher: pub.publisher,
            source: pub.source,
            verified: pub.verified,
            error: pub.error,
          },
        },
      })
    );
  }

  return records;
}

// ─── Healthcheck (checks.js) adapter ──────────────────────────────

/**
 * Convert checks.js runHealthcheck() report to evidence records.
 *
 * Produces:
 *   - handshake-succeeds / handshake-fails (Layer 1)
 *   - tools-exposed (Layer 3)
 *   - schema-valid / schema-invalid (Layer 3)
 *   - destructive-capability-detected (Layer 3)
 *   - injection-marker-detected (Layer 3)
 *   - protocol-version-current / protocol-version-stale (Layer 2)
 *
 * @param {object} report — output of runHealthcheck()
 * @param {object} [subjectOpts] — optional subject info (registryName, repoUrl, etc.)
 * @returns {object[]} evidence records
 */
export function healthcheckToEvidence(report, subjectOpts = {}) {
  const records = [];
  const ts = report.runAt || new Date().toISOString();
  const subject = buildSubject(subjectOpts);

  // Handshake evidence
  const hsCheck = report.checks?.handshake;
  if (hsCheck) {
    const isRemote = /^https?:\/\//i.test(report.spec ?? "");
    const method = isRemote ? "mcp-http-handshake" : "mcp-stdio-handshake";

    if (hsCheck.status === "PASS") {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer(method),
          subject,
          claim: {
            predicate: "handshake-succeeds",
            value: true,
            layer: 1,
            confidence: 0.95,
            payload: {
              serverName: report.serverInfo?.name,
              serverVersion: report.serverInfo?.version,
              protocolVersion: report.protocolVersion,
              latencyMs: report.latencyMs,
            },
          },
          reproducibility: {
            command: `node bin/mcp-trustcard.js scan ${report.spec}`,
            credentials: "none",
          },
        })
      );
    } else if (hsCheck.status === "FAIL") {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer(method),
          subject,
          claim: {
            predicate: "handshake-fails",
            value: true,
            layer: 1,
            confidence: 0.80,
            payload: {
              error: hsCheck.detail,
              stderr: report.stderr?.slice(0, 500),
            },
          },
        })
      );
    } else if (hsCheck.status === "CONFIG_REQUIRED") {
      // Observation attempted but could not complete — config needed
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer(method),
          subject,
          claim: {
            predicate: "handshake-succeeds",
            value: null,
            layer: 1,
            confidence: 0.0,
            payload: {
              error: "config_required",
              detail: hsCheck.detail,
            },
          },
        })
      );
    }
  }

  // Tools exposed evidence
  if (report.tools && report.tools.length > 0) {
    const toolDigests = {};
    for (const t of report.tools) {
      // We only have name and truncated description in the report,
      // so we compute a simple digest from the name
      toolDigests[t.name] = `tool:${t.name}`;
    }

    records.push(
      buildEvidenceRecord({
        timestamp: ts,
        observer: observer("mcp-tools-list"),
        subject,
        claim: {
          predicate: "tools-exposed",
          value: true,
          layer: 3,
          confidence: 0.95,
          payload: {
            count: report.tools.length,
            toolNames: report.tools.map((t) => t.name),
          },
        },
      })
    );

    // Schema validation evidence
    const schemaCheck = report.checks?.schema;
    if (schemaCheck) {
      if (schemaCheck.status === "PASS") {
        records.push(
          buildEvidenceRecord({
            timestamp: ts,
            observer: observer("schema-validation"),
            subject,
            claim: {
              predicate: "schema-valid",
              value: true,
              layer: 3,
              confidence: 0.95,
              payload: { toolCount: report.tools.length },
            },
          })
        );
      } else if (schemaCheck.status === "WARN" || schemaCheck.status === "FAIL") {
        records.push(
          buildEvidenceRecord({
            timestamp: ts,
            observer: observer("schema-validation"),
            subject,
            claim: {
              predicate: "schema-invalid",
              value: true,
              layer: 3,
              confidence: 0.95,
              payload: { detail: schemaCheck.detail },
            },
          })
        );
      }
    }
  }

  // Destructive capability evidence
  if (report.dangerAnalysis) {
    const analysis = report.dangerAnalysis;
    for (const toolAnalysis of analysis.tools || []) {
      if (toolAnalysis.dangerous) {
        records.push(
          buildEvidenceRecord({
            timestamp: ts,
            observer: observer("danger-analysis", "2.2.1"),
            subject: {
              kind: "capability",
              identifiers: {
                name: toolAnalysis.name,
                namespace: `${subject.identifiers.registryName ?? "unknown"}/${toolAnalysis.name}`,
              },
            },
            claim: {
              predicate: "destructive-capability-detected",
              value: true,
              layer: 3,
              confidence: toolAnalysis.confidence === "high" ? 0.85 : 0.60,
              payload: {
                tool: toolAnalysis.name,
                score: toolAnalysis.score,
                confidence: toolAnalysis.confidence,
                engines: toolAnalysis.analysis,
              },
            },
          })
        );
      }

      // Injection markers
      if (toolAnalysis.analysis?.injection?.markers?.length > 0) {
        records.push(
          buildEvidenceRecord({
            timestamp: ts,
            observer: observer("injection-detection", "2.2.1"),
            subject: {
              kind: "capability",
              identifiers: {
                name: toolAnalysis.name,
                namespace: `${subject.identifiers.registryName ?? "unknown"}/${toolAnalysis.name}`,
              },
            },
            claim: {
              predicate: "injection-marker-detected",
              value: true,
              layer: 3,
              confidence: 0.85,
              payload: {
                tool: toolAnalysis.name,
                markers: toolAnalysis.analysis.injection.markers,
                score: toolAnalysis.analysis.injection.score,
              },
            },
          })
        );
      }
    }
  }

  // Protocol version evidence
  if (report.protocolVersion) {
    const isCurrent = report.protocolVersion === PROTOCOL_VERSIONS[0];
    if (isCurrent) {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("mcp-protocol-version-check"),
          subject,
          claim: {
            predicate: "protocol-version-current",
            value: true,
            layer: 2,
            confidence: 0.95,
            payload: { version: report.protocolVersion },
          },
        })
      );
    } else {
      records.push(
        buildEvidenceRecord({
          timestamp: ts,
          observer: observer("mcp-protocol-version-check"),
          subject,
          claim: {
            predicate: "protocol-version-stale",
            value: true,
            layer: 2,
            confidence: 0.95,
            payload: {
              version: report.protocolVersion,
              latest: PROTOCOL_VERSIONS[0],
            },
          },
        })
      );
    }
  }

  return records;
}

// ─── Observation (observe.js) adapter ─────────────────────────────

/**
 * Convert observe.js observeServer() output to evidence records.
 *
 * Produces:
 *   - handshake-succeeds / handshake-fails (Layer 1)
 *   - tools-exposed with full digests (Layer 3)
 *   - identifier-observed for serverDigest (Layer 0)
 *
 * @param {object} observation — output of observeServer()
 * @param {object} [subjectOpts] — subject info
 * @returns {object[]}
 */
export function observationToEvidence(observation, subjectOpts = {}) {
  const records = [];
  const ts = observation.observedAt || new Date().toISOString();
  const subject = buildSubject({
    ...subjectOpts,
    serverDigest: observation.serverDigest ?? undefined,
  });

  if (observation.error) {
    records.push(
      buildEvidenceRecord({
        timestamp: ts,
        observer: observer("mcp-stdio-observe"),
        subject,
        claim: {
          predicate: "handshake-fails",
          value: true,
          layer: 1,
          confidence: 0.80,
          payload: {
            error: observation.error,
            stderr: observation.stderr?.slice(0, 500),
          },
        },
      })
    );
    return records;
  }

  // Handshake success
  records.push(
    buildEvidenceRecord({
      timestamp: ts,
      observer: observer("mcp-stdio-observe"),
      subject,
      claim: {
        predicate: "handshake-succeeds",
        value: true,
        layer: 1,
        confidence: 0.95,
        payload: {
          serverName: observation.serverInfo?.name,
          serverVersion: observation.serverInfo?.version,
          protocolVersion: observation.protocolVersion,
        },
      },
    })
  );

  // Tools exposed with full digests
  if (observation.tools && observation.tools.length > 0) {
    records.push(
      buildEvidenceRecord({
        timestamp: ts,
        observer: observer("mcp-tools-list"),
        subject,
        claim: {
          predicate: "tools-exposed",
          value: true,
          layer: 3,
          confidence: 0.95,
          payload: {
            count: observation.tools.length,
            toolsetDigest: observation.toolsetDigest,
            toolDigests: observation.toolDigests,
          },
        },
      })
    );
  }

  // Server digest as identifier observation (Layer 0)
  if (observation.serverDigest) {
    records.push(
      buildEvidenceRecord({
        timestamp: ts,
        observer: observer("mcp-identity-compute"),
        subject,
        claim: {
          predicate: "identifier-observed",
          value: true,
          layer: 0,
          confidence: 1.0,
          payload: {
            identifierType: "serverDigest",
            value: observation.serverDigest,
          },
        },
      })
    );
  }

  return records;
}

// ─── Registry crawler adapter ─────────────────────────────────────

/**
 * Convert a registry entry to Layer 0 identity evidence records.
 * Each registry entry establishes the initial identity constellation.
 *
 * @param {object} entry — a server entry from the registry crawler
 * @returns {object[]} evidence records
 */
export function registryEntryToEvidence(entry) {
  const records = [];
  const ts = entry.crawledAt || new Date().toISOString();
  const subject = buildSubject({
    registryName: entry.name,
    repoUrl: entry.repoUrl,
    packageName: entry.npmSpec,
    version: entry.version,
    endpointUrl: entry.remoteUrl,
  });

  // The registry entry itself is an identity observation
  records.push(
    buildEvidenceRecord({
      timestamp: ts,
      observer: observer("registry-crawl"),
      subject,
      claim: {
        predicate: "identifier-observed",
        value: true,
        layer: 0,
        confidence: 1.0,
        payload: {
          identifierType: "registryEntry",
          registryName: entry.name,
          version: entry.version,
          transport: entry.transport,
          repoUrl: entry.repoUrl,
          npmSpec: entry.npmSpec,
          remoteUrl: entry.remoteUrl,
        },
      },
      reproducibility: {
        command: `curl -s 'https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(entry.name)}'`,
        credentials: "none",
      },
    })
  );

  return records;
}
