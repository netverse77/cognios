import { describe, expect, it } from "vitest";

import {
  HermesProcessRegistry,
  buildHermesProcessSpec,
  type HermesProcessHandle,
} from "./process-registry.js";

describe("buildHermesProcessSpec", () => {
  const base = {
    agentId: "agent-123",
    companyId: "co-456",
    workspaceCwd: "/work/space",
  };

  it("falls back to python -m acp_adapter.entry when nothing is configured", () => {
    const spec = buildHermesProcessSpec({ ...base, config: {} });
    expect(spec.command).toBe("python");
    expect(spec.args).toEqual(["-m", "acp_adapter.entry"]);
    expect(spec.cwd).toBe("/work/space");
    expect(spec.hermesHome).toBeNull();
  });

  it("respects an operator-supplied interpreter, args, hermesRepoPath, and HERMES_HOME", () => {
    const spec = buildHermesProcessSpec({
      ...base,
      config: {
        hermesAcpCommand: "/opt/python3.13/bin/python",
        hermesAcpArgs: ["-m", "acp_adapter.entry", "--debug"],
        hermesRepoPath: "/srv/hermes-agent",
        hermesHome: "/var/hermes",
        env: { HERMES_PROFILE: "ci" },
      },
    });
    expect(spec.command).toBe("/opt/python3.13/bin/python");
    expect(spec.args).toEqual(["-m", "acp_adapter.entry", "--debug"]);
    expect(spec.cwd).toBe("/srv/hermes-agent");
    expect(spec.hermesHome).toBe("/var/hermes");
    expect(spec.extraEnv).toEqual({ HERMES_PROFILE: "ci" });
  });

  it("produces a stable configIdentity for identical inputs and a different one when any field changes", () => {
    const a = buildHermesProcessSpec({ ...base, config: { hermesHome: "/h" } });
    const b = buildHermesProcessSpec({ ...base, config: { hermesHome: "/h" } });
    expect(a.configIdentity).toBe(b.configIdentity);

    const c = buildHermesProcessSpec({ ...base, config: { hermesHome: "/h2" } });
    expect(c.configIdentity).not.toBe(a.configIdentity);

    const d = buildHermesProcessSpec({
      ...base,
      config: { hermesHome: "/h", env: { X: "1" } },
    });
    expect(d.configIdentity).not.toBe(a.configIdentity);
  });
});

function fakeHandle(opts: {
  agentId: string;
  alive: boolean;
  initialized: boolean;
  lastUsedAt?: number;
}): HermesProcessHandle {
  return {
    spec: {
      agentId: opts.agentId,
      companyId: "co",
      command: "python",
      args: [],
      cwd: "/",
      hermesHome: null,
      extraEnv: {},
      configIdentity: "x",
    },
    child: {
      pid: 1234,
      exitCode: opts.alive ? null : 0,
      killed: !opts.alive,
    } as unknown as HermesProcessHandle["child"],
    sessionId: null,
    initialized: opts.initialized,
    lastUsedAt: opts.lastUsedAt ?? 0,
    acpConnection: null,
  };
}

describe("HermesProcessRegistry.healthSnapshot", () => {
  it("returns idle counts when registry is empty", () => {
    const registry = new HermesProcessRegistry();
    expect(registry.healthSnapshot()).toEqual({
      total: 0,
      alive: 0,
      initialized: 0,
      lastActivityAt: null,
    });
  });

  it("counts alive vs dead handles and surfaces max lastUsedAt", () => {
    const registry = new HermesProcessRegistry();
    const internal = (registry as unknown as { handles: Map<string, HermesProcessHandle> }).handles;
    internal.set("a", fakeHandle({ agentId: "a", alive: true, initialized: true, lastUsedAt: 1_000 }));
    internal.set("b", fakeHandle({ agentId: "b", alive: true, initialized: false, lastUsedAt: 5_000 }));
    internal.set("c", fakeHandle({ agentId: "c", alive: false, initialized: true, lastUsedAt: 3_000 }));

    expect(registry.healthSnapshot()).toEqual({
      total: 3,
      alive: 2,
      initialized: 1,
      lastActivityAt: 5_000,
    });
  });
});
