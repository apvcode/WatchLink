#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "========================================"
echo " WatchLink Verification Gate"
echo "========================================"

export JAVA_HOME="${JAVA_HOME:-$HOME/.jdks/jdk-21}"

echo "--> [1/5] Running Biome Lint & Format Check..."
pnpm run lint

echo "--> [2/5] Running TypeScript Typecheck..."
pnpm run typecheck

echo "--> [3/5] Running Unit Tests..."
if [ -d "packages/core/src/__tests__" ] || [ -d "tests/unit" ]; then
  pnpm run test:unit
else
  echo "No unit tests created yet (empty scaffold), skipping."
fi

echo "--> [4/5] Building Node / Web Packages..."
pnpm run build
mkdir -p apps/android/app/src/main/assets/www
cp -r packages/ui/dist/* apps/android/app/src/main/assets/www/
cp packages/adapters/dist/content-bridge.global.js apps/android/app/src/main/assets/

echo "--> [5/5] Building Android Shell (assembleDebug & tests)..."
(cd apps/android && ./gradlew test assembleDebug --no-daemon)

echo "========================================"
echo "✓ All verification steps PASSED!"
echo "========================================"
