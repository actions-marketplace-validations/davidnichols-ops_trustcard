#!/usr/bin/env node
/**
 * MCP Registry Crawler
 *
 * Paginates through the entire MCP registry API and produces a deduplicated
 * dataset of all known servers with their transport types, repository URLs,
 * and package specs.
 *
 * Output: data/mcp-registry-YYYY-MM-DD.json
 *
 * Usage:
 *   node scripts/crawl-registry.mjs                    # full crawl
 *   node scripts/crawl-registry.mjs --limit 100        # sample only
 *   node scripts/crawl-registry.mjs --out custom.json  # custom output
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REGISTRY_API = 'https://registry.modelcontextprotocol.io/v0/servers';
const PAGE_SIZE = 100;

function parseArgs() {
  const args = { limit: null, out: null };
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--limit' && raw[i + 1]) args.limit = parseInt(raw[++i], 10);
    if (raw[i] === '--out' && raw[i + 1]) args.out = raw[++i];
  }
  return args;
}

function dateStr() {
  return new Date().toISOString().slice(0, 10);
}

async function fetchPage(cursor) {
  let url = `${REGISTRY_API}?limit=${PAGE_SIZE}`;
  if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`;

  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Registry API returned ${resp.status}: ${await resp.text()}`);
  return resp.json();
}

function classifyTransport(server) {
  const remotes = server.remotes || [];
  const packages = server.packages || [];
  const hasRemote = remotes.length > 0;
  const hasPackage = packages.length > 0;

  if (hasRemote && hasPackage) return 'both';
  if (hasRemote) return 'remote';
  if (hasPackage) return 'stdio';
  return 'unknown';
}

function extractServer(entry) {
  const s = entry.server || {};
  const meta = entry._meta || {};
  const official = meta['io.modelcontextprotocol.registry/official'] || {};

  const transport = classifyTransport(s);

  // Extract npm package spec if available
  let npmSpec = null;
  if (s.packages) {
    for (const pkg of s.packages) {
      if (pkg.registryType === 'npm') {
        npmSpec = pkg.identifier + (pkg.version ? `@${pkg.version}` : '');
        break;
      }
    }
  }

  // Extract remote URL (first streamable-http or sse)
  let remoteUrl = null;
  let remoteType = null;
  if (s.remotes) {
    for (const r of s.remotes) {
      if (r.type === 'streamable-http' || r.type === 'sse') {
        remoteUrl = r.url;
        remoteType = r.type;
        break;
      }
    }
  }

  // Extract repository
  let repoUrl = null;
  let repoSource = null;
  if (s.repository) {
    repoUrl = s.repository.url || null;
    repoSource = s.repository.source || null;
  }

  // Extract declaration fields
  let declaredEnvVars = [];
  let declaredPackageArgs = [];
  let declaredRuntimeArgs = [];
  let declaredHeaders = [];

  if (s.packages) {
    for (const pkg of s.packages) {
      if (pkg.environmentVariables) {
        declaredEnvVars.push(...pkg.environmentVariables.map(v => ({
          name: v.name,
          description: v.description || null,
          isRequired: v.isRequired ?? false,
        })));
      }
      if (pkg.packageArguments) {
        declaredPackageArgs.push(...pkg.packageArguments.map(a => ({
          name: a.name,
          description: a.description || null,
          isRequired: a.isRequired ?? false,
        })));
      }
      if (pkg.runtimeArguments) {
        declaredRuntimeArgs.push(...pkg.runtimeArguments.map(a => ({
          name: a.name,
          description: a.description || null,
          isRequired: a.isRequired ?? false,
        })));
      }
    }
  }

  if (s.remotes) {
    for (const r of s.remotes) {
      if (r.headers) {
        declaredHeaders.push(...r.headers.map(h => ({
          name: h.name,
          description: h.description || null,
          isRequired: h.isRequired ?? false,
        })));
      }
    }
  }

  return {
    name: s.name || null,
    version: s.version || null,
    title: s.title || null,
    description: s.description || null,
    transport,
    npmSpec,
    remoteUrl,
    remoteType,
    repoUrl,
    repoSource,
    websiteUrl: s.websiteUrl || null,
    isLatest: official.isLatest ?? null,
    status: official.status || null,
    publishedAt: official.publishedAt || null,
    updatedAt: official.updatedAt || null,
    declaredEnvVars,
    declaredPackageArgs,
    declaredRuntimeArgs,
    declaredHeaders,
  };
}

async function crawl(limit) {
  const startedAt = new Date().toISOString();
  let cursor = null;
  const allEntries = [];
  const seenNames = new Map(); // name -> latest version entry
  let pageCount = 0;

  while (true) {
    const page = await fetchPage(cursor);
    const servers = page.servers || [];
    if (servers.length === 0) break;

    for (const entry of servers) {
      const extracted = extractServer(entry);
      allEntries.push(extracted);

      // Track latest version per server name
      const existing = seenNames.get(extracted.name);
      if (!existing || (extracted.isLatest === true)) {
        seenNames.set(extracted.name, extracted);
      }
    }

    pageCount++;
    const meta = page.metadata || {};
    cursor = meta.nextCursor;

    if (limit && allEntries.length >= limit) break;
    if (!cursor) break;

    if (pageCount % 50 === 0) {
      process.stderr.write(`  crawled ${allEntries.length} records (${pageCount} pages)...\n`);
    }
  }

  const endedAt = new Date().toISOString();

  // Build deduplicated server list (latest version only)
  const distinctServers = Array.from(seenNames.values());

  // Transport distribution
  const transportCounts = { stdio: 0, remote: 0, both: 0, unknown: 0 };
  for (const s of distinctServers) {
    transportCounts[s.transport]++;
  }

  // Repository stats
  const withRepo = distinctServers.filter(s => s.repoUrl).length;
  const withNpm = distinctServers.filter(s => s.npmSpec).length;
  const withRemote = distinctServers.filter(s => s.remoteUrl).length;

  const dataset = {
    name: 'MCP Registry Crawl',
    description: 'Full crawl of the official MCP registry, deduplicated to latest versions.',
    source: REGISTRY_API,
    crawledAt: startedAt,
    completedAt: endedAt,
    schemaVersion: '0.1',
    summary: {
      totalVersionRecords: allEntries.length,
      distinctServers: distinctServers.length,
      pages: pageCount,
      transport: transportCounts,
      withRepository: withRepo,
      withNpmPackage: withNpm,
      withRemoteUrl: withRemote,
    },
    servers: distinctServers,
    allVersions: limit ? undefined : allEntries, // omit full version list for samples
  };

  return dataset;
}

async function main() {
  const args = parseArgs();
  const outFile = args.out || join(process.cwd(), 'data', `mcp-registry-${dateStr()}.json`);

  process.stderr.write(`Crawling MCP registry${args.limit ? ` (limit: ${args.limit})` : ''}...\n`);
  const dataset = await crawl(args.limit);

  mkdirSync(dirname(outFile), { recursive: true });
  writeFileSync(outFile, JSON.stringify(dataset, null, 2));

  process.stderr.write(`\nDone.\n`);
  process.stderr.write(`  Total version records: ${dataset.summary.totalVersionRecords}\n`);
  process.stderr.write(`  Distinct servers:      ${dataset.summary.distinctServers}\n`);
  process.stderr.write(`  Transport:             ${JSON.stringify(dataset.summary.transport)}\n`);
  process.stderr.write(`  With repository:       ${dataset.summary.withRepository}\n`);
  process.stderr.write(`  With npm package:      ${dataset.summary.withNpmPackage}\n`);
  process.stderr.write(`  With remote URL:       ${dataset.summary.withRemoteUrl}\n`);
  process.stderr.write(`  Output:                ${outFile}\n`);
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
