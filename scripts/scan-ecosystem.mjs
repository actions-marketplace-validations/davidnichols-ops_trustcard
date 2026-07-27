#!/usr/bin/env node
/**
 * MCP Ecosystem Scan — produces the first reproducible ecosystem dataset.
 *
 * Combines:
 *   1. Registry crawl (all servers)
 *   2. Layer 1 existence verification (sample or full)
 *   3. Runtime health scan (sample or full)
 *
 * Usage:
 *   node scripts/scan-ecosystem.mjs --sample 100              # quick sample
 *   node scripts/scan-ecosystem.mjs --existence-only --sample 500  # just Layer 1
 *   node scripts/scan-ecosystem.mjs --full                     # everything (slow)
 *   node scripts/scan-ecosystem.mjs --registry-file data/mcp-registry-2026-07-27.json
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { verifyExistence, batchVerifyExistence } from '../lib/existence.js';
import { runHealthcheck } from '../lib/checks.js';
import { existenceToEvidence } from '../lib/evidence-adapters.js';
import { EvidenceStore } from '../lib/evidence-store.js';

function parseArgs() {
  const args = { sample: null, existenceOnly: false, full: false, registryFile: null, out: null, evidenceStore: null };
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--sample' && raw[i + 1]) args.sample = parseInt(raw[++i], 10);
    if (raw[i] === '--existence-only') args.existenceOnly = true;
    if (raw[i] === '--full') args.full = true;
    if (raw[i] === '--registry-file' && raw[i + 1]) args.registryFile = raw[++i];
    if (raw[i] === '--out' && raw[i + 1]) args.out = raw[++i];
    if (raw[i] === '--evidence-store' && raw[i + 1]) args.evidenceStore = raw[++i];
  }
  return args;
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

function pickSample(servers, n) {
  // Stratified sample: pick proportionally from each transport type
  const byTransport = { stdio: [], remote: [], both: [], unknown: [] };
  for (const s of servers) byTransport[s.transport]?.push(s);

  const total = servers.length;
  const sample = [];
  for (const [transport, list] of Object.entries(byTransport)) {
    const count = Math.round((list.length / total) * n);
    // Shuffle and pick
    const shuffled = [...list].sort(() => Math.random() - 0.5);
    sample.push(...shuffled.slice(0, count));
  }
  return sample;
}

async function scanRuntime(server, timeoutMs = 20000) {
  const spec = server.remoteUrl || server.npmSpec;
  if (!spec) return { error: 'no runnable spec', score: 0, tools: 0 };

  try {
    const result = await runHealthcheck(spec, { timeout: timeoutMs });
    return {
      score: result.score,
      maxScore: result.max,
      tools: result.tools?.length || 0,
      handshake: result.checks?.handshake?.status || 'UNKNOWN',
      protocolVersion: result.protocolVersion,
      serverInfo: result.serverInfo,
      checks: Object.fromEntries(
        Object.entries(result.checks || {}).map(([k, v]) => [k, v.status])
      ),
    };
  } catch (e) {
    return { error: e.message, score: 0, tools: 0 };
  }
}

async function main() {
  const args = parseArgs();
  const registryFile = args.registryFile || join(process.cwd(), 'data', `mcp-registry-${dateStr()}.json`);
  const outFile = args.out || join(process.cwd(), 'data', `mcp-ecosystem-${dateStr()}.json`);

  // Load registry data
  process.stderr.write(`Loading registry from ${registryFile}...\n`);
  const registry = JSON.parse(readFileSync(registryFile, 'utf8'));
  let servers = registry.servers || [];
  process.stderr.write(`  ${servers.length} distinct servers loaded\n`);

  // Sample or full
  let target = servers;
  if (args.sample && !args.full) {
    target = pickSample(servers, args.sample);
    process.stderr.write(`  Sampling ${target.length} servers (stratified by transport)\n`);
  }

  const startedAt = new Date().toISOString();
  const results = [];

  // Evidence store (optional)
  let store = null;
  if (args.evidenceStore) {
    store = new EvidenceStore(args.evidenceStore, { loadIndex: false });
    process.stderr.write(`  Evidence store: ${args.evidenceStore}\n`);
  }

  // Phase 1: Existence verification
  process.stderr.write(`\nPhase 1: Existence verification (${target.length} servers)...\n`);
  let existenceOk = 0, existenceFail = 0;
  let evidenceEmitted = 0, evidenceErrors = 0;

  for (let i = 0; i < target.length; i++) {
    const server = target[i];
    process.stderr.write(`\r  [${i + 1}/${target.length}] ${server.name?.slice(0, 40).padEnd(42)}`);

    const existence = await verifyExistence(server);
    if (existence.identity.repository_verified) existenceOk++;
    else existenceFail++;

    results.push({
      serverName: server.name,
      version: server.version,
      transport: server.transport,
      repoUrl: server.repoUrl,
      npmSpec: server.npmSpec,
      remoteUrl: server.remoteUrl,
      existence: existence.identity,
      existenceDetails: {
        repository: existence.repository?.exists ?? null,
        repositoryStars: existence.repository?.details?.stars ?? null,
        repositoryLanguage: existence.repository?.details?.language ?? null,
        repositoryPushedAt: existence.repository?.details?.pushedAt ?? null,
        repositoryArchived: existence.repository?.details?.archived ?? null,
        packageExists: existence.package?.exists ?? null,
        packageLatestVersion: existence.package?.details?.latestVersion ?? null,
        publisherSource: existence.publisher?.source ?? null,
      },
      errors: existence.errors,
    });

    // Emit evidence records if store is configured
    if (store) {
      try {
        const records = existenceToEvidence(existence, server);
        if (records.length > 0) {
          store.appendBatch(records);
          evidenceEmitted += records.length;
        }
      } catch (e) {
        evidenceErrors++;
        if (evidenceErrors <= 3) {
          process.stderr.write(`\n  evidence error: ${e.message}\n`);
        }
      }
    }

    // Small delay to respect rate limits
    if (server.repoUrl) await new Promise(r => setTimeout(r, 150));
  }

  process.stderr.write(`\n  Existence: ${existenceOk} verified, ${existenceFail} failed\n`);
  if (store) {
    process.stderr.write(`  Evidence: ${evidenceEmitted} records emitted, ${evidenceErrors} errors\n`);
  }

  // Phase 2: Runtime scan (skip if --existence-only)
  if (!args.existenceOnly) {
    process.stderr.write(`\nPhase 2: Runtime scan (${target.length} servers)...\n`);
    let scanOk = 0, scanFail = 0;

    for (let i = 0; i < target.length; i++) {
      const server = target[i];
      process.stderr.write(`\r  [${i + 1}/${target.length}] ${server.name?.slice(0, 40).padEnd(42)}`);

      const runtime = await scanRuntime(server);
      results[i].runtime = runtime;

      if (runtime.error) scanFail++;
      else scanOk++;
    }

    process.stderr.write(`\n  Runtime: ${scanOk} scanned, ${scanFail} failed\n`);
  }

  const endedAt = new Date().toISOString();

  // Summary statistics
  const summary = {
    totalScanned: results.length,
    existence: {
      repositoryVerified: results.filter(r => r.existence?.repository_verified).length,
      packageVerified: results.filter(r => r.existence?.package_verified).length,
      publisherVerified: results.filter(r => r.existence?.publisher_verified).length,
    },
    transport: {
      stdio: results.filter(r => r.transport === 'stdio').length,
      remote: results.filter(r => r.transport === 'remote').length,
      both: results.filter(r => r.transport === 'both').length,
      unknown: results.filter(r => r.transport === 'unknown').length,
    },
  };

  if (!args.existenceOnly) {
    summary.runtime = {
      scanned: results.filter(r => r.runtime && !r.runtime.error).length,
      failed: results.filter(r => r.runtime?.error).length,
      avgScore: Math.round(
        results.filter(r => r.runtime?.score).reduce((s, r) => s + r.runtime.score, 0) /
        Math.max(1, results.filter(r => r.runtime?.score).length)
      ),
      handshakePass: results.filter(r => r.runtime?.handshake === 'PASS').length,
      handshakeFail: results.filter(r => r.runtime?.handshake === 'FAIL').length,
      handshakeConfig: results.filter(r => r.runtime?.handshake === 'CONFIG' || r.runtime?.handshake === 'CONFIG_REQUIRED').length,
    };
  }

  const dataset = {
    name: 'MCP Ecosystem Scan',
    description: 'Reproducible ecosystem scan combining registry crawl, Layer 1 existence verification, and runtime health checks.',
    schemaVersion: '0.1',
    scannedAt: startedAt,
    completedAt: endedAt,
    registrySource: registryFile,
    sampleSize: args.sample || (args.full ? 'full' : 'all'),
    summary,
    servers: results,
  };

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(dataset, null, 2));

  process.stderr.write(`\nDone. Output: ${outFile}\n`);
  process.stderr.write(`  Summary: ${JSON.stringify(summary, null, 2)}\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
