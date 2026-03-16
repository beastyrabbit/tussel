#!/usr/bin/env bash
set -euo pipefail

# Render all site example scenes to WAV files.
# Run from the repository root: ./scripts/render-examples.sh
#
# Prerequisites:
#   - pnpm install (dependencies)
#   - The tussel CLI must be functional
#
# Output: site-examples/<name>/tussel.wav for each example

SECONDS_PER_EXAMPLE=60
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLES_DIR="$REPO_ROOT/site-examples"

cd "$REPO_ROOT"

for dir in "$EXAMPLES_DIR"/*/; do
  name="$(basename "$dir")"
  scene_file="$dir/tussel.scene.ts"

  if [ ! -f "$scene_file" ]; then
    echo "SKIP $name — no tussel.scene.ts"
    continue
  fi

  echo "RENDER $name ($SECONDS_PER_EXAMPLE seconds)..."
  pnpm exec tussel render "$scene_file" \
    --out "$dir/tussel.wav" \
    --seconds "$SECONDS_PER_EXAMPLE"
  echo "  → $dir/tussel.wav"
done

echo ""
echo "Done. WAV files are in site-examples/*/"
echo "Next: run ./scripts/compress-audio.sh to produce OGG/MP3 for the site."
