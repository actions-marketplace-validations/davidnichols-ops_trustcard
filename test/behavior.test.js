import { describe, test } from "node:test";
import assert from "node:assert";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  SandboxRuntime,
  InputGenerator,
  OutputComparator,
  BehaviorEngine,
  BehaviorReport,
  RegressionCorpus,
  ReferenceObservation,
} from "../lib/behavior.js";
import { toolsetDigest as identityToolsetDigest } from "../lib/identity.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const FIXTURE = join(__dirname, "fixtures", "behavior-mem-server.js");

function makeRuntime(evil = false, corpusDir = null) {
  return new SandboxRuntime({
    cmd: process.execPath,
    args: [FIXTURE],
    env: { TRUSTCARD_EVIL: evil ? "1" : "0" },
    spawnTimeout: 15_000,
    callTimeout: 10_000,
    detached: true,
    inheritEnv: false,
    cleanupCwd: true,
  });
}

describe("SandboxRuntime", () => {
  test("starts fixture, lists tools, calls a tool, and cleans up", async () => {
    const runtime = makeRuntime(false);
    const identity = await runtime.start();
    assert.ok(identity.tools.length > 0, "expected tools");
    assert.equal(identity.serverInfo.name, "behavior-mem-server");
    const obs = await runtime.call("greet", { name: "Ada" });
    assert.ok(obs.ok, JSON.stringify(obs));
    assert.ok(obs.result?.content?.[0]?.text?.includes("Ada"));
    await runtime.stop();
    assert.ok(!runtime.isAlive() || runtime.client === null);
  });
});

describe("InputGenerator", () => {
  test("produces deterministic probes for fixture tools", () => {
    const tools = [
      {
        name: "greet",
        inputSchema: {
          type: "object",
          properties: { name: { type: "string", minLength: 1 } },
          required: ["name"],
        },
      },
      {
        name: "record_secret",
        inputSchema: {
          type: "object",
          properties: { secret: { type: "string", minLength: 1, description: "Secret token" } },
          required: ["secret"],
        },
      },
    ];
    const g1 = new InputGenerator({ seed: 42, probesPerTool: 10 }).generate(tools);
    const g2 = new InputGenerator({ seed: 42, probesPerTool: 10 }).generate(tools);
    assert.deepStrictEqual(g1, g2);
    assert.ok(g1.some((p) => p.type === "secret_canary"));
    assert.ok(g1.some((p) => p.type === "prompt_injection"));
  });
});

describe("BehaviorEngine (same-contract fixture)", () => {
  test("benign server passes behavioral probes", async () => {
    const runtime = makeRuntime(false);
    const engine = new BehaviorEngine({ runtime, inputGenerator: new InputGenerator({ seed: 1, probesPerTool: 10 }) });
    const report = await engine.run();
    assert.equal(report.target.serverInfo.name, "behavior-mem-server");
    assert.ok(report.probesTotal > 0);
    // No high/critical findings on the well-behaved fixture.
    const severe = report.findings.filter((f) => ["high", "critical"].includes(f.severity));
    assert.equal(severe.length, 0, `unexpected severe findings: ${JSON.stringify(severe)}`);
    assert.ok(["pass", "warn"].includes(report.summary));
    await runtime.stop();
  });

  test("reference and target have identical static tool contract", async () => {
    const refRuntime = makeRuntime(false);
    const ref = await BehaviorEngine.captureReference(refRuntime, { inputGenerator: new InputGenerator({ seed: 1, probesPerTool: 10 }) });
    await refRuntime.stop();

    const tgtRuntime = makeRuntime(true);
    const tgtIdentity = await tgtRuntime.start();
    await tgtRuntime.stop();

    assert.equal(ref.toolsetDigest, tgtIdentity.toolsetDigest);
    assert.equal(ref.toolsetDigest, identityToolsetDigest(tgtIdentity.tools));
  });

  test("malicious same-contract server fails behavioral verification", async () => {
    const refRuntime = makeRuntime(false);
    const reference = await BehaviorEngine.captureReference(refRuntime, { inputGenerator: new InputGenerator({ seed: 1, probesPerTool: 10 }) });
    await refRuntime.stop();

    const corpusDir = mkdtempSync(join(tmpdir(), "behavior-corpus-"));
    const tgtRuntime = makeRuntime(true);
    const corpus = new RegressionCorpus({ dir: corpusDir });
    const engine = new BehaviorEngine({
      runtime: tgtRuntime,
      inputGenerator: new InputGenerator({ seed: 1, probesPerTool: 10 }),
      reference,
      corpus,
    });
    const report = await engine.run();
    await tgtRuntime.stop();

    assert.equal(report.summary, "fail");
    const classes = new Set(report.findings.map((f) => f.divergenceClass));
    assert.ok(classes.has("prompt_injection"), `expected prompt_injection, got ${[...classes]}`);
    assert.ok(classes.has("exfiltration_instruction"), `expected exfiltration_instruction, got ${[...classes]}`);
    assert.ok(classes.has("unexpected_tool_behavior"), `expected canary leak / unexpected_tool_behavior, got ${[...classes]}`);
    assert.ok(classes.has("unexpected_network_attempt"), `expected unexpected_network_attempt, got ${[...classes]}`);
    assert.ok(corpus.list().length > 0);
    // Each finding must be preserved as a distinct corpus artifact.
    assert.equal(corpus.list().length, report.findings.length, `expected ${report.findings.length} corpus artifacts, got ${corpus.list().length}`);
    // probesPassed must count unique failed probes, not total findings.
    const failedProbes = new Set(report.findings.map((f) => f.probe?.id ?? `unknown-${f.id}`));
    assert.equal(report.probesPassed, report.probesTotal - failedProbes.size, `probesPassed ${report.probesPassed} should reflect ${failedProbes.size} failed probes`);

    // Verify the regression artifact is replayable: it captures seed, args, env, and server command.
    const artifact = corpus.load(corpus.list()[0]);
    assert.equal(artifact.serverIdentity.serverInfo.name, "behavior-mem-server");
    assert.ok(artifact.probe.args);
    assert.ok(artifact.targetObservation);

    rmSync(corpusDir, { recursive: true, force: true });
  });
});

describe("OutputComparator", () => {
  test("detects canary leakage in a secret-like output", () => {
    const probe = { id: "test:secret", tool: "record_secret", args: { secret: "TC-CANARY-XYZ" }, type: "secret_canary", canaries: { secret: "TC-CANARY-XYZ" } };
    const tool = { name: "record_secret", inputSchema: { type: "object", properties: { secret: { type: "string" } } } };
    const target = {
      ok: true,
      result: { content: [{ type: "text", text: JSON.stringify({ leaked: "TC-CANARY-XYZ" }) }] },
      error: null,
      timeout: false,
      crash: false,
      stderr: "",
    };
    const comp = new OutputComparator();
    const findings = comp.compare(target, null, { probe, tool });
    assert.ok(findings.some((f) => f.mechanism === "canary_leak"));
    assert.ok(findings.some((f) => f.divergenceClass === "unexpected_tool_behavior"));
  });
});

describe("BehaviorReport", () => {
  test("serializes to stable JSON and computes summary", () => {
    const report = new BehaviorReport({
      target: { serverInfo: { name: "x" }, toolsetDigest: "sha256:abc" },
      probesTotal: 10,
      findings: [
        { severity: "high", divergenceClass: "prompt_injection", toJSON: () => ({ severity: "high" }) },
      ],
    });
    assert.equal(report.summary, "fail");
    const json = report.toJSON();
    assert.equal(json.summary, "fail");
    assert.equal(json.probesTotal, 10);
    assert.equal(json.probesPassed, 9);
  });

  test("probesPassed counts unique probes when multiple findings come from one probe", () => {
    const probe = { id: "p1" };
    const report = new BehaviorReport({
      target: { serverInfo: { name: "x" }, toolsetDigest: "sha256:abc" },
      probesTotal: 10,
      findings: [
        { severity: "high", divergenceClass: "prompt_injection", probe },
        { severity: "high", divergenceClass: "exfiltration_instruction", probe },
      ],
    });
    assert.equal(report.probesPassed, 9, "two findings from one probe should only count as one failed probe");
  });
});
