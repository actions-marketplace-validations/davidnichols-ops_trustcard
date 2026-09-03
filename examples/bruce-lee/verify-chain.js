#!/usr/bin/env node
// verify-chain.js — standalone verifier for Bruce Lee audit logs.
//
// Reads an append-only JSONL audit log, validates the hash chain, and reports
// any integrity violations. Exits non-zero if the chain is broken.
//
// Usage:
//   node examples/bruce-lee/verify-chain.js <path-to-audit.jsonl>
//   node examples/bruce-lee/verify-chain.js /tmp/audit.jsonl --verbose

import { readFileSync, existsSync } from "node:fs";
import { hashJson } from "../../lib/hash.js";

const path = process.argv[2];
const verbose = process.argv.includes("--verbose");

if (!path || !existsSync(path)) {
  console.error("Usage: verify-chain.js <path-to-audit.jsonl> [--verbose]");
  process.exit(2);
}

function computeDigest(record) {
  return hashJson({
    prev: record.prev,
    ts: record.ts,
    agent: record.agent,
    action: record.action,
    rationale: record.rationale,
    kind: record.kind,
    tags: record.tags ?? [],
  });
}

const raw = readFileSync(path, "utf8");
const lines = raw.split("\n").filter((l) => l.trim().length > 0);

let expectedPrev = null;
let errors = 0;
let verified = 0;

for (let i = 0; i < lines.length; i++) {
  let rec;
  try {
    rec = JSON.parse(lines[i]);
  } catch {
    console.error(`✗ line ${i + 1}: malformed JSON`);
    errors++;
    continue;
  }

  if (rec.prev !== expectedPrev) {
    console.error(`✗ line ${i + 1}: chain broken — expected prev=${expectedPrev}, got prev=${rec.prev}`);
    errors++;
    // Can't continue verifying from here — the chain is broken
    if (!verbose) break;
    expectedPrev = rec.digest; // try to continue
  } else {
    const recomputed = computeDigest(rec);
    if (recomputed !== rec.digest) {
      console.error(`✗ line ${i + 1}: digest mismatch — expected ${recomputed}, got ${rec.digest}`);
      errors++;
    } else {
      verified++;
      if (verbose) {
        console.log(`✓ line ${i + 1}: ${rec.id} agent=${rec.agent} action=${rec.action} digest=${rec.digest.slice(0, 20)}...`);
      }
    }
    expectedPrev = rec.digest;
  }
}

console.log(`\n${verified} records verified, ${errors} errors found`);
if (errors > 0) {
  console.error("CHAIN STATUS: BROKEN");
  process.exit(1);
} else {
  console.log("CHAIN STATUS: VALID");
  process.exit(0);
}
