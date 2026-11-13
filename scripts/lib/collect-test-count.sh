#!/bin/bash
# scripts/lib/collect-test-count.sh
#
# Print the declared test count across all three Vitest projects (unit,
# integration, live) without running a single test. The one place the
# collect-only command is written; check-doc-versions.sh and
# update-docs-for-release.sh both call it.
#
# How: a `-t` filter that matches no test name gives every test the status
# `pending`, so no hook and no test body runs and nothing touches the network.
# Unlike `vitest list`, it expands every `it.each` row, so the total equals what
# a full run would execute. `derived-facts.mjs test-count-report` refuses the
# report unless it is provably collect-only (no passed, no failed, no failed
# suite, a non-zero total).
#
# No --project: the documented count is every declared test, live included.
# Exit 0 and print the count on success; exit non-zero and print nothing to
# stdout on any failure.

set -euo pipefail

cd "$(dirname "$0")/../.."

TMP=$(mktemp --suffix=.json)
trap 'rm -f "$TMP"' EXIT

# Vitest exits 0 when every test is skipped. A load error in a test file shows
# up in the report as a failed suite, which the report check refuses, so the
# exit code is read from the report rather than from vitest.
npx vitest run -t '^__collect_only_never_matches__$' --reporter=json --outputFile="$TMP" >/dev/null 2>&1 || true

if [ ! -s "$TMP" ]; then
  echo "collect-test-count: vitest wrote no report" >&2
  exit 1
fi

node scripts/lib/derived-facts.mjs test-count-report "$TMP"
