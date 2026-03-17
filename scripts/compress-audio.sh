#!/usr/bin/env bash
set -euo pipefail

# Compress rendered WAV files to OGG and MP3 for the site.
# Run from the repository root: ./scripts/compress-audio.sh
#
# Prerequisites:
#   - ffmpeg installed
#   - WAV files in site-examples/*/ (from render-examples.sh)
#
# Output: site/public/audio/<name>/{tussel,strudel,tidal}.{ogg,mp3}
#
# Note: render-examples.sh only produces tussel.wav. Strudel and Tidal
# audio should be rendered with their respective tools and placed as:
#   site-examples/<name>/strudel.wav
#   site-examples/<name>/tidal.wav
# Currently, Tussel audio is used as a placeholder for all three variants.

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLES_DIR="$REPO_ROOT/site-examples"
OUTPUT_DIR="$REPO_ROOT/site/public/audio"

if ! command -v ffmpeg &>/dev/null; then
  echo "ERROR: ffmpeg is required but not installed."
  exit 1
fi

if [ ! -d "$EXAMPLES_DIR" ] || [ -z "$(ls -A "$EXAMPLES_DIR" 2>/dev/null)" ]; then
  echo "ERROR: No example directories found in $EXAMPLES_DIR"
  exit 1
fi

processed=0

for dir in "$EXAMPLES_DIR"/*/; do
  name="$(basename "$dir")"
  out="$OUTPUT_DIR/$name"
  mkdir -p "$out"

  for variant in tussel strudel tidal; do
    wav="$dir/${variant}.wav"
    if [ ! -f "$wav" ]; then
      echo "SKIP $name/$variant — no WAV file"
      continue
    fi

    echo "COMPRESS $name/$variant..."

    # OGG Vorbis — quality 5 (~160 kbps), good balance of size and quality
    ffmpeg -y -loglevel error -i "$wav" -c:a libvorbis -q:a 5 "$out/${variant}.ogg"

    # MP3 — VBR quality 4 (~165 kbps), fallback for browsers without OGG support
    ffmpeg -y -loglevel error -i "$wav" -c:a libmp3lame -q:a 4 "$out/${variant}.mp3"

    echo "  → $out/${variant}.ogg"
    echo "  → $out/${variant}.mp3"
    ((processed++))
  done
done

echo ""
if [ "$processed" -eq 0 ]; then
  echo "WARNING: No WAV files were found. Did you run ./scripts/render-examples.sh first?"
  exit 1
fi
echo "Done. Compressed $processed variant(s). Files are in site/public/audio/"
echo "Total size:"
du -sh "$OUTPUT_DIR" 2>/dev/null || echo "(empty)"
