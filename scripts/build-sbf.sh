#!/usr/bin/env bash
# Pinned SBF build of programs/cc-vrf: fails on the stack-offset warning (cargo-build-sbf exits 0 on it)
# and writes target/deploy/cc_vrf.so.sha256 for the deploy runbook. Usage: bash scripts/build-sbf.sh [args]
set -euo pipefail
cd "$(dirname "$0")/.."

# RC1 (deployed on both clusters) is platform-tools v1.52, sBPF v0; cargo-build-sbf 4.x defaults to v3, which v1.52 refuses.
TOOLS_VERSION="${TOOLS_VERSION:-v1.52}"
ARCH="${ARCH:-v0}"
# Shared machine: other sessions run builds and test suites too.
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
LOG=target/build-sbf.log
mkdir -p target
cargo-build-sbf --tools-version "$TOOLS_VERSION" --arch "$ARCH" "$@" -- --locked 2>&1 | tee "$LOG"

# Test-only settlement program for the ring suites; own workspace, never deployed (SKIP_MOCK=1 skips it).
if [ "${SKIP_MOCK:-}" != 1 ]; then
  [ -f tests/mock-consumer/Cargo.lock ] || cp Cargo.lock tests/mock-consumer/Cargo.lock
  cargo-build-sbf --manifest-path tests/mock-consumer/Cargo.toml --tools-version "$TOOLS_VERSION" --arch "$ARCH" \
    --sbf-out-dir target/test-programs 2>&1 | tee -a "$LOG"
  touch target/test-programs/mock_consumer.so
fi

if grep -qE "Stack offset of [0-9]+ exceeded max offset" "$LOG"; then
  echo
  echo "BUILD REJECTED — SBF stack overflow (the .so was still written and will fault at runtime):"
  grep -E "Stack offset of [0-9]+ exceeded max offset" "$LOG" | sed 's/^/  /'
  exit 1
fi

SO=target/deploy/cc_vrf.so
# cargo leaves an up-to-date .so untouched; the mtime is what the test suites' stale-binary guard reads.
touch "$SO"
printf '%s  %s bytes  tools %s arch %s\n' "$(shasum -a 256 "$SO" | cut -d' ' -f1)" "$(wc -c < "$SO" | tr -d ' ')" \
  "$TOOLS_VERSION" "$ARCH" | tee "$SO.sha256"
echo "SBF stack OK"
