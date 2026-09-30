#!/usr/bin/env bash
# Remove completed / old Monday pulses so unfulfilled (~2293) can fit under the 10k cap.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "=== Preview (no deletes) ==="
node scripts/monday-prune.mjs --all

echo
echo "To delete fulfilled/cancelled/delivered (keeps unfulfilled):"
echo "  node scripts/monday-prune.mjs --all --apply"
echo
echo "Then if items_count is still high, remove pulses not in OMS (old/test):"
echo "  node scripts/monday-prune.mjs --all --apply --drop-unmatched"
echo
echo "Repeat --apply until remaining is 0, then check Monday items_count < 8000."
