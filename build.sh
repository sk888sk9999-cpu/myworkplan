#!/usr/bin/env bash
set -euo pipefail
: "${SUPABASE_URL:?Set SUPABASE_URL in Cloudflare Pages environment variables}"
: "${SUPABASE_ANON_KEY:?Set SUPABASE_ANON_KEY in Cloudflare Pages environment variables}"
rm -rf dist
mkdir -p dist
cp index.html app.js styles.css dist/
cat > dist/config.js <<CONFIG
window.TRADEFLOW_CONFIG = {
  SUPABASE_URL: '${SUPABASE_URL}',
  SUPABASE_ANON_KEY: '${SUPABASE_ANON_KEY}'
}
CONFIG
cp public/_headers dist/_headers
