#!/bin/bash
# AESP — Build acegf-wallet WASM and copy artifacts
#
# Usage: ./scripts/build-wasm.sh [release|debug]
#
# This script:
# 1. Builds acegf-wallet WASM via its build script
# 2. Copies the WASM artifacts into this project's wasm/ directory

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ACEGF_ROOT="${ACEGF_ROOT:-$(cd "$SCRIPT_DIR/../../dev.acegf-wallet" 2>/dev/null && pwd)}"
if [ -z "$ACEGF_ROOT" ] || [ ! -d "$ACEGF_ROOT" ]; then
  echo "❌ Error: acegf-wallet not found."
  echo "   Set ACEGF_ROOT env variable or place the repo at ../dev.acegf-wallet"
  exit 1
fi
WASM_OUT="$PROJECT_ROOT/wasm"

MODE="${1:-release}"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  AESP — Building acegf-wallet WASM ($MODE)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Build WASM
echo "🔨 Building WASM..."
"$ACEGF_ROOT/scripts/build-wasm.sh" "$MODE"

# Ensure output directory exists
mkdir -p "$WASM_OUT"

# Copy artifacts
echo "📦 Copying WASM artifacts to $WASM_OUT..."
cp "$ACEGF_ROOT/pkg/acegf.js"            "$WASM_OUT/"
cp "$ACEGF_ROOT/pkg/acegf.d.ts"          "$WASM_OUT/"
cp "$ACEGF_ROOT/pkg/acegf_bg.wasm"       "$WASM_OUT/"
cp "$ACEGF_ROOT/pkg/acegf_bg.wasm.d.ts"  "$WASM_OUT/"

echo ""
echo "✅ WASM artifacts copied successfully"
echo "   $WASM_OUT/acegf.js"
echo "   $WASM_OUT/acegf.d.ts"
echo "   $WASM_OUT/acegf_bg.wasm"
echo "   $WASM_OUT/acegf_bg.wasm.d.ts"
echo ""
