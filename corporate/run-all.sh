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

step "1 of 5 — the sweeps"
if python3 -m unittest discover -s corporate/tests -t .; then
  echo "checks: green"
else
  echo "checks: RED"
  FAILED=1
fi

step "2 of 5 — the brain"
if node --test corporate/tests/*.test.mjs; then
  echo "brain: green"
else
  echo "brain: RED"
  FAILED=1
fi

step "3 of 5 — breaking it on purpose"
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

step "4 of 5 — the walk through the real screens"
if node corporate/proof/walk.mjs; then
  echo "walk: green"
else
  echo "walk: RED"
  FAILED=1
fi

# Miles's own page, walked on its own: its own seed, its own server on 8800
# (the shared walk above used 8794, the preview uses 8790 and 8793), so the two
# cannot meet even back to back. A busy port is a red walk, never a skipped one.
step "5 of 5 — Miles's page, walked on its own"
if node corporate/proof/walk-dj.mjs; then
  echo "Miles's walk: green"
else
  echo "Miles's walk: RED"
  FAILED=1
fi

echo ""
if [ "$FAILED" -eq 0 ]; then
  echo "All green."
else
  echo "SOMETHING IS RED. Read the section above that says so."
fi
exit "$FAILED"
