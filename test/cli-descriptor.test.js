import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TOOL_SEARCH, TOOL_FETCH, clone } from "./helpers.js";

const BIN = new URL("../bin/mcp-trustcard.js", import.meta.url).pathname;

function run(args, { expectFail = false } = {}) {
  try {
    const out = execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, out };
  } catch (e) {
    if (!expectFail) throw e;
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

function writeJson(path, value) { writeFileSync(path, JSON.stringify(value)); }

test("descriptor build / sign / verify / pin round trip via CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "trustcard-desc-"));
  try {
    const keyPath = join(dir, "key.json");
    const toolPath = join(dir, "tool.json");
    const descPath = join(dir, "desc.json");
    const signedPath = join(dir, "signed.json");
    const pinsPath = join(dir, "pins.json");

    run(["keygen", "--out", keyPath]);
    writeJson(toolPath, TOOL_SEARCH);
    run(["descriptor", "build", toolPath, "--key", keyPath, "--out", descPath]);
    const desc = JSON.parse(readFileSync(descPath, "utf8"));
    assert.equal(desc.schema, "trustcard.dev/descriptor@1");
    assert.equal(desc.capability.namespace, "search");
    assert.equal(desc.implementation.kind, "unresolved");
    assert.match(desc.descriptorDigest, /^sha256:/);
    assert.match(desc.capability.interfaceDigest, /^sha256:/);

    run(["descriptor", "sign", descPath, "--key", keyPath, "--out", signedPath]);
    const signed = JSON.parse(readFileSync(signedPath, "utf8"));
    assert.equal(signed.signature.algorithm, "ed25519");

    const v = run(["descriptor", "verify", signedPath, "--json"]);
    const vReport = JSON.parse(v.out);
    assert.equal(vReport.ok, true);
    assert.equal(vReport.keyId, signed.provenance.keyId);

    run(["descriptor", "pin", signedPath, "--pins", pinsPath]);
    const pins = JSON.parse(readFileSync(pinsPath, "utf8"));
    assert.equal(pins.schema, "trustcard.dev/pins@1");
    assert.ok(pins.descriptors[signed.descriptorDigest]);
    assert.equal(pins.descriptors[signed.descriptorDigest].interfaceDigest, signed.capability.interfaceDigest);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("descriptor build from a manifest requires --tool", () => {
  const dir = mkdtempSync(join(tmpdir(), "trustcard-desc-"));
  try {
    const keyPath = join(dir, "key.json");
    const manifestPath = join(dir, "manifest.json");
    run(["keygen", "--out", keyPath]);
    writeJson(manifestPath, { tools: [TOOL_SEARCH, TOOL_FETCH] });

    const r = run(["descriptor", "build", manifestPath, "--key", keyPath], { expectFail: true });
    assert.equal(r.code, 2);
    assert.match(r.out, /select one with --tool/);

    const descPath = join(dir, "desc.json");
    run(["descriptor", "build", manifestPath, "--tool", "fetch_document", "--key", keyPath, "--out", descPath]);
    const desc = JSON.parse(readFileSync(descPath, "utf8"));
    assert.equal(desc.capability.namespace, "fetch_document");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("descriptor build with implementation and claims", () => {
  const dir = mkdtempSync(join(tmpdir(), "trustcard-desc-"));
  try {
    const keyPath = join(dir, "key.json");
    const toolPath = join(dir, "tool.json");
    const descPath = join(dir, "desc.json");
    run(["keygen", "--out", keyPath]);
    writeJson(toolPath, TOOL_SEARCH);

    run([
      "descriptor", "build", toolPath, "--key", keyPath,
      "--namespace", "acme/search",
      "--implementation", JSON.stringify({ kind: "npm-dist", integrity: "sha512-abc123" }),
      "--claims", JSON.stringify({ category: "search" }),
      "--out", descPath,
    ]);
    const desc = JSON.parse(readFileSync(descPath, "utf8"));
    assert.equal(desc.capability.namespace, "acme/search");
    assert.equal(desc.implementation.kind, "npm-dist");
    assert.equal(desc.implementation.integrity, "sha512-abc123");
    assert.equal(desc.claims.category, "search");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("descriptor verify rejects a tampered descriptor", () => {
  const dir = mkdtempSync(join(tmpdir(), "trustcard-desc-"));
  try {
    const keyPath = join(dir, "key.json");
    const toolPath = join(dir, "tool.json");
    const signedPath = join(dir, "signed.json");
    run(["keygen", "--out", keyPath]);
    writeJson(toolPath, TOOL_SEARCH);
    run(["descriptor", "build", toolPath, "--key", keyPath, "--out", join(dir, "desc.json")]);
    run(["descriptor", "sign", join(dir, "desc.json"), "--key", keyPath, "--out", signedPath]);
    const tampered = JSON.parse(readFileSync(signedPath, "utf8"));
    tampered.claims = { evil: true };
    writeJson(signedPath, tampered);

    const v = run(["descriptor", "verify", signedPath, "--json"], { expectFail: true });
    assert.equal(v.code, 1);
    const report = JSON.parse(v.out);
    assert.equal(report.ok, false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("descriptor diff classifies compatible and breaking changes", () => {
  const dir = mkdtempSync(join(tmpdir(), "trustcard-desc-"));
  try {
    const keyPath = join(dir, "key.json");
    const oldTool = clone(TOOL_SEARCH);
    const newTool = clone(TOOL_SEARCH);
    newTool.inputSchema.properties.filter = { type: "string" };
    newTool.inputSchema.required = ["query", "filter"];
    writeJson(join(dir, "old-tool.json"), oldTool);
    writeJson(join(dir, "new-tool.json"), newTool);

    run(["keygen", "--out", keyPath]);
    const oldDesc = join(dir, "old.json");
    const newDesc = join(dir, "new.json");
    run(["descriptor", "build", join(dir, "old-tool.json"), "--key", keyPath, "--out", oldDesc]);
    run(["descriptor", "build", join(dir, "new-tool.json"), "--key", keyPath, "--out", newDesc]);

    const same = run(["descriptor", "diff", oldDesc, oldDesc, "--json"]);
    const sameReport = JSON.parse(same.out);
    assert.equal(same.code, 0);
    assert.equal(sameReport.compatible, true);
    assert.equal(sameReport.vector.interface, "NONE");

    const broken = run(["descriptor", "diff", oldDesc, newDesc, "--json"], { expectFail: true });
    const brokenReport = JSON.parse(broken.out);
    assert.equal(broken.code, 1);
    assert.equal(brokenReport.compatible, false);
    assert.equal(brokenReport.vector.interface, "BREAKING");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
