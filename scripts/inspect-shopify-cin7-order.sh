#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
SHOPIFY_ORDER_ID="${1:-7344291021105}"
CIN7_ORDER_ID="${2:-529947}"
exec node scripts/inspect-shopify-cin7-order.mjs "$SHOPIFY_ORDER_ID" "$CIN7_ORDER_ID"
