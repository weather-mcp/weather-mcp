#!/bin/bash
# scripts/archive-docs.sh
# Archives completed planning documentation

set -e

ARCHIVE_DIR="docs/archive"
mkdir -p "$ARCHIVE_DIR"

echo "📦 Archiving completed documentation..."
echo ""

# List candidate files for archiving
echo "Conventions (see docs/development/DOCUMENTATION_MAINTENANCE.md):"
echo "  - General/historical docs        -> docs/archive/"
echo "  - Planning-era docs              -> docs/planning/archive/"
echo "  - Shipped plan sets (docs/<name>-*.md) -> docs/plans/ (git mv, no version suffix)"
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
echo "  - Update docs/README.md to remove references"
echo "  - Commit the change: git add . && git commit -m 'docs: archive ${BASENAME} (completed in v${VERSION})'"
