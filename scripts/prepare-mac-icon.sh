#!/usr/bin/env bash
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "macOS icon generation requires macOS because it uses sips and iconutil." >&2
  exit 1
fi

SOURCE_ICON="${1:-build/icon.png}"
ICONSET_DIR="build/icon.iconset"
OUTPUT_ICON="build/icon.icns"

if [[ ! -f "$SOURCE_ICON" ]]; then
  echo "Source icon not found: $SOURCE_ICON" >&2
  exit 1
fi

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

sips -z 16 16 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SOURCE_ICON" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null

if ! iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICON"; then
  node - "$ICONSET_DIR" "$OUTPUT_ICON" <<'NODE'
const { readFileSync, writeFileSync } = require('fs')
const { join } = require('path')

const iconsetDir = process.argv[2]
const outputIcon = process.argv[3]
const entries = [
  ['icp4', 'icon_16x16.png'],
  ['icp5', 'icon_32x32.png'],
  ['ic12', 'icon_32x32@2x.png'],
  ['ic07', 'icon_128x128.png'],
  ['ic08', 'icon_256x256.png'],
  ['ic09', 'icon_512x512.png'],
  ['ic10', 'icon_512x512@2x.png'],
].map(([type, fileName]) => [type, readFileSync(join(iconsetDir, fileName))])

const totalSize = 8 + entries.reduce((sum, [, data]) => sum + 8 + data.length, 0)
const output = Buffer.alloc(totalSize)
output.write('icns', 0, 'ascii')
output.writeUInt32BE(totalSize, 4)

let offset = 8
for (const [type, data] of entries) {
  output.write(type, offset, 'ascii')
  output.writeUInt32BE(8 + data.length, offset + 4)
  data.copy(output, offset + 8)
  offset += 8 + data.length
}

writeFileSync(outputIcon, output)
NODE
fi
rm -rf "$ICONSET_DIR"

echo "Created $OUTPUT_ICON"
