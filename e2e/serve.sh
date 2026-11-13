#!/usr/bin/env bash
# Starts what the text audit opens: the Harbour Control fixture on 8090, then booking-web on 8000.
# Playwright waits for booking-web, so this waits for the fixture first. It stops both when the
# audit ends.
set -e
cd "$(dirname "$0")/.."
trap 'kill 0' EXIT
(cd world/harbour-control && uv run python ../../e2e/harbour-fixture.py) &
until curl -sf -o /dev/null http://localhost:8090/healthz; do sleep 0.5; done
PORT=8000 HOST=127.0.0.1 bun world/booking-web/src/server.ts &
wait
