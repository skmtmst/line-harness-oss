#!/bin/bash
set -e
export PATH=/Users/kentakenta/lh-work/tools/hq/ci-local/runtime/node_modules/node/bin:$PATH
fixture_out=/tmp/ci-local-8l407jsp/web-build/work/apps/web/out
git -C /tmp/ci-local-8l407jsp/web-build/work rev-parse HEAD
test -f "$fixture_out/automations/new.html"
fixture_port=$(python3 -c 'import socket; s=socket.socket(); s.bind(("127.0.0.1",0)); print(s.getsockname()[1]); s.close()')
node apps/web/scripts/v8-guard/serve-out.mjs "$fixture_out" "$fixture_port" > /tmp/train41-fixture-server.log 2>&1 &
fixture_server_pid=$!
trap 'kill "$fixture_server_pid" 2>/dev/null || true; wait "$fixture_server_pid" 2>/dev/null || true' EXIT
for attempt in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:$fixture_port/automations/new" > /dev/null; then break; fi
  sleep 0.2
done
curl --fail --silent "http://127.0.0.1:$fixture_port/automations/new" > /dev/null
export V8_GUARD_BASE="http://127.0.0.1:$fixture_port"
node apps/web/scripts/v8-guard/browser-host.mjs --test apps/web/scripts/v8-guard/automation-field-error.test.mjs
