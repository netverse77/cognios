#!/usr/bin/env bash
# scripts/claude-local-regression.sh
#
# Board-mandated regression guard from [COG-111 plan §4 step B] /
# [COG-115#document-spike §2.7]. The Claude Code terminal-with-local-auth
# flow is the most-watched adapter path in this codebase. Any change to
# adapter wiring (registry, builtin types, the in-tree hermes_local spike,
# adapter-utils touchpoints) must keep this regression green.
#
# What this guard runs:
#   1. claude-local package typecheck — surface any TS-level breakage in the
#      `claude_local` adapter or its imports from @paperclipai/adapter-utils.
#   2. claude-local package unit tests — execute.remote.test.ts and any
#      sibling test files. These cover the parse layer, login flow,
#      prompt-cache, skills, and the remote-target wiring, which together
#      are the surface a hermes_local registration change could disturb.
#
# What this guard does NOT do (yet):
#   - Boot a real Paperclip server and run an end-to-end claude_local
#     heartbeat against a real issue. That lives in the broader release
#     smoke (cognios/tests/release-smoke). The board exit criterion only
#     requires that *this* guard run alongside the hermes_local smoke and
#     fail PRs that break the claude_local surface — see the spike doc.
#
# Exit codes:
#   0 — regression suite passed
#   1 — regression suite failed (claude_local broken — DO NOT MERGE)
#   2 — preconditions missing (no pnpm, no workspace install, etc.)

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
CLAUDE_PKG="@paperclipai/adapter-claude-local"

log() {
  printf '[claude-local-regression] %s\n' "$*" >&2
}

die() {
  log "FATAL: $1"
  exit "${2:-2}"
}

if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm not on PATH. Run \`corepack enable && corepack prepare pnpm@9.15.4 --activate\`."
fi

if [[ ! -d "${REPO_ROOT}/node_modules/.pnpm" ]]; then
  die "Workspace deps not installed. Run \`pnpm -w install\` first." 2
fi

cd "${REPO_ROOT}"

set +e
log "Step 1/2: typecheck ${CLAUDE_PKG}"
pnpm --filter "${CLAUDE_PKG}" typecheck
status=$?
set -e
if [[ ${status} -ne 0 ]]; then
  log "FAIL: typecheck broke. The hermes_local spike must not change the claude_local surface."
  exit 1
fi

# claude-local doesn't expose a `pnpm test` script of its own — it's run
# under the root vitest projects config (vitest.config.ts). We invoke vitest
# directly against the package directory so the regression suite stays
# isolated and doesn't pull every other workspace project into scope.
# Vitest CLI lives in the workspace's root .bin (linked from the pnpm
# vstore). Fall back to .pnpm vstore location if the .bin shim got pruned.
VITEST_BIN=""
for candidate in "${REPO_ROOT}/node_modules/.bin/vitest" \
                 "${REPO_ROOT}/node_modules/.pnpm/node_modules/.bin/vitest"; do
  if [[ -x "${candidate}" ]]; then
    VITEST_BIN="${candidate}"
    break
  fi
done
[[ -n "${VITEST_BIN}" ]] || die "Could not find vitest in the workspace. Run \`pnpm -w install\` first." 2

set +e
log "Step 2/2: unit tests for ${CLAUDE_PKG}"
( cd "${REPO_ROOT}/packages/adapters/claude-local" && "${VITEST_BIN}" run )
status=$?
set -e
if [[ ${status} -ne 0 ]]; then
  log "FAIL: claude_local unit tests broke. The hermes_local spike must not break this path."
  exit 1
fi

log "PASS: claude_local regression suite green."
exit 0
