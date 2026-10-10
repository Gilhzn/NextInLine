#!/usr/bin/env bash
# One command to run the whole app: database check, server, and the web build of the mobile app on one address.
#   npm run demo   →   http://localhost:4000   (login code: 123456)
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgres://magiali:magiali@localhost:5432/magiali}"

echo "⏳ waiting for PostgreSQL..."
for i in $(seq 1 60); do
  if node -e "const u=new URL(process.env.DATABASE_URL);require('net').connect(+u.port||5432,u.hostname).on('connect',()=>process.exit(0)).on('error',()=>process.exit(1))"; then break; fi
  sleep 1
done

[ -d node_modules ] || npm ci
node scripts/make-env.mjs

if [ "${SKIP_WEB_BUILD:-0}" != "1" ] || [ ! -f apps/mobile/dist/index.html ]; then
  echo "📦 building the app for the browser..."
  (cd apps/mobile && EXPO_NO_TELEMETRY=1 EXPO_PUBLIC_API_URL=same-origin npx expo export --platform web --output-dir dist >/dev/null)
fi

echo "🚀 starting server + app on http://localhost:${PORT:-4000}  (login code 123456)"
cd apps/server
exec env WEB_DIR=../mobile/dist PUBLIC_BASE_URL= npx tsx --env-file=.env src/index.ts
