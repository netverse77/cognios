import { describe, expect, it } from "vitest";
import { deriveAggregateStatus } from "./StatusBarHealth";
import type { HealthStatus } from "../api/health";

const baseHealth: HealthStatus = {
  status: "ok",
  features: { statusBarHealthEnabled: true },
};

describe("deriveAggregateStatus", () => {
  it("reports ok when hermes is ok", () => {
    const result = deriveAggregateStatus({
      health: {
        ...baseHealth,
        hermes: { status: "ok", total: 1, alive: 1, initialized: 1, lastActivityAt: null },
      },
      isError: false,
      isLoading: false,
    });
    expect(result.level).toBe("ok");
    expect(result.label).toBe("All systems ok");
    expect(result.hermesLabel).toBe("ok");
  });

  it("reports ok when hermes is idle (no active processes)", () => {
    const result = deriveAggregateStatus({
      health: {
        ...baseHealth,
        hermes: { status: "idle", total: 0, alive: 0, initialized: 0, lastActivityAt: null },
      },
      isError: false,
      isLoading: false,
    });
    expect(result.level).toBe("ok");
    expect(result.hermesLabel).toBe("idle");
  });

  it("reports degraded (amber) when hermes is degraded", () => {
    const result = deriveAggregateStatus({
      health: {
        ...baseHealth,
        hermes: { status: "degraded", total: 2, alive: 1, initialized: 1, lastActivityAt: null },
      },
      isError: false,
      isLoading: false,
    });
    expect(result.level).toBe("degraded");
    expect(result.label).toBe("Hermes degraded");
  });

  it("reports degraded (amber) when hermes is offline", () => {
    const result = deriveAggregateStatus({
      health: {
        ...baseHealth,
        hermes: { status: "offline", total: 1, alive: 0, initialized: 0, lastActivityAt: null },
      },
      isError: false,
      isLoading: false,
    });
    expect(result.level).toBe("degraded");
    expect(result.label).toBe("Hermes offline");
  });

  it("reports unhealthy (red) when the health request errors", () => {
    const result = deriveAggregateStatus({
      health: undefined,
      isError: true,
      isLoading: false,
    });
    expect(result.level).toBe("unhealthy");
    expect(result.label).toBe("Server unreachable");
  });

  it("reports loading while the first request is in flight", () => {
    const result = deriveAggregateStatus({
      health: undefined,
      isError: false,
      isLoading: true,
    });
    expect(result.level).toBe("loading");
  });
});
