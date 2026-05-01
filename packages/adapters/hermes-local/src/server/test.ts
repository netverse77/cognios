import { spawn } from "node:child_process";

import type {
  AdapterEnvironmentTestContext,
  AdapterEnvironmentTestResult,
  AdapterEnvironmentCheck,
} from "@paperclipai/adapter-utils";
import { asString, asStringArray } from "@paperclipai/adapter-utils/server-utils";

const PROBE_TIMEOUT_MS = 4000;

/**
 * Lightweight environment check. Does NOT spawn the real Hermes ACP server
 * (that would block on stdio). Only confirms that the configured interpreter
 * resolves and exits cleanly when invoked with `--version`.
 */
export async function testEnvironment(
  ctx: AdapterEnvironmentTestContext,
): Promise<AdapterEnvironmentTestResult> {
  const config = ctx.config ?? {};
  const command = asString(config.hermesAcpCommand, "python");
  const rawArgs = asStringArray(config.hermesAcpArgs);
  const checks: AdapterEnvironmentCheck[] = [];

  if (process.env.ADAPTER_HERMES_LOCAL !== "1") {
    checks.push({
      code: "hermes_local_flag_off",
      level: "info",
      message: "ADAPTER_HERMES_LOCAL is not set; the legacy npm-backed adapter handles hermes_local.",
      hint: "Set ADAPTER_HERMES_LOCAL=1 in the server env to route to this in-tree adapter.",
    });
  }

  const probe = await runProbe(command, ["--version"]);
  if (probe.kind === "ok") {
    checks.push({
      code: "hermes_local_command_resolves",
      level: "info",
      message: `Interpreter resolved: ${command}`,
      detail: probe.versionLine ?? null,
    });
  } else {
    checks.push({
      code: "hermes_local_command_missing",
      level: "error",
      message: `Could not invoke '${command}': ${probe.reason}`,
      hint: "Set adapterConfig.hermesAcpCommand to a working python interpreter (or full path).",
    });
  }

  if (rawArgs.length === 0) {
    checks.push({
      code: "hermes_local_default_args",
      level: "info",
      message: "Using default ACP entry: -m acp_adapter.entry",
    });
  } else {
    checks.push({
      code: "hermes_local_custom_args",
      level: "info",
      message: `Using configured ACP args: ${rawArgs.join(" ")}`,
    });
  }

  const status = checks.some((c) => c.level === "error") ? "fail" : "pass";
  return {
    adapterType: "hermes_local",
    status,
    checks,
    testedAt: new Date().toISOString(),
  };
}

async function runProbe(
  command: string,
  args: string[],
): Promise<{ kind: "ok"; versionLine: string | null } | { kind: "fail"; reason: string }> {
  return await new Promise((resolve) => {
    let stdoutBuf = "";
    let stderrBuf = "";
    let settled = false;

    const settle = (
      result: { kind: "ok"; versionLine: string | null } | { kind: "fail"; reason: string },
    ) => {
      if (settled) return;
      settled = true;
      try {
        child.kill("SIGTERM");
      } catch {}
      resolve(result);
    };

    const child = spawn(command, args, { windowsHide: true });
    const timer = setTimeout(() => settle({ kind: "fail", reason: "probe timed out" }), PROBE_TIMEOUT_MS);
    timer.unref();

    child.on("error", (err) => settle({ kind: "fail", reason: err.message }));
    child.stdout.on("data", (chunk) => {
      stdoutBuf += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderrBuf += chunk.toString();
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        const line = (stdoutBuf || stderrBuf).split(/\r?\n/).find((l) => l.trim().length > 0) ?? null;
        settle({ kind: "ok", versionLine: line?.trim() ?? null });
        return;
      }
      settle({ kind: "fail", reason: `exit code ${code ?? "?"}` });
    });
  });
}

