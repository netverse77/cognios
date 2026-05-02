import { afterEach, describe, expect, it } from "vitest";

import {
  HermesProcessRegistry,
  buildHermesProcessSpec,
  type HermesProcessSpec,
} from "./process-registry.js";

// Real-spawn integration tests that exercise HermesProcessRegistry against
// actual OS processes. They use `node -e "process.stdin.resume()"` as the
// long-lived child so we don't depend on Python or the real Hermes ACP
// server — those run via scripts/hermes-local-smoke.sh.
//
// The board-mandated H3 exit criterion in [COG-115#document-spike §6] is
// "prove the registry can recycle on configIdentity change". The recycle
// test below is that proof.

const NODE_EXE = process.execPath;
const KEEP_ALIVE_SCRIPT = "process.stdin.resume();";

function specOf(overrides: Partial<HermesProcessSpec> = {}): HermesProcessSpec {
  const built = buildHermesProcessSpec({
    agentId: "agent-live",
    companyId: "co-live",
    config: {
      hermesAcpCommand: NODE_EXE,
      hermesAcpArgs: ["-e", KEEP_ALIVE_SCRIPT],
      hermesRepoPath: process.cwd(),
      ...((overrides as { __config?: Record<string, unknown> }).__config ?? {}),
    },
    workspaceCwd: process.cwd(),
  });
  return { ...built, ...overrides };
}

async function waitForExit(child: { exitCode: number | null; once: Function }, ms = 3000): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, ms);
    child.once("exit", () => {
      clearTimeout(t);
      resolve();
    });
  });
}

describe("HermesProcessRegistry (live spawn)", () => {
  let registry: HermesProcessRegistry;

  afterEach(() => {
    registry?.shutdown();
  });

  it("returns the same handle when the same configIdentity is acquired twice", async () => {
    registry = new HermesProcessRegistry();
    const spec = specOf();
    const a = registry.acquire(spec);
    expect(a.child.pid).toBeGreaterThan(0);
    const b = registry.acquire(spec);
    expect(b.child.pid).toBe(a.child.pid);
    expect(registry.snapshot()).toHaveLength(1);
  });

  it("recycles the child when configIdentity changes between heartbeats", async () => {
    registry = new HermesProcessRegistry();

    const specA = buildHermesProcessSpec({
      agentId: "agent-recycle",
      companyId: "co",
      config: {
        hermesAcpCommand: NODE_EXE,
        hermesAcpArgs: ["-e", KEEP_ALIVE_SCRIPT],
        hermesRepoPath: process.cwd(),
        env: { CONFIG_VARIANT: "A" },
      },
      workspaceCwd: process.cwd(),
    });
    const specB = buildHermesProcessSpec({
      agentId: "agent-recycle",
      companyId: "co",
      config: {
        hermesAcpCommand: NODE_EXE,
        hermesAcpArgs: ["-e", KEEP_ALIVE_SCRIPT],
        hermesRepoPath: process.cwd(),
        env: { CONFIG_VARIANT: "B" }, // <-- changes configIdentity
      },
      workspaceCwd: process.cwd(),
    });

    expect(specA.configIdentity).not.toBe(specB.configIdentity);

    const handleA = registry.acquire(specA);
    const pidA = handleA.child.pid;
    expect(pidA).toBeGreaterThan(0);
    handleA.sessionId = "stale-session-id-from-A";

    const handleB = registry.acquire(specB);
    const pidB = handleB.child.pid;
    expect(pidB).toBeGreaterThan(0);
    expect(pidB).not.toBe(pidA);

    // sessionId must NOT carry across recycles - prior session belongs to a
    // different process now and would be unknown to the new Hermes child.
    expect(handleB.sessionId).toBeNull();
    expect(handleB.initialized).toBe(false);

    // The old child must be gone.
    await waitForExit(handleA.child);
    expect(handleA.child.exitCode !== null || handleA.child.killed).toBe(true);

    // Snapshot should report exactly the new handle.
    const snap = registry.snapshot();
    expect(snap).toHaveLength(1);
    expect(snap[0]?.pid).toBe(pidB);
    expect(snap[0]?.configIdentity).toBe(specB.configIdentity);
  });

  it("evict() kills the child and removes the handle", async () => {
    registry = new HermesProcessRegistry();
    const spec = specOf();
    const handle = registry.acquire(spec);
    expect(handle.child.pid).toBeGreaterThan(0);
    expect(registry.snapshot()).toHaveLength(1);

    registry.evict(spec.agentId, "test_eviction");

    expect(registry.snapshot()).toHaveLength(0);
    await waitForExit(handle.child);
    expect(handle.child.exitCode !== null || handle.child.killed).toBe(true);
  });

  it("respawns when the previous child has exited (e.g. Hermes crashed)", async () => {
    registry = new HermesProcessRegistry();
    const spec = specOf();
    const first = registry.acquire(spec);
    const firstPid = first.child.pid;

    // Simulate Hermes crashing between heartbeats.
    first.child.kill("SIGKILL");
    await waitForExit(first.child);
    expect(first.child.exitCode !== null || first.child.killed).toBe(true);

    const second = registry.acquire(spec);
    expect(second.child.pid).toBeGreaterThan(0);
    expect(second.child.pid).not.toBe(firstPid);
  });

  it("shutdown() kills every tracked child", async () => {
    registry = new HermesProcessRegistry();
    const a = registry.acquire(
      buildHermesProcessSpec({
        agentId: "agent-1",
        companyId: "co",
        config: {
          hermesAcpCommand: NODE_EXE,
          hermesAcpArgs: ["-e", KEEP_ALIVE_SCRIPT],
          hermesRepoPath: process.cwd(),
        },
        workspaceCwd: process.cwd(),
      }),
    );
    const b = registry.acquire(
      buildHermesProcessSpec({
        agentId: "agent-2",
        companyId: "co",
        config: {
          hermesAcpCommand: NODE_EXE,
          hermesAcpArgs: ["-e", KEEP_ALIVE_SCRIPT],
          hermesRepoPath: process.cwd(),
        },
        workspaceCwd: process.cwd(),
      }),
    );
    expect(registry.snapshot()).toHaveLength(2);
    registry.shutdown();
    expect(registry.snapshot()).toHaveLength(0);
    await waitForExit(a.child);
    await waitForExit(b.child);
    expect(a.child.exitCode !== null || a.child.killed).toBe(true);
    expect(b.child.exitCode !== null || b.child.killed).toBe(true);
  });
});
