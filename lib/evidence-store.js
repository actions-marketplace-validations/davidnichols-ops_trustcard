// Evidence store — append-only JSONL storage with multi-key indexing.
//
// The evidence store is the core asset of the trustcard evidence substrate.
// It stores evidence records immutably in daily JSONL files and provides
// efficient query access by subject, predicate, timestamp, observer, and ID.
//
// Design (from PHASE-2.5-EVIDENCE-DESIGN.md §5):
//   - Primary storage: data/evidence/YYYY/MM/YYYY-MM-DD.jsonl (one file per day)
//   - One JSON record per line, append-only (never rewrite)
//   - Index: data/evidence/index.json (rebuildable from JSONL files, not source of truth)
//   - Zero external dependencies — pure Node.js stdlib
//
// The index is multi-key: every identifier in subject.identifiers gets its
// own index entry, enabling efficient subject matching by any identifier
// without scanning all records. This is critical for the identity constellation
// model — a subject can be found by registryName, repoUrl, repoId, keyId, etc.
//
// Integrity:
//   - Content-address verification on read (recompute digest, compare)
//   - Append-only (no update or delete API)
//   - Index is a cache — can be deleted and rebuilt at any time
//   - Corruption handling: skip unparseable lines, log errors, continue

import { readFileSync, writeFileSync, appendFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { serializeRecord, parseRecord, verifyEvidenceRecord } from "./evidence.js";
import { IDENTIFIER_STRENGTH, STRENGTH_ORDER } from "./evidence-predicates.js";

// ─── Path helpers ─────────────────────────────────────────────────

/**
 * Compute the JSONL file path for a given timestamp.
 * Format: <root>/YYYY/MM/YYYY-MM-DD.jsonl
 */
export function evidenceFilePath(root, timestamp) {
  const d = new Date(timestamp);
  const yyyy = d.getUTCFullYear().toString();
  const mm = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const dd = d.getUTCDate().toString().padStart(2, "0");
  return join(root, yyyy, mm, `${yyyy}-${mm}-${dd}.jsonl`);
}

/**
 * Compute the index file path for a given root.
 */
export function indexPath(root) {
  return join(root, "index.json");
}

// ─── EvidenceStore class ──────────────────────────────────────────

export class EvidenceStore {
  /**
   * Create or open an evidence store.
   * @param {string} rootDir — the root directory for evidence storage
   * @param {object} [opts] — options
   * @param {boolean} [opts.loadIndex=true] — whether to load the index on construction
   * @param {boolean} [opts.verifyOnRead=true] — whether to verify digests when reading
   */
  constructor(rootDir, opts = {}) {
    if (!rootDir || typeof rootDir !== "string")
      throw new TypeError("EvidenceStore: rootDir must be a string path");
    this.root = rootDir;
    this.verifyOnRead = opts.verifyOnRead ?? true;
    this.index = null;
    if (opts.loadIndex !== false) {
      this._loadIndex();
    }
  }

  // ─── Write ──────────────────────────────────────────────────────

  /**
   * Append an evidence record to the store.
   * The record is validated and written to the daily JSONL file.
   * The index is updated in memory (call flushIndex() to persist).
   *
   * @param {object} record — a verified evidence record (from buildEvidenceRecord)
   * @returns {string} the evidence ID
   * @throws if the record is invalid or already exists
   */
  append(record) {
    // Verify the record is well-formed and its digest is correct
    verifyEvidenceRecord(record);

    // Check for duplicates
    if (this.index?.byId?.has(record.id)) {
      throw new Error(`EvidenceStore: record ${record.id} already exists (duplicate append)`);
    }

    // Ensure the directory exists
    const filePath = evidenceFilePath(this.root, record.timestamp);
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Compute the line number for this record
    let lineNum = 0;
    if (existsSync(filePath)) {
      const existing = readFileSync(filePath, "utf8");
      lineNum = existing.split("\n").filter((l) => l.trim().length > 0).length;
    }

    // Serialize and append (single line, no trailing newline in the string;
    // appendFileSync adds the newline)
    const line = serializeRecord(record);
    appendFileSync(filePath, line + "\n");

    // Update in-memory index with correct file and line
    if (this.index) {
      this._indexRecord(record, filePath, lineNum);
    }

    return record.id;
  }

  /**
   * Append multiple records. More efficient than calling append() in a loop
   * because it groups writes by day file.
   * @param {object[]} records
   * @returns {string[]} the evidence IDs
   */
  appendBatch(records) {
    const ids = [];
    // Group by file path to minimize file opens
    // Track line numbers per file for correct indexing
    const byFile = new Map(); // filePath → { lines: [], records: [] }

    for (const record of records) {
      verifyEvidenceRecord(record);
      if (this.index?.byId?.has(record.id)) {
        throw new Error(`EvidenceStore: record ${record.id} already exists (duplicate append)`);
      }
      const filePath = evidenceFilePath(this.root, record.timestamp);
      if (!byFile.has(filePath)) byFile.set(filePath, { lines: [], records: [] });
      const entry = byFile.get(filePath);
      entry.records.push(record);
      entry.lines.push(serializeRecord(record));
      ids.push(record.id);
    }

    for (const [filePath, { lines, records }] of byFile) {
      const dir = dirname(filePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      // Count existing lines to compute starting line number
      let startLine = 0;
      if (existsSync(filePath)) {
        const existing = readFileSync(filePath, "utf8");
        startLine = existing.split("\n").filter((l) => l.trim().length > 0).length;
      }

      appendFileSync(filePath, lines.join("\n") + "\n");

      // Index each record with its correct line number
      if (this.index) {
        for (let i = 0; i < records.length; i++) {
          this._indexRecord(records[i], filePath, startLine + i);
        }
      }
    }

    return ids;
  }

  // ─── Read ───────────────────────────────────────────────────────

  /**
   * Get a single record by ID.
   * @param {string} id — the evidence ID (ev_sha256:...)
   * @returns {object|null} the record, or null if not found
   */
  getById(id) {
    if (!this.index?.byId?.has(id)) return null;
    const location = this.index.byId.get(id);
    return this._readRecordAt(location, id);
  }

  /**
   * Query evidence records by filter criteria.
   * All filters are optional — omitting a filter means "all".
   *
   * @param {object} filters
   * @param {string|object} [filters.subject] — subject identifier value or { key, value }
   * @param {string} [filters.predicate] — predicate name
   * @param {number} [filters.layer] — evidence layer (0-4)
   * @param {string} [filters.observer] — observer.agent
   * @param {string} [filters.method] — observer.method
   * @param {string} [filters.since] — ISO 8601 timestamp (inclusive)
   * @param {string} [filters.until] — ISO 8601 timestamp (exclusive)
   * @param {number} [filters.limit] — max results
   * @returns {object[]} matching records, sorted by timestamp ascending
   */
  query(filters = {}) {
    // Collect candidate record IDs from the index
    let candidateIds = null;

    // Subject filter: can be a string (any identifier value) or { key, value }
    if (filters.subject !== undefined) {
      let ids;
      if (typeof filters.subject === "string") {
        ids = this.index?.byIdentifier.get(filters.subject) ?? new Set();
      } else if (typeof filters.subject === "object" && filters.subject.key) {
        const key = filters.subject.key;
        const value = filters.subject.value;
        if (value !== undefined) {
          ids = this.index?.byIdentifierKey.get(`${key}:${value}`) ?? new Set();
        } else {
          // All records with this identifier key
          ids = new Set();
          for (const [k, v] of (this.index?.byIdentifierKey ?? new Map())) {
            if (k.startsWith(`${key}:`)) {
              for (const id of v) ids.add(id);
            }
          }
        }
      }
      candidateIds = this._intersect(candidateIds, ids);
    }

    // Predicate filter
    if (filters.predicate !== undefined) {
      const ids = this.index?.byPredicate.get(filters.predicate) ?? new Set();
      candidateIds = this._intersect(candidateIds, ids);
    }

    // Layer filter
    if (filters.layer !== undefined) {
      const ids = this.index?.byLayer.get(filters.layer) ?? new Set();
      candidateIds = this._intersect(candidateIds, ids);
    }

    // Observer filter
    if (filters.observer !== undefined) {
      const ids = this.index?.byObserver.get(filters.observer) ?? new Set();
      candidateIds = this._intersect(candidateIds, ids);
    }

    // Method filter
    if (filters.method !== undefined) {
      const ids = this.index?.byMethod.get(filters.method) ?? new Set();
      candidateIds = this._intersect(candidateIds, ids);
    }

    // If no filters were applied, get all IDs
    if (candidateIds === null) {
      candidateIds = this.index?.byId ? new Set(this.index.byId.keys()) : new Set();
    }

    // Read records and apply time range filter
    let results = [];
    for (const id of candidateIds) {
      const record = this.getById(id);
      if (!record) continue;

      // Time range filters
      if (filters.since && record.timestamp < filters.since) continue;
      if (filters.until && record.timestamp >= filters.until) continue;

      results.push(record);
    }

    // Sort by timestamp ascending
    results.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Apply limit
    if (filters.limit !== undefined && results.length > filters.limit) {
      results = results.slice(0, filters.limit);
    }

    return results;
  }

  /**
   * Get the latest record per predicate for a subject.
   * @param {string|object} subject — subject identifier
   * @returns {object} map of predicate → latest record
   */
  latest(subject) {
    const records = this.query({ subject });
    const byPredicate = new Map();
    for (const record of records) {
      const pred = record.claim.predicate;
      if (!byPredicate.has(pred) || byPredicate.get(pred).timestamp < record.timestamp) {
        byPredicate.set(pred, record);
      }
    }
    return Object.fromEntries(byPredicate);
  }

  /**
   * Get summary statistics about the store.
   * @returns {object} stats object
   */
  stats() {
    if (!this.index) return { totalRecords: 0, totalFiles: 0 };

    const layerCounts = {};
    for (const [layer, ids] of this.index.byLayer) {
      layerCounts[layer] = ids.size;
    }

    const predicateCounts = {};
    for (const [pred, ids] of this.index.byPredicate) {
      predicateCounts[pred] = ids.size;
    }

    const observerCounts = {};
    for (const [obs, ids] of this.index.byObserver) {
      observerCounts[obs] = ids.size;
    }

    return {
      totalRecords: this.index.byId.size,
      totalFiles: this.index.files.size,
      byLayer: layerCounts,
      byPredicate: predicateCounts,
      byObserver: observerCounts,
      bySubject: this.index.subjects.size,
    };
  }

  /**
   * Find all subjects that share a given identifier.
   * This is the identity constellation lookup — find all records that
   * reference the same identifier value, even if under a different key.
   * @param {string} identifierValue
   * @returns {object[]} matching records
   */
  findByIdentifier(identifierValue) {
    return this.query({ subject: identifierValue });
  }

  /**
   * Find contradictions: records for the same subject with the same predicate
   * but different values.
   * @param {string|object} subject
   * @returns {object[]} records that contradict each other, grouped by predicate
   */
  contradictions(subject) {
    const records = this.query({ subject });
    const byPredicate = new Map();
    for (const r of records) {
      const pred = r.claim.predicate;
      if (!byPredicate.has(pred)) byPredicate.set(pred, []);
      byPredicate.get(pred).push(r);
    }

    const contradictions = {};
    for (const [pred, recs] of byPredicate) {
      if (recs.length < 2) continue;
      // Check if any two records have different values
      const values = new Set(recs.map((r) => JSON.stringify(r.claim.value)));
      if (values.size > 1) {
        contradictions[pred] = recs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
      }
    }
    return contradictions;
  }

  // ─── Index management ───────────────────────────────────────────

  /**
   * Rebuild the index from all JSONL files.
   * This is the recovery path — if the index is lost or corrupted,
   * it can be rebuilt from the primary storage.
   * @returns {object} stats about the rebuild
   */
  rebuildIndex() {
    this.index = this._emptyIndex();
    const stats = { files: 0, records: 0, skipped: 0, errors: [] };

    if (!existsSync(this.root)) {
      return stats;
    }

    // Walk the directory tree to find all .jsonl files
    const files = this._findJsonlFiles(this.root);
    stats.files = files.length;

    for (const filePath of files) {
      this.index.files.add(filePath);
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0) continue;
        try {
          const record = parseRecord(line);
          if (this.verifyOnRead) verifyEvidenceRecord(record);
          this._indexRecord(record, filePath, i);
          stats.records++;
        } catch (e) {
          stats.skipped++;
          stats.errors.push({ file: filePath, line: i + 1, error: e.message });
        }
      }
    }

    return stats;
  }

  /**
   * Persist the in-memory index to disk.
   */
  flushIndex() {
    if (!this.index) return;
    const path = indexPath(this.root);
    const dir = dirname(path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    // Serialize sets to arrays for JSON
    const serializable = {
      version: 1,
      builtAt: new Date().toISOString(),
      files: [...this.index.files],
      byId: {}, // id → { file, line }
      byIdentifier: {}, // identifierValue → [ids]
      byIdentifierKey: {}, // "key:value" → [ids]
      byPredicate: {}, // predicate → [ids]
      byLayer: {}, // layer → [ids]
      byObserver: {}, // observer.agent → [ids]
      byMethod: {}, // observer.method → [ids]
      subjects: {}, // "kind:identifierHash" → { identifiers, recordCount }
    };

    for (const [id, loc] of this.index.byId) {
      serializable.byId[id] = loc;
    }
    for (const [key, ids] of this.index.byIdentifier) {
      serializable.byIdentifier[key] = [...ids];
    }
    for (const [key, ids] of this.index.byIdentifierKey) {
      serializable.byIdentifierKey[key] = [...ids];
    }
    for (const [key, ids] of this.index.byPredicate) {
      serializable.byPredicate[key] = [...ids];
    }
    for (const [key, ids] of this.index.byLayer) {
      serializable.byLayer[key] = [...ids];
    }
    for (const [key, ids] of this.index.byObserver) {
      serializable.byObserver[key] = [...ids];
    }
    for (const [key, ids] of this.index.byMethod) {
      serializable.byMethod[key] = [...ids];
    }
    for (const [key, info] of this.index.subjects) {
      serializable.subjects[key] = info;
    }

    writeFileSync(path, JSON.stringify(serializable, null, 2));
  }

  /**
   * Verify the integrity of the entire store.
   * Reads all JSONL files, verifies every record's digest, and checks
   * for duplicate IDs.
   * @returns {object} { verified, totalRecords, errors, duplicates }
   */
  verify() {
    const result = { verified: true, totalRecords: 0, errors: [], duplicates: [] };
    const seenIds = new Set();

    if (!existsSync(this.root)) return result;

    const files = this._findJsonlFiles(this.root);
    for (const filePath of files) {
      const content = readFileSync(filePath, "utf8");
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (line.length === 0) continue;
        try {
          const record = parseRecord(line);
          verifyEvidenceRecord(record);
          result.totalRecords++;

          if (seenIds.has(record.id)) {
            result.duplicates.push({ id: record.id, file: filePath, line: i + 1 });
          }
          seenIds.add(record.id);
        } catch (e) {
          result.errors.push({ file: filePath, line: i + 1, error: e.message });
          result.verified = false;
        }
      }
    }

    if (result.duplicates.length > 0) result.verified = false;
    return result;
  }

  /**
   * Export all evidence records as an array.
   * Useful for dataset publication.
   * @param {object} [filters] — same as query()
   * @returns {object[]}
   */
  export(filters = {}) {
    return this.query(filters);
  }

  /**
   * Clear the store (for testing only).
   * Deletes the entire root directory.
   */
  _clear() {
    if (existsSync(this.root)) {
      rmSync(this.root, { recursive: true, force: true });
    }
    this.index = this._emptyIndex();
  }

  // ─── Internal methods ───────────────────────────────────────────

  _emptyIndex() {
    return {
      files: new Set(),
      byId: new Map(), // id → { file, line }
      byIdentifier: new Map(), // identifierValue → Set<id>
      byIdentifierKey: new Map(), // "key:value" → Set<id>
      byPredicate: new Map(), // predicate → Set<id>
      byLayer: new Map(), // layer → Set<id>
      byObserver: new Map(), // observer.agent → Set<id>
      byMethod: new Map(), // observer.method → Set<id>
      subjects: new Map(), // subjectKey → { identifiers, recordCount }
    };
  }

  _loadIndex() {
    const path = indexPath(this.root);
    if (!existsSync(path)) {
      this.index = this._emptyIndex();
      // Try to rebuild from JSONL files if they exist
      if (existsSync(this.root)) {
        this.rebuildIndex();
      }
      return;
    }

    try {
      const data = JSON.parse(readFileSync(path, "utf8"));
      this.index = this._emptyIndex();
      this.index.files = new Set(data.files ?? []);

      const toSet = (obj) => {
        const m = new Map();
        for (const [k, v] of Object.entries(obj ?? {})) {
          m.set(k, new Set(v));
        }
        return m;
      };

      // byId is special: values are objects, not arrays
      for (const [id, loc] of Object.entries(data.byId ?? {})) {
        this.index.byId.set(id, loc);
      }
      this.index.byIdentifier = toSet(data.byIdentifier);
      this.index.byIdentifierKey = toSet(data.byIdentifierKey);
      this.index.byPredicate = toSet(data.byPredicate);
      this.index.byLayer = toSet(data.byLayer);
      this.index.byObserver = toSet(data.byObserver);
      this.index.byMethod = toSet(data.byMethod);
      this.index.subjects = new Map(Object.entries(data.subjects ?? {}));
    } catch (e) {
      // Corrupt index — rebuild from scratch
      this.index = this._emptyIndex();
      this.rebuildIndex();
    }
  }

  _indexRecord(record, file, line) {
    // If file/line not provided, compute from record
    if (file === undefined) {
      file = evidenceFilePath(this.root, record.timestamp);
    }
    if (line === undefined) {
      // Count lines in the file to find the line number
      try {
        const content = readFileSync(file, "utf8");
        line = content.split("\n").filter((l) => l.trim().length > 0).length - 1;
      } catch {
        line = 0;
      }
    }

    this.index.byId.set(record.id, { file, line });

    // Index by each identifier value and key:value
    for (const [key, value] of Object.entries(record.subject.identifiers)) {
      const valStr = String(value);
      if (!this.index.byIdentifier.has(valStr)) {
        this.index.byIdentifier.set(valStr, new Set());
      }
      this.index.byIdentifier.get(valStr).add(record.id);

      const kvKey = `${key}:${valStr}`;
      if (!this.index.byIdentifierKey.has(kvKey)) {
        this.index.byIdentifierKey.set(kvKey, new Set());
      }
      this.index.byIdentifierKey.get(kvKey).add(record.id);
    }

    // Index by predicate
    if (!this.index.byPredicate.has(record.claim.predicate)) {
      this.index.byPredicate.set(record.claim.predicate, new Set());
    }
    this.index.byPredicate.get(record.claim.predicate).add(record.id);

    // Index by layer
    if (!this.index.byLayer.has(record.claim.layer)) {
      this.index.byLayer.set(record.claim.layer, new Set());
    }
    this.index.byLayer.get(record.claim.layer).add(record.id);

    // Index by observer.agent
    if (!this.index.byObserver.has(record.observer.agent)) {
      this.index.byObserver.set(record.observer.agent, new Set());
    }
    this.index.byObserver.get(record.observer.agent).add(record.id);

    // Index by observer.method
    if (!this.index.byMethod.has(record.observer.method)) {
      this.index.byMethod.set(record.observer.method, new Set());
    }
    this.index.byMethod.get(record.observer.method).add(record.id);

    // Track subjects (for identity constellation)
    const subjectKey = `${record.subject.kind}:${JSON.stringify(record.subject.identifiers)}`;
    if (!this.index.subjects.has(subjectKey)) {
      this.index.subjects.set(subjectKey, {
        kind: record.subject.kind,
        identifiers: record.subject.identifiers,
        recordCount: 0,
      });
    }
    this.index.subjects.get(subjectKey).recordCount++;
  }

  _readRecordAt(location, expectedId) {
    try {
      const content = readFileSync(location.file, "utf8");
      const lines = content.split("\n");
      const line = lines[location.line]?.trim();
      if (!line) return null;
      const record = parseRecord(line);
      if (this.verifyOnRead) verifyEvidenceRecord(record);
      if (expectedId && record.id !== expectedId) return null;
      return record;
    } catch {
      return null;
    }
  }

  _intersect(existing, newSet) {
    if (existing === null) return newSet;
    const result = new Set();
    for (const id of newSet) {
      if (existing.has(id)) result.add(id);
    }
    return result;
  }

  _findJsonlFiles(dir) {
    const files = [];
    if (!existsSync(dir)) return files;

    const entries = readdirSync(dir);
    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stat = statSync(fullPath);
      if (stat.isDirectory()) {
        files.push(...this._findJsonlFiles(fullPath));
      } else if (entry.endsWith(".jsonl")) {
        files.push(fullPath);
      }
    }
    return files.sort();
  }
}
