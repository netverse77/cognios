export const type = "hermes_local";
export const label = "Hermes Agent (local)";

// Models declared here are placeholders for the spike. Real model discovery
// happens via the ACP `initialize` / session model state once H2 wires the
// long-lived ACP client. See COG-115#document-spike.
export const models = [
  { id: "hermes-default", label: "Hermes (default)" },
];

export const agentConfigurationDoc = `# hermes_local agent configuration

Adapter: hermes_local (in-tree spike — feature-flagged behind ADAPTER_HERMES_LOCAL=1)

Transport: ACP (Agent Client Protocol) over stdio against hermes-agent/acp_adapter/server.py.
Process model: long-lived per agent, recycled on adapterConfig change or health-check failure.
See COG-115 spike doc for full rationale.

Core fields:
- cwd (string, optional): default absolute working directory fallback for the Hermes process and ACP sessions
- hermesHome (string, optional): HERMES_HOME directory for the spawned process; defaults to ~/.hermes (matches hermes_constants.get_hermes_home()). Used by the COG-116 skills/memory bridge to write skills under \${hermesHome}/skills/paperclip/
- hermesAcpCommand (string, optional): defaults to "python" — interpreter used to launch the ACP server
- hermesAcpArgs (string[], optional): defaults to ["-m", "acp_adapter.entry"]
- hermesRepoPath (string, optional): absolute path to the hermes-agent/ checkout used as cwd for the spawned process when not running from a packaged install
- model (string, optional): Hermes model id passed through to the ACP session
- promptTemplate (string, optional): run prompt template; when set, Paperclip prepends a Paperclip-API auth-guard prompt fragment (parity with the existing npm-backed adapter)
- maxTurnsPerRun (number, optional): soft per-turn budget; forwarded to Hermes' IterationBudget
- env (object, optional): KEY=VALUE environment variables added on top of the Paperclip-injected PAPERCLIP_* set
- workspaceStrategy (object, optional): execution workspace strategy (currently { type: "git_worktree", baseRef?, branchTemplate?, worktreeParentDir? })

Operational fields:
- timeoutSec (number, optional): hard wall-clock turn budget; on expiry the adapter sends ACP cancel(session_id) → SIGTERM → SIGKILL
- graceSec (number, optional): SIGTERM grace period in seconds before SIGKILL

Notes:
- This is the in-tree COG-115 spike adapter for Hermes. It is OFF by default and is registered only when the server starts with ADAPTER_HERMES_LOCAL=1. Otherwise the legacy npm-backed adapter (hermes-paperclip-adapter) handles hermes_local.
- Strictly additive: this adapter does not modify or interact with claude_local, codex_local, Cursor, Bash, HTTP, or OpenClaw flows. The board-protected terminal-Claude-Code-with-local-auth path is unaffected.
- Paperclip injects PAPERCLIP_RUN_ID, PAPERCLIP_TASK_ID, PAPERCLIP_AGENT_ID, PAPERCLIP_API_URL, PAPERCLIP_API_KEY into the Hermes process env at spawn so Hermes' Paperclip skill can mutate issues with the run JWT.
- Provider auth (Nous Portal / OpenRouter / OpenAI / etc.) is detected by hermes-agent/acp_adapter/auth.py at the ACP initialize step; the adapter passes through whatever the operator already configured for Hermes.
`;
