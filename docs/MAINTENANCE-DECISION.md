# Maintenance Mode Decision

> Three-state decision for Trustcard's evidence vs scanner components.
> Date: 2026-07-27.

---

## Decision

| Component | Mode | Rationale |
|-----------|------|-----------|
| **Crypto core** (manifests, signing, pins, guard, proxy) | **SHIP** | Published, stable, 326 tests, no breaking changes. This is the product. |
| **Scanner** (health probes, danger detector, scorecard) | **MAINTAIN** | Published, useful, but not the research frontier. Fix bugs, don't expand. |
| **Evidence substrate** (evidence records, store, adapters, CLI) | **SHIP** | Committed, 130 tests, first real emission completed. Ship as v3.0.0. |
| **Ecosystem scanner** (scan-ecosystem.mjs, crawl-registry.mjs) | **MAINTAIN** | Scripts work but are not productized. Keep as research tools. |
| **Investigation** (identity death, drift analysis) | **RESEARCH** | One investigation completed. Continue only if evidence store produces findings. |

## What SHIP means

- Publish to npm
- Maintain backward compatibility
- Respond to issues and PRs
- Document publicly

## What MAINTAIN means

- Fix bugs
- Keep tests passing
- No new features
- No active promotion

## What RESEARCH means

- Run experiments
- Publish findings
- No commitment to maintain
- May be archived if no findings

## What this means for the next 30 days

1. **Publish v3.0.0** to npm (blocked on npm token — user action needed)
2. **Run one more ecosystem scan** (24h after the first, for drift analysis)
3. **Write up the identity death investigation** as a public finding
4. **Do not build** an agent consumption API, graph index, or evidence federation
5. **Do not expand** the predicate vocabulary without a concrete research question

## Exit criteria

The evidence substrate exits RESEARCH and enters MAINTAIN when:
- At least 3 research questions have been answered with cited evidence IDs
- The evidence store has been exported as a public dataset
- At least one external user has queried the store

Until then, it is research infrastructure that produces findings, not a product.
