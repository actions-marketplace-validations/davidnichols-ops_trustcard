#!/usr/bin/env node
/**
 * Declaration-vs-Observation Matrix Builder
 *
 * Joins registry crawl data (declarations) with ecosystem scan data
 * (observations) and produces a classification matrix.
 *
 * Each server is classified across these dimensions:
 *   - transport: MATCH / CONFLICT / UNKNOWN
 *   - envVars: MATCH / DECLARED_UNOBSERVED / OBSERVED_UNDECLARED / CONFLICT / UNKNOWN / N/A
 *   - packageArgs: (same)
 *   - runtimeArgs: (same)
 *   - headers: (same, remote-only)
 *   - handshake: MATCH / FAIL / UNKNOWN
 *   - capabilities: OBSERVED_UNDECLARED / UNKNOWN (capabilities are not registry-declared)
 *
 * Usage:
 *   node scripts/build-matrix.mjs \
 *     --registry data/mcp-registry-2026-07-31.json \
 *     --scan data/mcp-ecosystem-2026-07-31.json \
 *     --out data/matrix-2026-07-31.json
 */

import { readFileSync, writeFileSync } from 'node:fs';

function parseArgs() {
  const args = { registry: null, scan: null, out: null };
  const raw = process.argv.slice(2);
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--registry' && raw[i + 1]) args.registry = raw[++i];
    if (raw[i] === '--scan' && raw[i + 1]) args.scan = raw[++i];
    if (raw[i] === '--out' && raw[i + 1]) args.out = raw[++i];
  }
  return args;
}

// ============================================================
// Classification functions
// ============================================================

/**
 * Classify transport: does the registry-declared transport match
 * what was observed during the scan?
 */
function classifyTransport(regServer, scanResult) {
  const declared = regServer.transport;
  const runtime = scanResult?.runtime;

  if (!runtime || runtime.error) {
    // Can't observe transport if scan failed
    // But we can check if the spec exists
    if (declared === 'stdio' && !regServer.npmSpec) return 'UNKNOWN';
    if (declared === 'remote' && !regServer.remoteUrl) return 'CONFLICT';
    if (declared === 'both' && !regServer.npmSpec && !regServer.remoteUrl) return 'CONFLICT';
    return 'UNKNOWN';
  }

  // Scan succeeded — did it use the expected transport?
  if (declared === 'stdio' && regServer.npmSpec) {
    // Scan should have launched via npx
    if (runtime.handshake === 'PASS') return 'MATCH';
    if (runtime.handshake === 'FAIL' || runtime.handshake === 'CONFIG_REQUIRED') {
      // Server launched but handshake failed — transport is correct, handshake failed
      return 'MATCH';
    }
    return 'UNKNOWN';
  }

  if (declared === 'remote' && regServer.remoteUrl) {
    if (runtime.handshake === 'PASS') return 'MATCH';
    if (runtime.handshake === 'FAIL' || runtime.handshake === 'CONFIG_REQUIRED') {
      return 'MATCH'; // transport matched, handshake failed
    }
    return 'UNKNOWN';
  }

  if (declared === 'both') {
    // Either transport should work
    if (runtime.handshake === 'PASS' || runtime.handshake === 'FAIL' || runtime.handshake === 'CONFIG_REQUIRED') {
      return 'MATCH';
    }
    return 'UNKNOWN';
  }

  return 'UNKNOWN';
}

/**
 * Classify env vars: do declared env vars match observed requirements?
 *
 * Uses failureMode for precise classification:
 * - missing_env_var: server explicitly mentions env var
 * - missing_auth: server mentions API key/token/credential
 * - missing_argument: server mentions command-line argument
 * - transport_failure: network/connection issue
 * - runtime_crash: server crashed
 * - package_not_found: package not found
 * - unknown: unclassifiable failure
 *
 * - MATCH: declared as required, server fails without them
 * - DECLARED_UNOBSERVED: declared, but server starts fine without them
 * - OBSERVED_UNDECLARED: not declared, but server fails demanding env vars
 * - CONFLICT: declared as required, but server doesn't need them AND
 *   server demands undeclared vars (explicit contradiction)
 * - UNKNOWN: can't determine (scan failed for ambiguous reasons)
 * - N/A: no env vars declared and no env var requirement observed
 */
function classifyEnvVars(regServer, scanResult) {
  const declared = regServer.declaredEnvVars || [];
  const runtime = scanResult?.runtime;
  const failureMode = runtime?.failureMode || null;

  // No declarations and no runtime data
  if (declared.length === 0 && (!runtime || runtime.error)) {
    return 'UNKNOWN';
  }

  // No declarations, scan succeeded — check if server demanded env vars
  if (declared.length === 0 && runtime) {
    // Use failureMode for precise classification
    if (failureMode === 'missing_env_var') {
      return 'OBSERVED_UNDECLARED';
    }
    if (failureMode === 'missing_auth') {
      // Auth failures could be env vars or other auth mechanisms
      // Check stderr for env var specific language
      const stderr = runtime.stderr || '';
      if (/env(?:ironment)?\s*(?:var(?:iable)?)?/i.test(stderr)) {
        return 'OBSERVED_UNDECLARED';
      }
      // Auth failure without env var mention — could be header-based or other
      return 'UNKNOWN'; // Don't claim env var OBSERVED_UNDECLARED without evidence
    }
    if (runtime.handshake === 'CONFIG_REQUIRED' && failureMode === 'missing_argument') {
      return 'UNKNOWN'; // Missing argument, not env var
    }
    if (runtime.handshake === 'CONFIG_REQUIRED' && failureMode === 'unknown') {
      return 'UNKNOWN'; // Can't determine if it's env var or something else
    }
    if (runtime.handshake === 'CONFIG_REQUIRED' && !failureMode) {
      // Legacy: no failureMode captured (old scan data)
      // Fall back to broad classification
      return 'OBSERVED_UNDECLARED';
    }
    if (runtime.handshake === 'PASS') {
      return 'N/A'; // no declarations, no observed requirements
    }
    return 'UNKNOWN';
  }

  // Declarations exist, scan failed
  if (declared.length > 0 && (!runtime || runtime.error)) {
    // Check if the error mentions missing env vars
    if (runtime?.error && /env|environment|api.?key|token|secret|credential/i.test(runtime.error)) {
      // Server failed demanding config — but which env vars?
      // Can't determine if it matches the declared ones
      return 'UNKNOWN';
    }
    return 'UNKNOWN';
  }

  // Declarations exist, scan succeeded
  if (declared.length > 0 && runtime) {
    if (runtime.handshake === 'PASS') {
      // Server started without the declared env vars
      return 'DECLARED_UNOBSERVED';
    }
    if (runtime.handshake === 'CONFIG_REQUIRED') {
      // Server demanded config — but did it demand ENV VARS specifically?
      // Use failureMode to distinguish env var demand from runtime crash
      const fm = runtime.failureMode;
      if (fm === 'missing_env_var') {
        // Server explicitly mentions env var — MATCH
        return 'MATCH';
      }
      if (fm === 'missing_auth') {
        // Auth failure — could be env var or other auth mechanism
        // Check stderr for env var specific language
        const stderr = runtime.stderr || '';
        if (/env(?:ironment)?\s*(?:var(?:iable)?)?/i.test(stderr)) {
          return 'MATCH';
        }
        // Auth failure without env var mention — can't confirm MATCH
        return 'UNKNOWN';
      }
      if (fm === 'runtime_crash' || fm === 'package_not_found' || fm === 'transport_failure') {
        // Server crashed or package broken — didn't actually check env vars
        return 'UNKNOWN';
      }
      if (fm === 'missing_argument') {
        // Server needs command-line args, not env vars
        return 'UNKNOWN';
      }
      // Legacy: no failureMode captured
      return 'MATCH';
    }
    if (runtime.handshake === 'FAIL') {
      // Handshake failed — could be missing env vars or other issue
      return 'UNKNOWN';
    }
    return 'UNKNOWN';
  }

  return 'UNKNOWN';
}

/**
 * Classify package args (same logic as env vars but for package arguments)
 */
function classifyPackageArgs(regServer, scanResult) {
  const declared = regServer.declaredPackageArgs || [];
  const runtime = scanResult?.runtime;

  if (declared.length === 0 && (!runtime || runtime.error)) return 'UNKNOWN';
  if (declared.length === 0 && runtime) {
    // Package args are rarely observed at runtime — they're install-time
    return 'N/A';
  }
  if (declared.length > 0 && (!runtime || runtime.error)) return 'UNKNOWN';
  if (declared.length > 0 && runtime) {
    // Package args are install-time, not runtime — if the server launched,
    // the args were either provided or not needed
    if (runtime.handshake === 'PASS' || runtime.handshake === 'CONFIG_REQUIRED') {
      return 'DECLARED_UNOBSERVED';
    }
    return 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/**
 * Classify runtime args
 */
function classifyRuntimeArgs(regServer, scanResult) {
  const declared = regServer.declaredRuntimeArgs || [];
  const runtime = scanResult?.runtime;
  const failureMode = runtime?.failureMode || null;

  if (declared.length === 0 && (!runtime || runtime.error)) return 'UNKNOWN';
  if (declared.length === 0 && runtime) {
    if (runtime.handshake === 'CONFIG_REQUIRED') {
      // Use failureMode to distinguish arg demand from env var demand or crash
      if (failureMode === 'missing_argument') {
        return 'OBSERVED_UNDECLARED';
      }
      // Env var, auth, crash, transport failures are not runtime arg observations
      return 'UNKNOWN';
    }
    if (runtime.handshake === 'PASS') return 'N/A';
    return 'UNKNOWN';
  }
  if (declared.length > 0 && (!runtime || runtime.error)) return 'UNKNOWN';
  if (declared.length > 0 && runtime) {
    if (runtime.handshake === 'PASS') return 'DECLARED_UNOBSERVED';
    if (runtime.handshake === 'CONFIG_REQUIRED') {
      if (failureMode === 'missing_argument') {
        return 'MATCH';
      }
      return 'UNKNOWN';
    }
    return 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/**
 * Classify headers (remote-only)
 */
function classifyHeaders(regServer, scanResult) {
  const declared = regServer.declaredHeaders || [];
  const transport = regServer.transport;

  // Headers only apply to remote transports
  if (transport !== 'remote' && transport !== 'both') {
    return 'N/A';
  }

  const runtime = scanResult?.runtime;
  if (!runtime || runtime.error) return 'UNKNOWN';

  // Headers are observed via HTTP request headers, which the scanner
  // doesn't explicitly check. We can only classify as DECLARED_UNOBSERVED
  // (declared but we didn't verify) or UNKNOWN.
  if (declared.length > 0) {
    if (runtime.handshake === 'PASS') return 'DECLARED_UNOBSERVED';
    return 'UNKNOWN';
  }

  // No declared headers, remote server worked
  if (declared.length === 0 && runtime.handshake === 'PASS') {
    return 'N/A';
  }

  return 'UNKNOWN';
}

/**
 * Classify handshake
 */
function classifyHandshake(scanResult) {
  const runtime = scanResult?.runtime;
  if (!runtime || runtime.error) return 'UNKNOWN';
  if (runtime.handshake === 'PASS') return 'MATCH';
  if (runtime.handshake === 'FAIL') return 'FAIL';
  if (runtime.handshake === 'CONFIG_REQUIRED') return 'FAIL';
  return 'UNKNOWN';
}

/**
 * Classify capabilities (always OBSERVED_UNDECLARED if present, since
 * capabilities are not registry-declared by design)
 */
function classifyCapabilities(scanResult) {
  const runtime = scanResult?.runtime;
  if (!runtime || runtime.error) return 'UNKNOWN';
  if (runtime.capabilities && typeof runtime.capabilities === 'object') {
    const caps = runtime.capabilities;
    // Check if any capabilities are non-empty
    const hasTools = caps.tools !== undefined;
    const hasResources = caps.resources !== undefined;
    const hasPrompts = caps.prompts !== undefined;
    const hasLogging = caps.logging !== undefined;
    const hasCompletions = caps.completions !== undefined;

    if (hasTools || hasResources || hasPrompts || hasLogging || hasCompletions) {
      return 'OBSERVED_UNDECLARED'; // by design — capabilities aren't in registry
    }
    // capabilities: {} — empty, server supports nothing
    return 'OBSERVED_UNDECLARED'; // still observed, just empty
  }
  return 'UNKNOWN';
}

// ============================================================
// Main
// ============================================================

async function main() {
  const args = parseArgs();
  if (!args.registry || !args.scan) {
    process.stderr.write('Usage: node scripts/build-matrix.mjs --registry <file> --scan <file> [--out <file>]\n');
    process.exit(1);
  }

  // Load data
  process.stderr.write(`Loading registry from ${args.registry}...\n`);
  const registry = JSON.parse(readFileSync(args.registry, 'utf8'));
  const regServers = registry.servers || [];

  process.stderr.write(`Loading scan from ${args.scan}...\n`);
  const scan = JSON.parse(readFileSync(args.scan, 'utf8'));
  const scanServers = scan.servers || [];

  // Build registry lookup by name
  const regByName = new Map();
  for (const s of regServers) {
    if (s.name) regByName.set(s.name, s);
  }

  // Build scan lookup by name
  const scanByName = new Map();
  for (const s of scanServers) {
    if (s.serverName) scanByName.set(s.serverName, s);
  }

  // Verify identity join
  let matched = 0;
  let unmatched = 0;
  for (const s of scanServers) {
    if (regByName.has(s.serverName)) matched++;
    else unmatched++;
  }
  process.stderr.write(`Identity join: ${matched}/${scanServers.length} scan servers matched registry\n`);
  if (unmatched > 0) {
    process.stderr.write(`WARNING: ${unmatched} scan servers have no registry match!\n`);
  }

  // Build matrix
  const matrix = [];
  const counts = {
    transport: {},
    envVars: {},
    packageArgs: {},
    runtimeArgs: {},
    headers: {},
    handshake: {},
    capabilities: {},
  };

  for (const scanResult of scanServers) {
    const regServer = regByName.get(scanResult.serverName);
    if (!regServer) {
      // Scan server not in registry — record as unmatched
      matrix.push({
        serverName: scanResult.serverName,
        unmatched: true,
        classifications: {
          transport: 'UNKNOWN',
          envVars: 'UNKNOWN',
          packageArgs: 'UNKNOWN',
          runtimeArgs: 'UNKNOWN',
          headers: 'UNKNOWN',
          handshake: classifyHandshake(scanResult),
          capabilities: classifyCapabilities(scanResult),
        },
        declarations: null,
        observations: {
          handshake: scanResult.runtime?.handshake ?? null,
          capabilities: scanResult.runtime?.capabilities ?? null,
          failureMode: scanResult.runtime?.failureMode ?? null,
          stderr: scanResult.runtime?.stderr ?? null,
          error: scanResult.runtime?.error ?? null,
        },
      });
      continue;
    }

    const classifications = {
      transport: classifyTransport(regServer, scanResult),
      envVars: classifyEnvVars(regServer, scanResult),
      packageArgs: classifyPackageArgs(regServer, scanResult),
      runtimeArgs: classifyRuntimeArgs(regServer, scanResult),
      headers: classifyHeaders(regServer, scanResult),
      handshake: classifyHandshake(scanResult),
      capabilities: classifyCapabilities(scanResult),
    };

    // Count classifications
    for (const [dim, cls] of Object.entries(classifications)) {
      counts[dim][cls] = (counts[dim][cls] || 0) + 1;
    }

    matrix.push({
      serverName: scanResult.serverName,
      unmatched: false,
      classifications,
      declarations: {
        transport: regServer.transport,
        npmSpec: regServer.npmSpec,
        remoteUrl: regServer.remoteUrl,
        declaredEnvVars: regServer.declaredEnvVars || [],
        declaredPackageArgs: regServer.declaredPackageArgs || [],
        declaredRuntimeArgs: regServer.declaredRuntimeArgs || [],
        declaredHeaders: regServer.declaredHeaders || [],
      },
      observations: {
        handshake: scanResult.runtime?.handshake ?? null,
        protocolVersion: scanResult.runtime?.protocolVersion ?? null,
        capabilities: scanResult.runtime?.capabilities ?? null,
        toolCount: scanResult.runtime?.tools ?? null,
        failureMode: scanResult.runtime?.failureMode ?? null,
        stderr: scanResult.runtime?.stderr ?? null,
        error: scanResult.runtime?.error ?? null,
      },
    });
  }

  // Summary
  const summary = {
    scanServers: scanServers.length,
    registryServers: regServers.length,
    matched,
    unmatched,
    classificationCounts: counts,
    // Denominators for each dimension
    denominators: {
      envVars: {
        withDeclarations: matrix.filter(m => !m.unmatched && m.declarations?.declaredEnvVars?.length > 0).length,
        withObservations: matrix.filter(m => !m.unmatched && m.observations?.handshake !== null).length,
        total: matrix.filter(m => !m.unmatched).length,
      },
      packageArgs: {
        withDeclarations: matrix.filter(m => !m.unmatched && m.declarations?.declaredPackageArgs?.length > 0).length,
        total: matrix.filter(m => !m.unmatched).length,
      },
      runtimeArgs: {
        withDeclarations: matrix.filter(m => !m.unmatched && m.declarations?.declaredRuntimeArgs?.length > 0).length,
        total: matrix.filter(m => !m.unmatched).length,
      },
      headers: {
        withDeclarations: matrix.filter(m => !m.unmatched && m.declarations?.declaredHeaders?.length > 0).length,
        total: matrix.filter(m => !m.unmatched).length,
      },
    },
  };

  const output = {
    name: 'Declaration-vs-Observation Matrix',
    description: 'Classification of MCP registry declarations against observed runtime behavior.',
    builtAt: new Date().toISOString(),
    registrySource: args.registry,
    scanSource: args.scan,
    summary,
    servers: matrix,
  };

  const outFile = args.out || 'data/matrix-output.json';
  writeFileSync(outFile, JSON.stringify(output, null, 2));

  process.stderr.write(`\nMatrix built: ${outFile}\n`);
  process.stderr.write(`Summary:\n`);
  process.stderr.write(`  Matched: ${matched}/${scanServers.length}\n`);
  process.stderr.write(`  Classification counts:\n`);
  for (const [dim, cls] of Object.entries(counts)) {
    process.stderr.write(`    ${dim}: ${JSON.stringify(cls)}\n`);
  }
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
