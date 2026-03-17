#!/usr/bin/env bash
set -euo pipefail

# Render all site example scenes to WAV files.
# Run from the repository root: ./scripts/render-examples.sh
#
# Prerequisites:
#   - pnpm install (dependencies)
#   - pnpm build:packages (tussel CLI must be compiled)
#
# Output: site-examples/<name>/tussel.wav for each example
# Duration: 60 seconds per example (CLI default is 8s)

SECONDS_PER_EXAMPLE=60
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLES_DIR="$REPO_ROOT/site-examples"

cd "$REPO_ROOT"

if ! pnpm exec tussel --help &>/dev/null; then
  echo "ERROR: tussel CLI is not available."
  echo "  Run 'pnpm install && pnpm build:packages' from the repository root first."
  exit 1
fi

if [ ! -d "$EXAMPLES_DIR" ] || [ -z "$(ls -A "$EXAMPLES_DIR" 2>/dev/null)" ]; then
  echo "ERROR: No example directories found in $EXAMPLES_DIR"
  exit 1
fi

rendered=0
failures=()

for dir in "$EXAMPLES_DIR"/*/; do
  name="$(basename "$dir")"
  scene_file="$dir/tussel.scene.ts"

  if [ ! -f "$scene_file" ]; then
    echo "SKIP $name — no tussel.scene.ts"
    continue
  fi

  echo "RENDER $name ($SECONDS_PER_EXAMPLE seconds)..."
  if pnpm exec tussel render "$scene_file" \
      --out "$dir/tussel.wav" \
      --seconds "$SECONDS_PER_EXAMPLE"; then
    echo "  → $dir/tussel.wav"
    ((rendered++))
  else
    echo "  ERROR: Failed to render $name"
    failures+=("$name")
  fi
done

echo ""
if [ ${#failures[@]} -gt 0 ]; then
  echo "WARNING: ${#failures[@]} example(s) failed to render: ${failures[*]}"
fi
echo "Rendered $rendered example(s). WAV files are in site-examples/*/"
echo "Next: run ./scripts/compress-audio.sh to produce OGG/MP3 for the site."
