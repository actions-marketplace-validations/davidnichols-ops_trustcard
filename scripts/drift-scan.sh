#!/bin/bash
# Drift scan — run a second scan 24h after the first on the same subject set.
# Usage: ./scripts/drift-scan.sh [registry-file] [evidence-dir]
#
# This script runs the same existence scan as the first run, producing
# evidence records with a new timestamp. The evidence store will then
# contain two observations per subject, enabling drift analysis.

set -euo pipefail

REGISTRY="${1:-data/mcp-registry-2026-07-27.json}"
EVIDENCE_DIR="${2:-data/evidence}"
SAMPLE="${3:-500}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

cd "$PROJECT_DIR"

echo "=== Drift scan ==="
echo "Registry: $REGISTRY"
echo "Evidence store: $EVIDENCE_DIR"
echo "Sample size: $SAMPLE"
echo "Timestamp: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo

# Run the scan with the same parameters as the first run.
# The evidence store appends new records (does not overwrite).
# The --sample flag uses random sampling, so the subject set will differ.
# For true drift analysis, use --full or a fixed subject list.
node scripts/scan-ecosystem.mjs \
  --registry-file "$REGISTRY" \
  --sample "$SAMPLE" \
  --existence-only \
  --evidence-store "$EVIDENCE_DIR" \
  --out "/tmp/trustcard-drift-scan-$(date -u +%Y%m%d).json"

echo
echo "=== Drift analysis ==="
node bin/mcp-trustcard.js evidence verify --evidence-dir "$EVIDENCE_DIR"
echo
node bin/mcp-trustcard.js evidence stats --evidence-dir "$EVIDENCE_DIR"
echo
echo "=== To compare with previous scan: ==="
echo "node bin/mcp-trustcard.js evidence history --subject <name> --evidence-dir $EVIDENCE_DIR"
