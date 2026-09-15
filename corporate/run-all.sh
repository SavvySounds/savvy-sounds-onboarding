#!/bin/bash
# Everything that proves the corporate onboarding brain, in order.
# Red anywhere means this exits red. Nothing here pops a window or makes a sound.
set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BENCH="$(dirname "$HERE")"
cd "$BENCH" || exit 2

FAILED=0
step () {
  echo ""
  echo "=============================================================="
  echo "$1"
  echo "=============================================================="
}

step "1 of 3 — the checks"
if python3 -m unittest discover -s corporate/tests -t .; then
  echo "checks: green"
else
  echo "checks: RED"
  FAILED=1
fi

step "2 of 3 — breaking it on purpose"
if [ "$FAILED" -ne 0 ]; then
  echo "skipped: the checks are red, so every mutation would look caught."
  echo "         fix the checks first."
else
  if python3 corporate/tests/mutate.py; then
    echo "mutations: every one caught"
  else
    echo "mutations: something survived, or the runner refused to start"
    FAILED=1
  fi
fi

step "3 of 3 — the walk through the real screens"
if node corporate/proof/walk.mjs; then
  echo "walk: green"
else
  echo "walk: RED"
  FAILED=1
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All green."
else
  echo "SOMETHING IS RED. Read the section above that says so."
fi
exit "$FAILED"
