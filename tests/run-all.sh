#!/bin/sh
# Runs the mock-based suites, each against a fresh mock server (they share the pool state).
set -e
cd "$(dirname "$0")/.."

PORT="${PORT:-38281}"
URL="${URL:-http://localhost:3000}"

if ! curl -s -o /dev/null "${URL}/index.html"; then
    echo "No web server on ${URL}. Start one with ./start.sh or: python3 -m http.server 3000" >&2
    exit 1
fi

fail=0
for suite in unit.test browser.test page-auto unlock multi-buy trap-on-buy trap-both-ways \
             trap-other-player protocol-fallback cache-stale file-protocol; do
    # trap-other-player needs the bought items to belong to another slot
    # Page 1 is always open, pages 2 and 3 wait for their unlock item.
    extra=""
    case "$suite" in
        # These suites do arithmetic on prices and the balance, so no trap may change either.
        multi-buy|page-auto|browser.test) extra="--no-traps" ;;
        trap-other-player) extra="--items-to-other 2" ;;
    esac
    # shellcheck disable=SC2086
    node tests/mock-server.mjs --port "$PORT" --slot Tester --game "Test World" \
        --energy 10000000 --pages 3 --perpage 5 $extra >/tmp/ap-store-mock.log 2>&1 &
    mock_pid=$!
    sleep 1
    printf '%-20s ' "$suite"
    if node "tests/${suite}.mjs" >/tmp/ap-store-test.log 2>&1; then
        tail -1 /tmp/ap-store-test.log
    else
        echo "FAILED"
        tail -12 /tmp/ap-store-test.log
        fail=$((fail + 1))
    fi
    kill "$mock_pid" 2>/dev/null || true
    wait "$mock_pid" 2>/dev/null || true
done

if [ "$fail" -eq 0 ]; then
    echo
    echo "ALL SUITES PASSED"
else
    echo
    echo "$fail suíte(s) failed"
    exit 1
fi
