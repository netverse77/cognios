import { describe, expect, it } from "vitest";

import { buildHermesProcessSpec } from "./process-registry.js";

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
