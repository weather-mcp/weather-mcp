#!/bin/bash
# scripts/archive-docs.sh
# Archives completed planning documentation

set -e

ARCHIVE_DIR=".devdocs/archive/reports"
mkdir -p "$ARCHIVE_DIR"

echo "📦 Archiving completed documentation..."
echo ""

# List candidate files for archiving
echo "Conventions (see .devdocs/README.md):"
echo "  - Superseded reports/status docs -> .devdocs/archive/reports/"
echo "  - Shipped plan sets              -> .devdocs/archive/completed/"
echo ""
echo "NOTE: shipped plan sets are archived automatically by /run-plan as its"
echo "      last step, by plan set and never file-by-file. Do not use this"
echo "      script for them. This is for superseded reports only."
echo ""
echo "Typical candidates: stale status snapshots, superseded guides,"
echo "old RELEASE_NOTES (older than 3 versions)."
echo ""

echo "Which file do you want to archive? (or 'q' to quit)"
read -r FILE_TO_ARCHIVE

if [ "$FILE_TO_ARCHIVE" == "q" ]; then
  echo "Cancelled."
  exit 0
fi

if [ ! -f "$FILE_TO_ARCHIVE" ]; then
  echo "❌ File not found: $FILE_TO_ARCHIVE"
  exit 1
fi

# Get version to tag archived file
echo "What version was this completed in? (e.g., 1.2.0)"
read -r VERSION

BASENAME=$(basename "$FILE_TO_ARCHIVE" .md)
ARCHIVED_NAME="${BASENAME}_v${VERSION}.md"

mv "$FILE_TO_ARCHIVE" "${ARCHIVE_DIR}/${ARCHIVED_NAME}"
echo "✅ Archived to: ${ARCHIVE_DIR}/${ARCHIVED_NAME}"
echo ""
echo "Don't forget to:"
echo "  - Add a '> 📁 ARCHIVED <date>' banner pointing at the live equivalent"
echo "  - Update any doc that linked to it"
echo "  - Commit the change IN weather-mcp-internal (.devdocs is tracked there):"
echo "      git -C ~/work/personal/weather-mcp-internal add -A && \\"
echo "      git -C ~/work/personal/weather-mcp-internal commit -m 'docs: archive ${BASENAME} (completed in v${VERSION})'"
