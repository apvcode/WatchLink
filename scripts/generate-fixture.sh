#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FIXTURES_DIR="$ROOT_DIR/tests/fixtures"
mkdir -p "$FIXTURES_DIR"

OUTPUT_MP4="$FIXTURES_DIR/video.mp4"

if [ -f "$OUTPUT_MP4" ]; then
  echo "Fixture video already exists at $OUTPUT_MP4"
  exit 0
fi

echo "Generating 60-second test video with ffmpeg..."
ffmpeg -y -f lavfi -i testsrc=duration=60:size=640x360:rate=30 \
       -f lavfi -i sine=frequency=440:duration=60 \
       -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest "$OUTPUT_MP4"

echo "Generated test video: $OUTPUT_MP4"
