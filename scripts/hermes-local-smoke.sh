#!/usr/bin/env bash
# scripts/hermes-local-smoke.sh
#
# H3 / H4 board-mandated smoke test for the in-tree hermes_local adapter.
# Drives an ACP exchange against `python -m acp_adapter.entry` and asserts
# the adapter's process registry spawned a real child, the JSON-RPC framing
# round-trips, and exitCode is 0 (success).
#
# Four modes (the smoke driver picks one based on flags / env):
#   1. --bridge (HERMES_SMOKE_BRIDGE=1) — COG-137 / COG-116 bridge integration.
#      Seeds a fact in Hermes' MemoryStore, syncs a synthetic Paperclip
#      skill into ${HERMES_HOME}/skills/paperclip/, then drives
#      experimental/factSearch + the heartbeat-memory-bridge round-trip
#      against a live ACP child. Provider-independent (never calls
#      session/new), but strictly more thorough than --initialize-only —
#      proves both COG-116 acceptance criteria literally pass. CI default
#      when ADAPTER_HERMES_LOCAL=1.
#   2. --initialize-only (HERMES_SMOKE_INITIALIZE_ONLY=1) — wire-format-only
#      mode. Runs `initialize` only and asserts a numeric protocolVersion
#      came back. Provider-independent. Preserved for provider-less envs
#      that cannot pip-install the holographic-memory deps the bridge mode
#      needs. (COG-128.)
#   3. --skip-prompt (HERMES_SMOKE_SKIP_PROMPT=1) — initialize + newSession.
#      Provider-equipped envs (local dev with HERMES_HOME/.env, or a CI
#      job with a secret-injected provider key) that want to validate the
#      session-construction path without driving a full prompt turn.
#   4. (default, no flag) — initialize + newSession + prompt. Full bounded
#      turn. Requires a configured LLM provider. Used when validating the
#      end-to-end ACP contract locally (COG-115 §7 acceptance row 3).
#
# Preconditions (script will fail loudly if they are missing):
#   1. cognios workspace has been `pnpm install`-ed (so @agentclientprotocol/sdk
#      is on disk and the in-tree package's deps resolve).
#   2. Python is available on $PATH (3.10+) AND `acp_adapter.entry` is
#      importable (i.e. the operator's Hermes checkout is set up — set
#      HERMES_REPO_PATH to point at it).
#   3. For mode (1) the holographic-memory deps (`pip install -e ".[acp]"`
#      brings them in via the [memory] extra). Mode (2) does not need this.
#   4. For mode (3) / (4): whatever LLM provider Hermes is configured
#      against has live credentials (Nous Portal / OpenRouter / OpenAI /
#      etc., per acp_adapter/auth.py). Modes (1) and (2) do not need this.
#
# This is the source of truth for the COG-115 §7 acceptance check
# "One real Paperclip heartbeat completes E2E and updates an issue." The
# issue-update step is layered on top of this driver in CI; the driver
# itself proves the live ACP exchange.
#
# Exit codes:
#   0 — smoke passed
#   1 — smoke failed (adapter returned a non-zero exitCode)
#   2 — preconditions missing (missing Python, missing pnpm install, etc.)

set -euo pipefail

REPO_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
ADAPTER_DIR="${REPO_ROOT}/packages/adapters/hermes-local"
SMOKE_TS="${ADAPTER_DIR}/src/cli/smoke.ts"
BRIDGE_SMOKE_TS="${ADAPTER_DIR}/src/cli/bridge-smoke.ts"

log() {
  printf '[hermes-local-smoke] %s\n' "$*" >&2
}

die() {
  log "FATAL: $1"
  exit "${2:-2}"
}

# ---- 1. Preconditions ------------------------------------------------------

# Resolve the requested mode as early as possible — bridge mode targets a
# different TS driver, but every mode requires the same Python / pnpm /
# tsx preconditions, so the rest of the script is shared.
SMOKE_MODE="default"
for arg in "$@"; do
  case "$arg" in
    --bridge) SMOKE_MODE="bridge" ;;
    --initialize-only) SMOKE_MODE="initialize-only" ;;
    --skip-prompt) SMOKE_MODE="skip-prompt" ;;
  esac
done
if [[ "${SMOKE_MODE}" == "default" ]]; then
  if [[ "${HERMES_SMOKE_BRIDGE:-}" == "1" ]]; then
    SMOKE_MODE="bridge"
  elif [[ "${HERMES_SMOKE_INITIALIZE_ONLY:-}" == "1" ]]; then
    SMOKE_MODE="initialize-only"
  elif [[ "${HERMES_SMOKE_SKIP_PROMPT:-}" == "1" ]]; then
    SMOKE_MODE="skip-prompt"
  fi
fi

if [[ "${SMOKE_MODE}" == "bridge" ]]; then
  if [[ ! -f "${BRIDGE_SMOKE_TS}" ]]; then
    die "Cannot find ${BRIDGE_SMOKE_TS}. Run from a COG-137-aware checkout."
  fi
elif [[ ! -f "${SMOKE_TS}" ]]; then
  die "Cannot find ${SMOKE_TS}. Run from a hermes-local-aware checkout."
fi

# pnpm is required for the workspace bin shim (tsx) and for the node_modules
# graph that `await import('@agentclientprotocol/sdk')` needs.
if ! command -v pnpm >/dev/null 2>&1; then
  die "pnpm not on PATH. Run \`corepack enable && corepack prepare pnpm@9.15.4 --activate\`."
fi

# Find a Python interpreter the operator pointed us at, falling back to the
# usual suspects.
HERMES_ACP_COMMAND="${HERMES_ACP_COMMAND:-}"
if [[ -z "${HERMES_ACP_COMMAND}" ]]; then
  for candidate in python3 python py; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      HERMES_ACP_COMMAND="${candidate}"
      break
    fi
  done
fi
[[ -n "${HERMES_ACP_COMMAND}" ]] || die "No Python interpreter found. Set HERMES_ACP_COMMAND."

HERMES_REPO_PATH="${HERMES_REPO_PATH:-${REPO_ROOT}/../hermes-agent}"
if [[ ! -d "${HERMES_REPO_PATH}" ]]; then
  die "HERMES_REPO_PATH=${HERMES_REPO_PATH} is not a directory. Set it to your hermes-agent/ checkout." 2
fi

# Ensure the hermes-agent Python package is importable from that checkout.
if ! ( cd "${HERMES_REPO_PATH}" && "${HERMES_ACP_COMMAND}" -c "import acp_adapter.entry" ) >/dev/null 2>&1; then
  die "Cannot import acp_adapter.entry from ${HERMES_REPO_PATH}. Set up Hermes deps first (see hermes-agent README)." 2
fi

# Resolve the in-tree tsx loader. tsx is a transitive dep, so the .bin shim
# location varies by pnpm/Node setup. Probe the usual suspects.
TSX_BIN=""
for candidate in "${REPO_ROOT}/node_modules/.bin/tsx" \
                 "${REPO_ROOT}/node_modules/.pnpm/node_modules/.bin/tsx"; do
  if [[ -x "${candidate}" ]]; then
    TSX_BIN="${candidate}"
    break
  fi
done
[[ -n "${TSX_BIN}" ]] || die "Could not find tsx in the workspace. Run \`pnpm -w install\` first." 2

# ---- 2. Run the live ACP exchange -----------------------------------------

log "ACP command: ${HERMES_ACP_COMMAND} -m acp_adapter.entry"
log "ACP cwd:     ${HERMES_REPO_PATH}"
log "Hermes home: ${HERMES_HOME:-<default>}"

cd "${REPO_ROOT}"

# Mode dispatch. SMOKE_MODE is set above from flags / env vars. Each mode
# targets a distinct driver / flag set; the bridge driver lives in its
# own file (bridge-smoke.ts) because its preconditions and assertions
# don't share much with the wire-format smoke (smoke.ts).
case "${SMOKE_MODE}" in
  bridge)
    log "bridge mode: skill sync + experimental/factSearch + heartbeat-memory-bridge round-trip (COG-137)"
    set +e
    "${TSX_BIN}" "${BRIDGE_SMOKE_TS}" \
      --command "${HERMES_ACP_COMMAND}" \
      --hermes-repo "${HERMES_REPO_PATH}" \
      ${HERMES_HOME:+--hermes-home "${HERMES_HOME}"} \
      --timeout-sec "${HERMES_SMOKE_TIMEOUT_SEC:-120}"
    status=$?
    set -e
    ;;
  initialize-only|skip-prompt|default)
    case "${SMOKE_MODE}" in
      initialize-only)
        MODE_FLAG=( --initialize-only )
        log "initialize-only mode: initialize handshake only (no LLM provider required)"
        ;;
      skip-prompt)
        MODE_FLAG=( --skip-prompt )
        log "skip-prompt mode: initialize + newSession only (provider-equipped envs)"
        ;;
      default)
        MODE_FLAG=()
        log "full-turn mode: initialize + newSession + prompt (provider-equipped envs)"
        ;;
    esac
    set +e
    "${TSX_BIN}" "${SMOKE_TS}" \
      --command "${HERMES_ACP_COMMAND}" \
      --hermes-repo "${HERMES_REPO_PATH}" \
      ${HERMES_HOME:+--hermes-home "${HERMES_HOME}"} \
      ${HERMES_MODEL:+--model "${HERMES_MODEL}"} \
      ${HERMES_PROMPT:+--message "${HERMES_PROMPT}"} \
      --timeout-sec "${HERMES_SMOKE_TIMEOUT_SEC:-60}" \
      "${MODE_FLAG[@]}"
    status=$?
    set -e
    ;;
  *)
    die "Unknown smoke mode: ${SMOKE_MODE}"
    ;;
esac

if [[ ${status} -eq 0 ]]; then
  log "PASS"
  exit 0
fi

log "FAIL (exit ${status})"
exit 1
