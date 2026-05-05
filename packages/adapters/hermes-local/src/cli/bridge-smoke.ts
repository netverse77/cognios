// COG-137 — bridge integration smoke for COG-116.
//
// Drives an end-to-end exercise of the Hermes ↔ Paperclip bridge against a
// live `python -m acp_adapter.entry` child. Proves both COG-116 acceptance
// criteria literally pass:
//
//   1. Outbound skills: `syncHermesSkills` materializes a Paperclip skill
//      under `${HERMES_HOME}/skills/paperclip/<slug>/SKILL.md` (the same
//      filesystem layout Hermes' `/api/skills` lists).
//   2. Inbound memory: with a fact pre-seeded into Hermes' MemoryStore, the
//      live `experimental/factSearch` ACP method (COG-134) returns the
//      seeded fact, and the cognios `heartbeat-memory-bridge` (COG-135)
//      surfaces it on `memorySnippets`.
//
// The smoke uses the same `HermesProcessRegistry` + `createAcpClient` path
// that production heartbeats take, so a successful run is direct evidence
// that the bridge cannot silently break.
//
// Mode: provider-independent. We never call `session/new` or `prompt`, so
// no LLM provider configuration is needed — same constraint posture as the
// existing `--initialize-only` mode. Bridge-mode therefore becomes the new
// CI default once wired up.
//
// Run:
//   pnpm --filter @paperclipai/adapter-hermes-local exec tsx \
//     src/cli/bridge-smoke.ts \
//     --hermes-repo /path/to/hermes-agent

import { spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";

import { createAcpClient } from "../server/acp-client.js";
import { searchFacts } from "../server/memory.js";
import {
  HermesProcessRegistry,
  buildHermesProcessSpec,
  type HermesProcessHandle,
} from "../server/process-registry.js";
import { syncHermesSkills } from "../server/skills.js";
import type { AdapterExecutionContext } from "@paperclipai/adapter-utils";

interface CliArgs {
  hermesRepo: string | null;
  hermesHome: string | null;
  hermesAcpCommand: string | null;
  timeoutSec: number;
}

// Marker phrase the smoke seeds into Hermes' MemoryStore and then queries
// for via experimental/factSearch. **Must be FTS5-safe**: SQLite FTS5
// treats `-` as a NOT operator at the start of a token, so any hyphenated
// identifier like `cog-137-bridge-smoke` causes the MATCH expression to
// fail to parse and the retriever falls back to `[]`. Use unhyphenated
// alphanumeric tokens that are unlikely to appear in any other fact.
const SEED_FACT_MARKER = "novacog137bridgesmoketoken";
const SEED_FACT_CONTENT = `Bridge smoke marker fact ${SEED_FACT_MARKER} synced via experimental factSearch from Paperclip`;
const SEED_FACT_TAGS = "paperclip bridge smoke";
const SKILL_SLUG = "cog-137-bridge-smoke";
const SKILL_DESCRIPTION =
  "Bridge smoke marker skill — proves outbound Paperclip→Hermes skills sync.";

function log(line: string): void {
  process.stderr.write(`[hermes-bridge-smoke] ${line}\n`);
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = {
    hermesRepo: process.env.HERMES_REPO_PATH ?? null,
    hermesHome: process.env.HERMES_HOME ?? null,
    hermesAcpCommand: process.env.HERMES_ACP_COMMAND ?? null,
    timeoutSec: Number(process.env.HERMES_SMOKE_TIMEOUT_SEC ?? "120"),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case "--hermes-repo":
        out.hermesRepo = next ?? null;
        i++;
        break;
      case "--hermes-home":
        out.hermesHome = next ?? null;
        i++;
        break;
      case "--command":
        out.hermesAcpCommand = next ?? null;
        i++;
        break;
      case "--timeout-sec":
        out.timeoutSec = Number(next ?? out.timeoutSec);
        i++;
        break;
      case "--help":
      case "-h":
        process.stdout.write(
          [
            "hermes_local bridge smoke — COG-137",
            "",
            "Flags:",
            "  --hermes-repo <path>    Path to hermes-agent/ checkout (cwd of spawned process)",
            "  --hermes-home <path>    Override HERMES_HOME (default: tmpdir per run)",
            "  --command <bin>         Override interpreter (default: python)",
            "  --timeout-sec <n>       Hard wall-clock budget (default 120)",
            "",
          ].join("\n"),
        );
        process.exit(0);
        break;
      default:
        if (typeof a === "string" && a.startsWith("--")) {
          process.stderr.write(`[hermes-bridge-smoke] unknown flag ${a}\n`);
          process.exit(2);
        }
    }
  }
  return out;
}

async function ensureDir(dir: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
}

async function makeTempDir(prefix: string): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

async function writeSourceSkill(sourceRoot: string): Promise<string> {
  const skillDir = path.join(sourceRoot, SKILL_SLUG);
  await ensureDir(skillDir);
  const body =
    "# COG-137 bridge smoke marker\n" +
    "\n" +
    "Synthetic Paperclip skill written by the bridge smoke driver. The smoke\n" +
    "asserts this skill round-trips through `syncHermesSkills` into Hermes'\n" +
    "Paperclip-managed skills namespace.\n";
  const front =
    "---\n" +
    `name: ${SKILL_SLUG}\n` +
    `description: ${SKILL_DESCRIPTION}\n` +
    "---\n\n";
  await fs.writeFile(path.join(skillDir, "SKILL.md"), `${front}${body}`, "utf8");
  return skillDir;
}

function seedFactInMemoryStore(input: {
  hermesRepo: string;
  hermesHome: string;
  command: string;
  content: string;
  tags: string;
}): void {
  // Spin up a one-shot Python process against the Hermes checkout to insert
  // a fact directly into the on-disk `${HERMES_HOME}/memory_store.db`.
  // We do this BEFORE the ACP child boots so the lazy
  // `FactRetriever(MemoryStore())` constructed inside the ACP server reads
  // the row we just wrote.
  const script =
    "import sys\n" +
    "from plugins.memory.holographic.store import MemoryStore\n" +
    "store = MemoryStore()\n" +
    "row = store.add_fact(content=sys.argv[1], category='general', tags=sys.argv[2])\n" +
    "print('seeded_fact_id=' + str(row.get('fact_id') if isinstance(row, dict) else row))\n";
  const result = spawnSync(
    input.command,
    ["-c", script, input.content, input.tags],
    {
      cwd: input.hermesRepo,
      env: { ...process.env, HERMES_HOME: input.hermesHome },
      encoding: "utf8",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      `seed-fact subprocess exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  }
  if (result.stdout.trim().length > 0) {
    log(`seed: ${result.stdout.trim()}`);
  }
}

interface SmokeContext {
  hermesRepo: string;
  hermesHome: string;
  sourceSkillsRoot: string;
  command: string;
  timeoutSec: number;
}

async function preflight(args: CliArgs): Promise<SmokeContext> {
  const hermesRepo = args.hermesRepo ?? path.resolve(process.cwd(), "../hermes-agent");
  const hermesRepoStat = await fs.stat(hermesRepo).catch(() => null);
  if (!hermesRepoStat || !hermesRepoStat.isDirectory()) {
    throw new Error(`HERMES_REPO_PATH=${hermesRepo} is not a directory.`);
  }

  const command = args.hermesAcpCommand ?? "python";

  const hermesHome = args.hermesHome ?? (await makeTempDir("hermes-bridge-home-"));
  await ensureDir(hermesHome);

  const sourceSkillsRoot = await makeTempDir("hermes-bridge-skills-");
  await writeSourceSkill(sourceSkillsRoot);

  log(`hermes-repo:        ${hermesRepo}`);
  log(`hermes-home (temp): ${hermesHome}`);
  log(`source-skills root: ${sourceSkillsRoot}`);

  return {
    hermesRepo,
    hermesHome,
    sourceSkillsRoot,
    command,
    timeoutSec: args.timeoutSec,
  };
}

function buildAdapterConfig(ctx: SmokeContext): Record<string, unknown> {
  return {
    hermesAcpCommand: ctx.command,
    hermesAcpArgs: ["-m", "acp_adapter.entry"],
    hermesRepoPath: ctx.hermesRepo,
    hermesHome: ctx.hermesHome,
    timeoutSec: ctx.timeoutSec,
    // Inject one synthetic Paperclip runtime skill — same shape as
    // `readPaperclipRuntimeSkillEntries` would produce off the real skills
    // tree (see packages/adapters/hermes-local/src/server/skills.test.ts).
    paperclipRuntimeSkills: [
      {
        key: `paperclipai/paperclip/${SKILL_SLUG}`,
        runtimeName: SKILL_SLUG,
        source: path.join(ctx.sourceSkillsRoot, SKILL_SLUG),
        required: false,
      },
    ],
    paperclipSkillSync: {
      desiredSkills: [`paperclipai/paperclip/${SKILL_SLUG}`],
    },
  };
}

function buildExecutionContext(
  agentId: string,
  companyId: string,
  config: Record<string, unknown>,
  cwd: string,
): AdapterExecutionContext {
  return {
    runId: process.env.PAPERCLIP_RUN_ID ?? `bridge-smoke-${Date.now()}`,
    agent: {
      id: agentId,
      companyId,
      name: "hermes-bridge-smoke",
      adapterType: "hermes_local",
      adapterConfig: config,
    },
    runtime: {
      sessionId: null,
      sessionParams: null,
      sessionDisplayId: null,
      taskKey: process.env.PAPERCLIP_TASK_ID ?? "bridge-smoke-task",
    } as AdapterExecutionContext["runtime"],
    config,
    context: {
      paperclipWorkspace: { cwd },
      taskId: process.env.PAPERCLIP_TASK_ID ?? "bridge-smoke-task",
      paperclipWakePayload: { reason: "bridge-smoke" },
    } as AdapterExecutionContext["context"],
    onLog: async (kind, text) => {
      const stream = kind === "stderr" ? process.stderr : process.stdout;
      stream.write(text.endsWith("\n") ? text : `${text}\n`);
    },
    onMeta: async () => {
      /* no-op for smoke */
    },
    authToken: process.env.PAPERCLIP_API_KEY,
  };
}

async function assertSkillSynced(
  ctx: SmokeContext,
  config: Record<string, unknown>,
  agentId: string,
  companyId: string,
): Promise<void> {
  log("step 1: syncHermesSkills (outbound Paperclip → Hermes)");
  const snapshot = await syncHermesSkills(
    { agentId, companyId, adapterType: "hermes_local", config },
    [],
  );
  const targetPath = path.join(
    ctx.hermesHome,
    "skills",
    "paperclip",
    SKILL_SLUG,
    "SKILL.md",
  );
  const written = await fs.readFile(targetPath, "utf8");
  if (!written.includes(`name: "${SKILL_SLUG}"`)) {
    throw new Error(`synced SKILL.md missing name: "${SKILL_SLUG}"\n---\n${written}`);
  }
  if (!written.includes(`description: "${SKILL_DESCRIPTION}"`)) {
    throw new Error(
      `synced SKILL.md missing expected description; wrote:\n---\n${written}\n---`,
    );
  }
  const matchedEntry = snapshot.entries.find(
    (entry) => entry.key === `paperclipai/paperclip/${SKILL_SLUG}`,
  );
  if (!matchedEntry || matchedEntry.state !== "configured") {
    throw new Error(
      `expected snapshot entry for ${SKILL_SLUG} in state=configured, got ${JSON.stringify(matchedEntry)}`,
    );
  }
  log(`  ✓ wrote ${targetPath}`);
  log(`  ✓ snapshot entry state=${matchedEntry.state}`);
}

async function assertFactSearchRoundtrip(
  handle: HermesProcessHandle,
): Promise<void> {
  log("step 2: experimental/factSearch (live ACP)");
  // Query uses the unhyphenated SEED_FACT_MARKER plus a couple of common
  // tokens from the seeded content. FTS5 treats leading `-` on a token
  // as NOT, so anything like `cog-137` would fail to parse and the
  // retriever would silently return [] — which is the failure mode the
  // first CI run hit (see commit history).
  const query = `${SEED_FACT_MARKER} bridge smoke`;
  const snippets = await searchFacts(handle, query, 3);
  if (snippets.length === 0) {
    throw new Error(
      `experimental/factSearch returned 0 snippets for query="${query}" — seeded fact missing or connection unwired`,
    );
  }
  const matched = snippets.find((s) => s.content.includes(SEED_FACT_MARKER));
  if (!matched) {
    throw new Error(
      `experimental/factSearch returned ${snippets.length} snippet(s) but none contained the seeded marker; got:\n${JSON.stringify(snippets, null, 2)}`,
    );
  }
  if (!matched.factId || typeof matched.score !== "number" || !matched.createdAt) {
    throw new Error(
      `factSearch snippet shape invalid: ${JSON.stringify(matched)}`,
    );
  }
  log(`  ✓ seeded fact returned: factId=${matched.factId} score=${matched.score.toFixed(3)}`);
}

async function assertHeartbeatMemoryBridge(
  handle: HermesProcessHandle,
  agentId: string,
): Promise<void> {
  log("step 3: heartbeat-memory-bridge round-trip (memorySnippets shape)");
  // Mirror the cognios server-side bridge logic without importing across
  // package boundaries (the adapter's tsconfig pins rootDir: "src"). The
  // production bridge — `server/src/services/heartbeat-memory-bridge.ts` —
  // is exhaustively unit-tested in `heartbeat-context.memory.test.ts`
  // (cache, adapter-type gate, lookup misses, query truncation). What the
  // smoke needs to prove is that the memorySnippets payload field literally
  // carries the seeded fact when `searchFacts` is called against a live
  // ACP connection — which is exactly what this step does.
  // Issue title + comment fed into the bridge's query builder. Same
  // FTS5-safe constraint applies: avoid `-` at the start of any token.
  // The seeded marker token is included in the comment so the query
  // resolves to a hit on the seeded fact.
  const issue = {
    id: "issue-bridge-smoke",
    identifier: "COG-137",
    title: `bridge smoke driver query for ${SEED_FACT_MARKER}`,
    assigneeAgentId: agentId,
  };
  const recentCommentBodies = [
    `bridge smoke driver asks Hermes for memory snippets matching ${SEED_FACT_MARKER}`,
  ];
  // Same query construction the production bridge uses (title + comments,
  // joined with blank lines, capped at 512 chars by default).
  const query = [issue.title, ...recentCommentBodies].join("\n\n").slice(0, 512);
  const memorySnippets = await searchFacts(handle, query, 3);
  const payload = { memorySnippets };
  if (!payload.memorySnippets || payload.memorySnippets.length === 0) {
    throw new Error(
      "heartbeat-context payload would carry memorySnippets=[] — bridge silently no-ops",
    );
  }
  const matched = payload.memorySnippets.find((s) =>
    s.content.includes(SEED_FACT_MARKER),
  );
  if (!matched) {
    throw new Error(
      `memorySnippets payload missing seeded marker; got:\n${JSON.stringify(payload, null, 2)}`,
    );
  }
  log(`  ✓ memorySnippets carries seeded fact: factId=${matched.factId}`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ctx = await preflight(args);

  log(`step 0: seeding fact in MemoryStore at ${ctx.hermesHome}/memory_store.db`);
  seedFactInMemoryStore({
    hermesRepo: ctx.hermesRepo,
    hermesHome: ctx.hermesHome,
    command: ctx.command,
    content: SEED_FACT_CONTENT,
    tags: SEED_FACT_TAGS,
  });

  const agentId = process.env.PAPERCLIP_AGENT_ID ?? "bridge-smoke-agent";
  const companyId = process.env.PAPERCLIP_COMPANY_ID ?? "bridge-smoke-company";
  const config = buildAdapterConfig(ctx);
  const execCtx = buildExecutionContext(agentId, companyId, config, ctx.hermesRepo);

  await assertSkillSynced(ctx, config, agentId, companyId);

  const registry = new HermesProcessRegistry();
  const spec = buildHermesProcessSpec({
    agentId,
    companyId,
    config,
    workspaceCwd: ctx.hermesRepo,
  });
  const handle = registry.acquire(spec);
  log(
    `spawned ACP child pid=${handle.child.pid} cwd=${handle.spec.cwd} configIdentity=${handle.spec.configIdentity.slice(0, 12)}`,
  );

  // Surface the Python child's stderr so CI logs the ACP server's startup
  // lines and any holographic-memory init noise — silent failures are the
  // worst failure mode for a smoke.
  handle.child.stderr.on("data", (chunk: Buffer) => {
    process.stderr.write(`[acp:stderr] ${chunk.toString().replace(/\n+$/, "")}\n`);
  });

  let success = false;
  try {
    const client = await createAcpClient(handle, execCtx);
    const initResult = await client.initialize();
    if (typeof initResult.protocolVersion !== "number") {
      throw new Error(
        `initialize returned non-numeric protocolVersion=${JSON.stringify(initResult.protocolVersion)}`,
      );
    }
    log(
      `initialize ok protocolVersion=${initResult.protocolVersion} agentInfo=${JSON.stringify(initResult.agentInfo ?? {})}`,
    );
    if (!handle.acpConnection) {
      throw new Error(
        "createAcpClient did not attach acpConnection to the handle — memory bridge will not work",
      );
    }
    await assertFactSearchRoundtrip(handle);
    await assertHeartbeatMemoryBridge(handle, agentId);
    success = true;
  } catch (err) {
    process.stderr.write(`[hermes-bridge-smoke] FAIL\n${formatError(err)}\n`);
  } finally {
    registry.shutdown();
  }

  if (success) {
    log("PASS — both COG-116 acceptance criteria literally pass against live Hermes");
    process.exit(0);
  }
  process.exit(1);
}

function formatError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? err.message;
  if (err === null || err === undefined) return String(err);
  if (typeof err === "object") {
    try {
      return JSON.stringify(err, null, 2);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

main().catch((err: unknown) => {
  process.stderr.write(`[hermes-bridge-smoke] FATAL\n${formatError(err)}\n`);
  process.exit(1);
});
