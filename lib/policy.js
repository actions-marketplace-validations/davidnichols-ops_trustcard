// Gate 2 — invocation authorization.
//
// TRUST-SUBSTRATE §10.3 separates two questions that v1 collapses:
//   Gate 1 (continuity): "is this still the capability I established?" — objective,
//     cacheable, lives in trust.js / the changeVector.
//   Gate 2 (authorization): "given that, may THIS invocation, with THESE args, in
//     THIS environment, run?" — subjective, per-relying-party, lives here.
//
// This module is Gate 2. It is deliberately NOT a general policy language (that
// is a deferred research direction — a language would force global agreement and
// destroy the per-relying-party model). It is a small set of composable rule
// predicates evaluated against an invocation, plus a scoped decision store so a
// relying party can cache "I allow capability C for read in dev" without
// re-deriving it on every call.
//
// An invocation is:
//   { relyingParty, tool, args, environment, capabilityDigest? }
//
// A rule is a named predicate returning a verdict:
//   { name, when(invocation) -> bool, verdict: "allow"|"deny"|"require-approval", reason }
// All rules are evaluated, and the most restrictive verdict wins
// (deny > require-approval > allow), making the result order-independent.
// A rule predicate that throws is treated as a deny (fail-closed) rather than
// silently widening access. The default verdict is configurable; "allow" is the
// default for backward compatibility, while "deny" gives a default-deny posture.

// --- Rule constructors -------------------------------------------------------

// Allow calls to a named tool. In a default-deny policy, this is the positive
// counterpart to denyTools. With most-restrictive evaluation, an allow rule never
// overrides a deny/require-approval rule.
export function allowTools(tools, { reason = "policy-allowed-tool" } = {}) {
  const set = new Set(tools);
  return {
    name: `allow-tools(${[...set].join(",")})`,
    when: (inv) => set.has(inv.tool),
    verdict: "allow",
    reason,
  };
}

// Deny (or gate) calls to a named tool.
export function denyTools(tools, { verdict = "deny", reason = "policy-denied-tool" } = {}) {
  const set = new Set(tools);
  return {
    name: `deny-tools(${[...set].join(",")})`,
    when: (inv) => set.has(inv.tool),
    verdict,
    reason,
  };
}

// Require explicit approval for destructive capabilities.
export function requireApprovalForDestructive({ reason = "destructive-requires-approval" } = {}) {
  return {
    name: "require-approval-for-destructive",
    when: (inv) => inv.destructive === true,
    verdict: "require-approval",
    reason,
  };
}

// Restrict a tool to a set of environments (e.g. allow "delete" only in dev).
export function restrictToolToEnvironments(tool, environments, { reason = "tool-not-allowed-in-env" } = {}) {
  const set = new Set(environments);
  return {
    name: `restrict-${tool}-to-env(${[...set].join(",")})`,
    when: (inv) => inv.tool === tool && !set.has(inv.environment),
    verdict: "deny",
    reason,
  };
}

// Constrain a specific argument of a tool with a predicate. The predicate
// receives the arg value; returning false means the invocation is out of scope.
// e.g. constrainArg("delete", "path", (p) => p.startsWith("/data"), ...)
export function constrainArg(tool, argName, predicate, { reason = "arg-out-of-policy-scope", verdict = "deny" } = {}) {
  return {
    name: `constrain-${tool}.${argName}`,
    when: (inv) => inv.tool === tool && argName in (inv.args ?? {}) && !predicate(inv.args[argName]),
    verdict,
    reason,
  };
}

// Forbid a tool from receiving a named argument at all (e.g. no "path" on a
// read-only fetch). Useful against confused-deputy argument smuggling.
export function forbidArg(tool, argName, { reason = "arg-forbidden-by-policy" } = {}) {
  return {
    name: `forbid-${tool}.${argName}`,
    when: (inv) => inv.tool === tool && argName in (inv.args ?? {}),
    verdict: "deny",
    reason,
  };
}

// Require auth scopes for a tool (or all tools if no tool name given).
// The invocation must carry an `authToken` field (an AuthToken from lib/auth.js).
// If no token is present, the call is denied. If the token lacks any required
// scope, the call is denied. Use verdict="require-approval" if you want to
// route insufficient-scope calls to a human instead of hard-deny.
export function requireScopes(scopes, { tool = null, verdict = "deny", reason = "insufficient-scopes" } = {}) {
  const required = Array.isArray(scopes) ? scopes : [scopes];
  return {
    name: tool ? `require-scopes(${required.join(",")})→${tool}` : `require-scopes(${required.join(",")})`,
    when: (inv) => {
      if (tool && inv.tool !== tool) return false;
      // Lazy import to avoid circular dependency at load time.
      // auth.js → (no manifest/policy imports) so this is safe.
      const token = inv.authToken;
      if (!token || !token.isValid) return true; // deny/require-approval
      // Check each required scope
      for (const scope of required) {
        let has = token.scopes.includes(scope) || token.scopes.includes("*");
        if (!has) {
          // Check wildcard scopes (e.g. "read:*" matches "read:files")
          for (const g of token.scopes) {
            if (g.endsWith(":*") && scope.startsWith(g.slice(0, -1))) { has = true; break; }
          }
        }
        if (!has) return true; // missing a required scope → deny
      }
      return false; // all scopes satisfied → don't trigger this rule
    },
    verdict,
    reason,
  };
}

// --- The gate ----------------------------------------------------------------
const VERDICT_RANK = { deny: 3, "require-approval": 2, allow: 1 };

export class InvocationPolicy {
  constructor({ rules = [], defaultVerdict = "allow", onEvent } = {}) {
    this.rules = [...rules];
    this.defaultVerdict = defaultVerdict;
    this.onEvent = onEvent ?? (() => {});
  }

  addRule(rule) {
    this.rules.push(rule);
    return this;
  }

  // Evaluate an invocation against all rules and return the most restrictive
  // verdict among matches. This makes the result independent of rule order:
  // deny > require-approval > allow. A rule predicate that throws is treated as
  // a policy error that fails closed (deny) rather than silently widening access.
  // Returns { verdict, reason, rule, matched }.
  // verdict ∈ "allow" | "deny" | "require-approval".
  authorize(invocation) {
    const matched = [];
    for (const rule of this.rules) {
      try {
        if (rule.when(invocation) === true) {
          matched.push(rule);
        }
      } catch (err) {
        matched.push({
          ...rule,
          verdict: "deny",
          reason: `rule-evaluation-error:${rule.name}:${err.message}`,
          error: err.message,
        });
      }
    }

    if (matched.length === 0) {
      const decision = { verdict: this.defaultVerdict, reason: "default", rule: null, matched: [] };
      this.onEvent({ type: "gate2-decision", invocation: summarizeInvocation(invocation), ...decision });
      return decision;
    }

    matched.sort((a, b) => (VERDICT_RANK[b.verdict] ?? 0) - (VERDICT_RANK[a.verdict] ?? 0));
    const winner = matched[0];
    const decision = {
      verdict: winner.verdict,
      reason: winner.reason ?? winner.name,
      rule: winner.name,
      matched: matched.map((r) => r.name),
    };
    this.onEvent({ type: "gate2-decision", invocation: summarizeInvocation(invocation), ...decision });
    return decision;
  }
}

function summarizeInvocation(inv) {
  return {
    relyingParty: inv?.relyingParty ?? null,
    tool: inv?.tool ?? null,
    environment: inv?.environment ?? null,
    capabilityDigest: inv?.capabilityDigest ?? null,
    subject: inv?.authToken?.subject ?? null,
    scopes: inv?.authToken?.scopes ?? null,
  };
}

// --- Scoped decision store ---------------------------------------------------
// A relying party's cached Gate-2 decisions, keyed by
//   (relyingParty, capabilityDigest|tool, environment).
// This is the "trusted for read in dev, denied in prod" primitive. It stores
// DECISIONS, not capabilities — the cache is invalidated by the caller whenever
// the underlying descriptor or scope changes (continuity is Gate 1's job).
export class ScopedDecisions {
  constructor() {
    this.map = new Map(); // key -> { verdict, reason, scope, recordedAt }
  }

  _key(relyingParty, capability, environment) {
    // JSON-array key avoids delimiter-collision attacks (e.g. a relyingParty or
    // capability value containing the "|" character).
    return JSON.stringify([relyingParty ?? "?", capability ?? "?", environment ?? "*"]);
  }

  record({ relyingParty, capability, environment = "*", verdict, reason = null }) {
    const key = this._key(relyingParty, capability, environment);
    this.map.set(key, { verdict, reason, recordedAt: new Date().toISOString() });
    return this.map.get(key);
  }

  lookup({ relyingParty, capability, environment = "*" }) {
    return (
      this.map.get(this._key(relyingParty, capability, environment)) ??
      this.map.get(this._key(relyingParty, capability, "*")) ??
      null
    );
  }

  clear({ relyingParty, capability, environment = "*" }) {
    this.map.delete(this._key(relyingParty, capability, environment));
  }
}
