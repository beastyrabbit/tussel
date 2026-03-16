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
# Note: Currently only tussel.wav is rendered. Strudel and Tidal sources
# are provided as reference notation — their audio must be rendered
# separately using their respective tools and placed as:
#   site-examples/<name>/strudel.wav
#   site-examples/<name>/tidal.wav

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLES_DIR="$REPO_ROOT/site-examples"
OUTPUT_DIR="$REPO_ROOT/site/public/audio"

if ! command -v ffmpeg &>/dev/null; then
  echo "ERROR: ffmpeg is required but not installed."
  exit 1
fi

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
    ffmpeg -y -i "$wav" -c:a libvorbis -q:a 5 "$out/${variant}.ogg" 2>/dev/null

    # MP3 — VBR quality 4 (~165 kbps), Safari fallback
    ffmpeg -y -i "$wav" -c:a libmp3lame -q:a 4 "$out/${variant}.mp3" 2>/dev/null

    echo "  → $out/${variant}.ogg"
    echo "  → $out/${variant}.mp3"
  done
done

echo ""
echo "Done. Compressed audio files are in site/public/audio/"
echo "Total size:"
du -sh "$OUTPUT_DIR" 2>/dev/null || echo "(empty — no WAVs were found)"
