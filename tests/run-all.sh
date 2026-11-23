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
for suite in unit.test browser.test page-auto unlock hints multi-buy trap-on-buy trap-both-ways \
             trap-other-player trap-restricted-server trap-robust trap-send trap-identity trap-catchup \
             trap-blocked-add trap-get-timeout protocol-fallback cache-stale file-protocol; do
    # trap-other-player needs the bought items to belong to another slot
    # Page 1 is always open, pages 2 and 3 wait for their unlock item.
    extra=""
    case "$suite" in
        # These suites do arithmetic on prices and the balance, so no trap may change either.
        multi-buy|page-auto|browser.test) extra="--no-traps" ;;
        trap-other-player) extra="--items-to-other 2" ;;
        # A patched server that refuses some storage operations (field: AP_BLOCK_SET operation_disabled)
        trap-restricted-server) extra="--block-ops mul,floor" ;;
        # A write the server never answers must not hang the client or burn twice
        trap-robust) extra="--energy 2500000000 --swallow-sets 1" ;;
        # /send items carry no location; no trap may sit in a location of its own here
        trap-send) extra="--energy 2500000000 --no-traps" ;;
        # Traps by /send carry no location: identity is the ordinal, also across a reconnect
        trap-identity) extra="--energy 2500000000 --no-traps" ;;
        # A trap that arrived while the page was closed is caught up on the next connect
        trap-catchup) extra="--energy 2500000000 --swallow-sets 1" ;;
        # A server that refuses the EnergyLink write must not be flooded
        trap-blocked-add) extra="--energy 2500000000 --block-ops add" ;;
        # A server that never answers the Get: the read has to give up instead of hanging
        trap-get-timeout) extra="--energy 2500000000 --swallow-gets" ;;
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
