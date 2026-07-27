# Evidence Store Cost Measurements

> Measured 2026-07-27 after bounded 500-server scan.

---

## Store size

| Metric | Value |
|--------|-------|
| Total records | 1,280 |
| Total subjects | 601 |
| JSONL files | 1 (2026-07-27.jsonl) |
| Disk size | 1.0 MB |
| Records per MB | ~1,280 |
| Avg bytes per record | ~819 |

## Query latency

| Operation | Time |
|-----------|------|
| `evidence query --subject <name>` | 163 ms |
| `evidence history --subject <name>` | 156 ms |
| `evidence stats` | 147 ms |
| `evidence verify` (full integrity check) | 205 ms |

All operations sub-250ms for 1,280 records. No index file used (index
disabled during scan, rebuilt on first query).

## Projection to full ecosystem

| Scale | Records (est.) | Disk (est.) | Verify time (est.) |
|-------|----------------|-------------|---------------------|
| 100 servers | ~211 | ~170 KB | ~50 ms |
| 500 servers | ~1,280 | 1.0 MB | 205 ms |
| 1,000 servers | ~2,560 | 2.0 MB | ~400 ms |
| 18,760 servers (full) | ~48,000 | ~37 MB | ~7.5 s |

Linear scaling. No bottleneck at this scale. The store is a single JSONL
file per day, so verify scans all lines. At 48k records, verify would
take ~7.5 seconds — acceptable for a daily integrity check.

## Records per server

Average: 2.13 records per server (1,280 / 601). Breakdown:
- 1 `identifier-observed` per server (always)
- 0-1 `repository-resolves` or `repository-not-found` (if repoUrl present)
- 0-1 `package-resolves` or `package-not-found` (if npmSpec present)

## No bottleneck identified

At the projected full-ecosystem scale (48k records, 37 MB), no operation
exceeds 10 seconds. No optimization needed for research purposes.
