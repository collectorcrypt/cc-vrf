#!/usr/bin/env bash
# Light prover 2.0.7 (CLI 0.28.4) on 127.0.0.1:3001 for the light-program-test suites. The public key bucket is
# dead, so the prover verifies keys against a local CHECKSUM served from 127.0.0.1:3010.   bash scripts/test-prover.sh [stop]
set -euo pipefail
BIN="${LIGHT_PROVER_BIN:-$HOME/.config/light/bin/prover-darwin-arm64}"
KEYS_SRC="${LIGHT_KEYS_DIR:-$HOME/.config/light/proving-keys}"
STATE="$(cd "$(dirname "$0")/.." && pwd)/target/prover"
KEYS="$STATE/keys"
mkdir -p "$KEYS"

stop() {
  for p in prover mirror; do
    [ -f "$STATE/$p.pid" ] && kill "$(cat "$STATE/$p.pid")" 2>/dev/null || true
    rm -f "$STATE/$p.pid"
  done
}
if [ "${1:-}" = stop ]; then stop; echo "prover and key mirror stopped"; exit 0; fi
if curl -sf -m 2 http://127.0.0.1:3001/health >/dev/null; then echo "prover already up on :3001"; exit 0; fi
[ "$("$BIN" version)" = "2.0.7" ] || { echo "need prover 2.0.7 at $BIN (light CLI 0.28.4)" >&2; exit 1; }
stop

for k in "$KEYS_SRC"/*.key; do ln -sf "$k" "$KEYS/$(basename "$k")"; done
( cd "$KEYS" && shasum -a 256 ./*.key | sed 's|\./||' > CHECKSUM )
nohup python3 -m http.server 3010 --bind 127.0.0.1 --directory "$KEYS" > "$STATE/mirror.log" 2>&1 &
echo $! > "$STATE/mirror.pid"

nohup env -u REDIS_URL "$BIN" start --keys-dir "$KEYS/" --prover-address 127.0.0.1:3001 \
  --metrics-address 127.0.0.1:9998 --download-url http://127.0.0.1:3010 --server-only > "$STATE/prover.log" 2>&1 &
echo $! > "$STATE/prover.pid"
for _ in $(seq 1 60); do
  curl -sf -m 2 http://127.0.0.1:3001/health >/dev/null && { echo "prover up on :3001, keys mirrored on :3010"; exit 0; }
  sleep 1
done
echo "prover did not become healthy; see $STATE/prover.log" >&2
exit 1
