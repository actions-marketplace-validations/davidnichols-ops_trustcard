// Foundation audit follow-ups: adversarial probes for the pieces left open
// after the v2.0.0 release hardening audit.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  InvocationPolicy,
  ScopedDecisions,
  allowTools,
  denyTools,
  requireApprovalForDestructive,
  constrainArg,
} from "../lib/policy.js";
import { interfaceDigest } from "../lib/descriptor.js";
import { toolDigest } from "../lib/identity.js";
import { TOOL_SEARCH, TOOL_FETCH } from "./helpers.js";

// --- Gate-2 cache-key adversarial stress --------------------------------------

test("ScopedDecisions: delimiter collision cannot merge distinct relying parties", () => {
  const d = new ScopedDecisions();
  d.record({ relyingParty: "a|b", capability: "c", environment: "prod", verdict: "allow" });
  d.record({ relyingParty: "a", capability: "b|c", environment: "prod", verdict: "deny" });
  assert.equal(d.lookup({ relyingParty: "a|b", capability: "c", environment: "prod" }).verdict, "allow");
  assert.equal(d.lookup({ relyingParty: "a", capability: "b|c", environment: "prod" }).verdict, "deny");
});

test("ScopedDecisions: more specific environment decision overrides wildcard", () => {
  const d = new ScopedDecisions();
  d.record({ relyingParty: "agent-a", capability: "sha256:cap1", environment: "*", verdict: "allow" });
  d.record({ relyingParty: "agent-a", capability: "sha256:cap1", environment: "prod", verdict: "deny" });
  // Exact environment lookup finds the prod-specific deny
  assert.equal(d.lookup({ relyingParty: "agent-a", capability: "sha256:cap1", environment: "prod" }).verdict, "deny");
  // No exact match falls back to wildcard allow
  assert.equal(d.lookup({ relyingParty: "agent-a", capability: "sha256:cap1", environment: "dev" }).verdict, "allow");
});

// --- Policy-engine determinism / deny-on-uncertainty --------------------------

test("InvocationPolicy: rule order does not change the most restrictive verdict", () => {
  const rulesA = [
    allowTools(["search"]),
    requireApprovalForDestructive(),
    denyTools(["delete_all"]),
  ];
  const rulesB = [...rulesA].reverse();

  const pA = new InvocationPolicy({ rules: rulesA });
  const pB = new InvocationPolicy({ rules: rulesB });

  // delete_all: all three rules match; deny is most restrictive
  assert.equal(pA.authorize({ tool: "delete_all", destructive: true }).verdict, "deny");
  assert.equal(pB.authorize({ tool: "delete_all", destructive: true }).verdict, "deny");

  // search: allow and require-approval do not match; default allow
  assert.equal(pA.authorize({ tool: "search", destructive: false }).verdict, "allow");
  assert.equal(pB.authorize({ tool: "search", destructive: false }).verdict, "allow");
});

test("InvocationPolicy: same invocation yields deterministic verdict", () => {
  const p = new InvocationPolicy({
    rules: [denyTools(["delete_all"]), requireApprovalForDestructive()],
  });
  const inv = { tool: "delete_all", destructive: true };
  const a = p.authorize(inv);
  const b = p.authorize(inv);
  assert.deepEqual(a, b);
  assert.equal(a.verdict, "deny");
});

test("InvocationPolicy: defaultVerdict 'deny' denies when no rule matches", () => {
  const p = new InvocationPolicy({
    rules: [allowTools(["search"])],
    defaultVerdict: "deny",
  });
  assert.equal(p.authorize({ tool: "search" }).verdict, "allow");
  assert.equal(p.authorize({ tool: "delete_all" }).verdict, "deny");
});

test("InvocationPolicy: a throwing predicate fails closed with a rule-evaluation-error", () => {
  const p = new InvocationPolicy({
    rules: [
      { name: "broken", when: () => { throw new Error("predicate failure"); }, verdict: "allow" },
      allowTools(["search"]),
    ],
  });
  const decision = p.authorize({ tool: "search" });
  assert.equal(decision.verdict, "deny");
  assert.ok(decision.reason.includes("rule-evaluation-error"));
  assert.ok(decision.matched.includes("broken"));
});

// --- v1 compatibility parity --------------------------------------------------

test("interfaceDigest remains byte-equal to toolDigest for v1 compatibility", () => {
  assert.equal(interfaceDigest(TOOL_SEARCH), toolDigest(TOOL_SEARCH));
  assert.equal(interfaceDigest(TOOL_FETCH), toolDigest(TOOL_FETCH));
  // descriptor identity depends on this invariant; pins/receipts break if it changes.
  assert.notEqual(interfaceDigest(TOOL_SEARCH), interfaceDigest(TOOL_FETCH));
});
